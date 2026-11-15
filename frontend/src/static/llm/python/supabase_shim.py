"""Subconjunto do supabase-py para o backend Python rodando no navegador.

No modo estático o `llm_runner` roda num Web Worker com Pyodide. Ele fala com
o banco pela mesma interface do supabase-py (`table().select().eq()...
.execute()`, `rpc().execute()`), mas aqui cada `execute()` é uma requisição
HTTP síncrona ao PostgREST do projeto do grupo, com o JWT do coordenador — a
RLS decide o que passa. Requisição síncrona é permitida em Web Worker e mantém
o runner síncrono como no servidor.

Instalado no sistema de arquivos do Pyodide como o pacote `supabase`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

# Funções que no servidor só a service role executa e que, no modo estático,
# têm equivalente para o coordenador (migration 20261115180000).
RPC_IN_BROWSER = {
    "publish_latest_llm_response": "publish_llm_response_from_browser",
}

_RESERVED = set(',.:()"\\ ')


class PostgrestAPIError(Exception):
    """Mesmo formato do `postgrest.APIError`: `code`, `message`, `details`, `hint`."""

    def __init__(self, error: dict[str, Any]):
        self._raw_error = error
        self.code = error.get("code")
        self.message = error.get("message")
        self.details = error.get("details")
        self.hint = error.get("hint")
        super().__init__(self.message or str(error))

    def json(self) -> dict[str, Any]:
        return self._raw_error


APIError = PostgrestAPIError


@dataclass
class APIResponse:
    data: Any
    count: int | None = None


def _format(value: Any) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    return str(value)


def _quote_in(value: Any) -> str:
    text = _format(value)
    if any(char in _RESERVED for char in text):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


class _Http:
    """Transporte síncrono (XMLHttpRequest em Web Worker)."""

    def __init__(self, url: str, anon_key: str, token_getter):
        self.url = url.rstrip("/")
        self.anon_key = anon_key
        self.token_getter = token_getter

    def request(
        self,
        method: str,
        path: str,
        params: list[tuple[str, str]],
        body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, str, dict[str, str]]:
        from js import XMLHttpRequest  # disponível só no navegador

        query = "&".join(f"{quote(k, safe='.')}={quote(v, safe='')}" for k, v in params)
        url = f"{self.url}{path}{'?' + query if query else ''}"
        xhr = XMLHttpRequest.new()
        xhr.open(method, url, False)
        token = self.token_getter() or self.anon_key
        all_headers = {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            **(headers or {}),
        }
        for key, value in all_headers.items():
            xhr.setRequestHeader(key, value)
        xhr.send(json.dumps(body) if body is not None else None)
        response_headers: dict[str, str] = {}
        for line in str(xhr.getAllResponseHeaders() or "").splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                response_headers[key.strip().lower()] = value.strip()
        return int(xhr.status), str(xhr.responseText or ""), response_headers


def _raise_for(status: int, text: str) -> None:
    try:
        error = json.loads(text) if text else {}
    except json.JSONDecodeError:
        error = {}
    if not isinstance(error, dict):
        error = {}
    if "message" not in error:
        # Mesmo fallback do postgrest-py: sem corpo JSON, o code vira o status.
        error = {"message": text or f"HTTP {status}", "code": status, "details": None, "hint": None}
    raise PostgrestAPIError(error)


class QueryBuilder:
    def __init__(self, http: _Http, table: str):
        self._http = http
        self._table = table
        self._method = "GET"
        self._params: list[tuple[str, str]] = []
        self._body: Any = None
        self._headers: dict[str, str] = {}
        self._mode: str | None = None  # "single" | "maybe_single"
        self._count: str | None = None

    # --- operações ---
    def select(self, columns: str = "*", count: str | None = None) -> QueryBuilder:
        self._params.append(("select", "".join(columns.split())))
        if count:
            self._count = count
            self._headers["Prefer"] = f"count={count}"
        return self

    def insert(self, values: Any, returning: str = "representation") -> QueryBuilder:
        self._method = "POST"
        self._body = values
        self._headers["Prefer"] = f"return={returning}"
        return self

    def upsert(self, values: Any, on_conflict: str | None = None) -> QueryBuilder:
        self._method = "POST"
        self._body = values
        self._headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        if on_conflict:
            self._params.append(("on_conflict", on_conflict))
        return self

    def update(self, values: Any, returning: str = "representation") -> QueryBuilder:
        self._method = "PATCH"
        self._body = values
        self._headers["Prefer"] = f"return={returning}"
        return self

    def delete(self, returning: str = "representation") -> QueryBuilder:
        self._method = "DELETE"
        self._headers["Prefer"] = f"return={returning}"
        return self

    # --- filtros ---
    def _filter(self, column: str, operator: str, value: Any) -> QueryBuilder:
        self._params.append((column, f"{operator}.{_format(value)}"))
        return self

    def eq(self, column: str, value: Any) -> QueryBuilder:
        return self._filter(column, "eq", value)

    def neq(self, column: str, value: Any) -> QueryBuilder:
        return self._filter(column, "neq", value)

    def gt(self, column: str, value: Any) -> QueryBuilder:
        return self._filter(column, "gt", value)

    def gte(self, column: str, value: Any) -> QueryBuilder:
        return self._filter(column, "gte", value)

    def lt(self, column: str, value: Any) -> QueryBuilder:
        return self._filter(column, "lt", value)

    def lte(self, column: str, value: Any) -> QueryBuilder:
        return self._filter(column, "lte", value)

    def is_(self, column: str, value: Any) -> QueryBuilder:
        return self._filter(column, "is", value)

    def in_(self, column: str, values: list[Any]) -> QueryBuilder:
        self._params.append((column, f"in.({','.join(_quote_in(v) for v in values)})"))
        return self

    def or_(self, filters: str, reference_table: str | None = None) -> QueryBuilder:
        key = f"{reference_table}.or" if reference_table else "or"
        self._params.append((key, f"({filters})"))
        return self

    def order(self, column: str, desc: bool = False, nullsfirst: bool | None = None) -> QueryBuilder:
        term = f"{column}.{'desc' if desc else 'asc'}"
        if nullsfirst is not None:
            term += ".nullsfirst" if nullsfirst else ".nullslast"
        for index, (key, value) in enumerate(self._params):
            if key == "order":
                self._params[index] = ("order", f"{value},{term}")
                return self
        self._params.append(("order", term))
        return self

    def limit(self, size: int) -> QueryBuilder:
        self._params.append(("limit", str(size)))
        return self

    def range(self, start: int, end: int) -> QueryBuilder:
        self._params.append(("offset", str(start)))
        self._params.append(("limit", str(end - start + 1)))
        return self

    def single(self) -> QueryBuilder:
        self._mode = "single"
        self._headers["Accept"] = "application/vnd.pgrst.object+json"
        return self

    def maybe_single(self) -> QueryBuilder:
        self._mode = "maybe_single"
        return self

    # --- execução ---
    def execute(self) -> APIResponse:
        status, text, headers = self._http.request(
            self._method, f"/rest/v1/{self._table}", self._params, self._body, self._headers
        )
        if status >= 400:
            _raise_for(status, text)
        data = json.loads(text) if text else None
        count = None
        if self._count and "content-range" in headers:
            total = headers["content-range"].split("/")[-1]
            count = int(total) if total.isdigit() else None
        if self._mode == "maybe_single":
            rows = data or []
            if len(rows) > 1:
                raise PostgrestAPIError(
                    {"message": "JSON object requested, multiple rows returned", "code": "PGRST116"}
                )
            data = rows[0] if rows else None
        return APIResponse(data=data, count=count)


class _RpcCall:
    def __init__(self, http: _Http, fn: str, params: dict[str, Any] | None):
        self._http = http
        self._fn = RPC_IN_BROWSER.get(fn, fn)
        self._params = params or {}

    def execute(self) -> APIResponse:
        status, text, _ = self._http.request("POST", f"/rest/v1/rpc/{self._fn}", [], self._params)
        if status >= 400:
            _raise_for(status, text)
        return APIResponse(data=json.loads(text) if text else None)


class Client:
    def __init__(self, url: str, anon_key: str, token_getter):
        self._http = _Http(url, anon_key, token_getter)

    def table(self, name: str) -> QueryBuilder:
        return QueryBuilder(self._http, name)

    from_ = table

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> _RpcCall:
        return _RpcCall(self._http, fn, params)

    def invoke_function(self, name: str, body: dict[str, Any]) -> Any:
        status, text, _ = self._http.request("POST", f"/functions/v1/{name}", [], body)
        if status >= 400:
            _raise_for(status, text)
        return json.loads(text) if text else None


def create_client(url: str, key: str, token_getter=None) -> Client:
    return Client(url, key, token_getter or (lambda: None))
