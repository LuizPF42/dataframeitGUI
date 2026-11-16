"""Backend Python do modo estático, dentro de um Web Worker com Pyodide.

Atende as mesmas rotas do FastAPI (`routes/llm_routes.py`,
`routes/pydantic_routes.py`) chamando o MESMO código de `backend/services`
(`llm_runner`, `pydantic_compiler`), copiado para o sistema de arquivos do
Pyodide no carregamento. O que muda é só a infraestrutura:

- Banco: `services.supabase_client.get_supabase()` devolve o cliente de
  `supabase_shim` (PostgREST com o JWT do coordenador, não a service role). As
  checagens de coordenador que as rotas fazem com a service key aqui são da
  RLS (migration 20261115180000).
- dataframeit: o runner é síncrono e chama `dataframeit(...)`. No navegador não
  há threads, então a chamada vai para `adataframeit(...)` (ainvoke +
  asyncio.gather) por `pyodide.ffi.run_sync`, que suspende a pilha Python
  enquanto o provedor responde (JSPI). Só essa linha muda de lugar; fatiamento
  do schema, canário, justificativas, publicação e classificação de erros são
  os do runner.
- Estado do job: `_jobs[job_id]` é espelhado para o JavaScript a cada mudança,
  porque a rota de status é atendida no JS enquanto o Python está suspenso.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import uuid
from typing import Any

logging.basicConfig(level=logging.INFO, format="[py] %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("static_backend")

PROVIDER_ENV = {
    "google_genai": "GOOGLE_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}

_FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_FILTER_MODES = {"all", "pending", "max_responses", "random_sample"}


class HttpError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ---------------------------------------------------------------- bridge JS
_bridge = None  # módulo JS registrado como `static_bridge`


def _token() -> str | None:
    return str(_bridge.token()) if _bridge is not None and _bridge.token() else None


def configure(url: str, anon_key: str) -> None:
    """Instala os módulos de infraestrutura no lugar dos do servidor."""
    global _bridge
    import static_bridge  # registrado pelo worker com pyodide.registerJsModule

    _bridge = static_bridge

    import supabase_shim

    sys.modules["supabase"] = supabase_shim
    sys.modules["postgrest"] = supabase_shim

    client = supabase_shim.create_client(url, anon_key, _token)

    import types

    supabase_client = types.ModuleType("services.supabase_client")
    supabase_client.get_supabase = lambda: client  # type: ignore[attr-defined]
    sys.modules["services.supabase_client"] = supabase_client

    reconciliation = types.ModuleType("services.auto_review_reconciliation")

    def wake_auto_review_reconciliation_sync() -> bool:
        """Mesmo contrato do servidor: acorda o dreno da fila e nunca falha a run.

        No modo estático o dreno é a action `internal.drainAutoReviewReconciliation`
        da Edge Function, que roda com a service role do projeto do grupo.
        """
        try:
            client.invoke_function(
                "actions",
                {"module": "internal", "name": "drainAutoReviewReconciliation", "args": []},
            )
            return True
        except Exception:
            logger.exception("Falha ao acordar a reconciliação da auto-revisão")
            return False

    reconciliation.wake_auto_review_reconciliation_sync = wake_auto_review_reconciliation_sync  # type: ignore[attr-defined]
    sys.modules["services.auto_review_reconciliation"] = reconciliation

    _patch_http_clients()
    _install_dataframeit_bridge()
    _install_status_mirror()
    _install_inline_executor()


def set_provider_keys(keys_json: str) -> None:
    keys = json.loads(keys_json)
    for provider, env_name in PROVIDER_ENV.items():
        value = keys.get(provider)
        if value:
            os.environ[env_name] = value
        else:
            os.environ.pop(env_name, None)


# ------------------------------------------------------------ adaptações
def _patch_http_clients() -> None:
    """Ajustes de HTTP no navegador, medidos no teste do handoff (§5.3).

    - O `fetch` do navegador já descomprime a resposta; o httpx não pode
      descomprimir de novo.
    - A API da Anthropic só aceita chamada direta do navegador com o cabeçalho
      `anthropic-dangerous-direct-browser-access`.
    """
    try:
        import httpx
        from httpx._decoders import IdentityDecoder

        httpx.Response._get_content_decoder = lambda self: IdentityDecoder()  # type: ignore[method-assign]
    except Exception:  # pragma: no cover - httpx sempre presente no lockfile
        logger.exception("Não foi possível ajustar o decodificador do httpx")

    try:
        import anthropic
    except ImportError:
        return
    header = {"anthropic-dangerous-direct-browser-access": "true"}
    for cls in (getattr(anthropic, "Anthropic", None), getattr(anthropic, "AsyncAnthropic", None)):
        if cls is None or getattr(cls, "__dataframeit_patched__", False):
            continue
        original_init = cls.__init__

        def patched_init(self, *args, __original=original_init, **kwargs):
            kwargs["default_headers"] = {**header, **(kwargs.get("default_headers") or {})}
            __original(self, *args, **kwargs)

        cls.__init__ = patched_init
        cls.__dataframeit_patched__ = True


def _install_dataframeit_bridge() -> None:
    import dataframeit as package

    async_entry = getattr(package, "adataframeit", None)
    if async_entry is None:
        raise RuntimeError(
            "A versão do dataframeit instalada não tem `adataframeit` (modo assíncrono), "
            "necessário para rodar no navegador."
        )
    from pyodide.ffi import run_sync

    def dataframeit_in_browser(*args, **kwargs):
        return run_sync(async_entry(*args, **kwargs))

    package.dataframeit = dataframeit_in_browser


class _ObservedJob(dict):
    """`_jobs[job_id]` que avisa o JavaScript a cada mudança."""

    def __init__(self, job_id: str, data: dict):
        super().__init__(data)
        self._job_id = job_id
        self._notify()

    def _notify(self) -> None:
        if _bridge is None:
            return
        try:
            _bridge.status(self._job_id, json.dumps(dict(self), default=str))
        except Exception:
            logger.exception("Falha ao espelhar o status do job")

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self._notify()

    def update(self, *args, **kwargs):
        super().update(*args, **kwargs)
        self._notify()

    def setdefault(self, key, default=None):
        value = super().setdefault(key, default)
        self._notify()
        return value


def _install_status_mirror() -> None:
    from services import llm_runner

    original_init_job = llm_runner.init_job
    if getattr(original_init_job, "__dataframeit_mirrored__", False):
        return

    def init_job(job_id: str, project_id: str, filter_mode: str) -> None:
        original_init_job(job_id, project_id, filter_mode)
        llm_runner._jobs[job_id] = _ObservedJob(job_id, llm_runner._jobs[job_id])

    init_job.__dataframeit_mirrored__ = True  # type: ignore[attr-defined]
    llm_runner.init_job = init_job


class _InlineExecutor:
    """`ThreadPoolExecutor` sem threads, no lugar do que o `llm_runner` usa.

    O Pyodide não cria thread (`RuntimeError: can't start new thread`), e o
    runner lê em paralelo, num `ThreadPoolExecutor`, os lotes de ids de
    `_select_all` sempre que há mais de um lote: uma seleção de mais de 100
    documentos, ou os pendentes de um projeto já em parte processado. Aqui os
    lotes saem em sequência e na mesma ordem, então o resultado é o mesmo; só
    as idas e voltas deixam de se sobrepor, o que o XHR síncrono do shim também
    não faria. `pyodide-smoke.mjs` cobre o caminho com uma seleção de 150.
    """

    def __init__(self, max_workers: int | None = None, *args: Any, **kwargs: Any) -> None:
        pass

    def __enter__(self) -> _InlineExecutor:
        return self

    def __exit__(self, *exc_info: Any) -> None:
        return None

    def submit(self, fn, /, *args: Any, **kwargs: Any):
        from concurrent.futures import Future

        future: Future = Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as exc:  # o Future guarda a falha, como no pool
            future.set_exception(exc)
        return future

    def map(self, fn, *iterables: Any, timeout: float | None = None, chunksize: int = 1):
        # Como o `Executor.map`: para no iterável mais curto.
        return iter([fn(*args) for args in zip(*iterables, strict=False)])

    def shutdown(self, wait: bool = True, *, cancel_futures: bool = False) -> None:
        return None


def _install_inline_executor() -> None:
    from services import llm_runner

    llm_runner.ThreadPoolExecutor = _InlineExecutor  # type: ignore[attr-defined,misc]


# ------------------------------------------------------------------ rotas
def _uuid(value: Any, field: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError) as exc:
        raise HttpError(422, f"{field} inválido") from exc


def _uuid_list(values: Any, field: str) -> list[str] | None:
    if values is None:
        return None
    if not isinstance(values, list) or not values or len(values) > 10_000:
        raise HttpError(422, f"{field} inválido")
    parsed = [_uuid(v, field) for v in values]
    if len(set(parsed)) != len(parsed):
        raise HttpError(422, f"{field} com valores repetidos")
    return parsed


def _refuse_impersonation(payload: dict) -> None:
    # Mesmo interlock de `require_writable_user`: o master visualizando como
    # outro membro não dispara LLM. A RLS decide o resto.
    if payload.get("impersonating") is True:
        raise HttpError(403, "Ação indisponível ao visualizar como outro membro.")


def _translate_db_error(exc: Exception) -> HttpError:
    code = getattr(exc, "code", None)
    if code == "42501":
        return HttpError(403, "Apenas coordenadores podem executar o LLM neste projeto.")
    return HttpError(500, getattr(exc, "message", None) or str(exc))


def start_job(kind: str, payload_json: str) -> str:
    """Valida a requisição, abre a rodada em `llm_runs` e devolve o job_id.

    A execução em si é `run_job`, chamada pelo worker em seguida.
    """
    from services.llm_runner import init_job

    payload = json.loads(payload_json)
    project_id = _uuid(payload.get("project_id"), "project_id")
    if kind == "run":
        _refuse_impersonation(payload)
        filter_mode = payload.get("filter_mode", "all")
        if filter_mode not in _FILTER_MODES:
            raise HttpError(422, "filter_mode inválido")
        if filter_mode == "random_sample" and payload.get("sample_size") is None:
            raise HttpError(422, "sample_size is required for random_sample")
        if filter_mode == "max_responses" and payload.get("max_response_count") is None:
            raise HttpError(422, "max_response_count is required for max_responses")
        _uuid_list(payload.get("document_ids"), "document_ids")
    elif kind == "run-field":
        names = payload.get("field_names")
        if (
            not isinstance(names, list)
            or not names
            or len(names) > 500
            or len(set(names)) != len(names)
            or not all(isinstance(n, str) and _FIELD_NAME.match(n) and len(n) <= 128 for n in names)
            or any(n.startswith("__") and n.endswith("__") for n in names)
        ):
            raise HttpError(422, "field_names inválido")
        _uuid_list(payload.get("document_ids"), "document_ids")
        filter_mode = "all"
    else:
        raise HttpError(404, "Rota desconhecida")

    job_id = str(uuid.uuid4())
    try:
        init_job(job_id, project_id, filter_mode)
    except Exception as exc:
        raise _translate_db_error(exc) from exc
    return job_id


def run_job(kind: str, job_id: str, payload_json: str) -> None:
    """Executa a rodada. Precisa ser chamada com `callPromising` (JSPI)."""
    from services.llm_runner import run_llm, run_llm_fields

    payload = json.loads(payload_json)
    project_id = str(uuid.UUID(payload["project_id"]))
    document_ids = payload.get("document_ids")
    if kind == "run":
        run_llm(
            job_id,
            project_id,
            document_ids,
            payload.get("filter_mode", "all"),
            payload.get("max_response_count"),
            payload.get("sample_size"),
        )
    else:
        run_llm_fields(job_id, project_id, payload["field_names"], document_ids)


def preview_prompt(payload_json: str) -> str:
    from services.llm_runner import _build_prompt

    payload = json.loads(payload_json)
    for key in ("project_description", "prompt_template"):
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > 50_000):
            raise HttpError(422, f"{key} inválido")
    return json.dumps(
        {"prompt": _build_prompt(payload.get("project_description"), payload.get("prompt_template"))}
    )


def cleanup_stale(payload_json: str) -> str:
    from services.llm_runner import mark_stale_runs_as_error
    from services.supabase_client import get_supabase

    payload = json.loads(payload_json)
    project_id = _uuid(payload.get("project_id"), "project_id")
    try:
        cleaned = mark_stale_runs_as_error(get_supabase(), project_id)
    except Exception as exc:
        raise _translate_db_error(exc) from exc
    return json.dumps({"cleaned": cleaned})


def recover_fields(payload_json: str) -> str:
    from services.pydantic_compiler import compile_pydantic
    from services.supabase_client import get_supabase

    payload = json.loads(payload_json)
    project_id = _uuid(payload.get("project_id"), "project_id")
    result = (
        get_supabase()
        .table("projects")
        .select("pydantic_code")
        .eq("id", project_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HttpError(404, "Projeto não encontrado")
    code = result.data.get("pydantic_code")
    if not code:
        raise HttpError(404, "Projeto não possui código Pydantic armazenado")
    # Compilar no navegador do próprio coordenador: o código não passa por
    # servidor nenhum (o risco de servidor apontado em docs/UI.md não existe).
    return json.dumps(compile_pydantic(code, generate_missing_ids=True), default=str)


def call(name: str, payload_json: str) -> str:
    """Ponto único de entrada para as rotas curtas; erros viram {status, detail}."""
    handlers = {
        "preview_prompt": preview_prompt,
        "cleanup_stale": cleanup_stale,
        "recover_fields": recover_fields,
    }
    try:
        if name == "start_run":
            return json.dumps({"ok": True, "data": {"job_id": start_job("run", payload_json)}})
        if name == "start_run_field":
            return json.dumps({"ok": True, "data": {"job_id": start_job("run-field", payload_json)}})
        handler = handlers.get(name)
        if handler is None:
            raise HttpError(404, "Rota desconhecida")
        return json.dumps({"ok": True, "data": json.loads(handler(payload_json))})
    except HttpError as exc:
        return json.dumps({"ok": False, "status": exc.status, "detail": exc.detail})
    except Exception as exc:
        logger.exception("Falha na rota %s", name)
        return json.dumps({"ok": False, "status": 500, "detail": str(exc) or type(exc).__name__})
