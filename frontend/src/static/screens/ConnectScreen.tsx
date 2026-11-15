// `/conectar`: liga este navegador à nuvem do grupo. Aceita o link para a
// equipe (`#url=…&key=…&nome=…`) ou os dois valores digitados, e confere que o
// projeto tem o schema do dataframeit em modo nativo antes de gravar.

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "@/static/shims/next-link";
import {
  isValidSupabaseUrl,
  parseTeamLink,
  readConnection,
  saveConnection,
  type Connection,
} from "@/static/runtime/connection";
import { navigate } from "@/static/runtime/navigation";
import { createBrowserClient } from "@/static/runtime/supabase";
import { AuthShell } from "@/static/screens/AuthShell";

type ConnectionCheck =
  | { ok: true }
  | { ok: false; reason: "unreachable" | "schema-missing" | "not-native" };

async function checkConnection(connection: Connection): Promise<ConnectionCheck> {
  try {
    const { data, error } = await createBrowserClient(connection).rpc("native_auth_enabled");
    if (error) {
      // PGRST202: função inexistente — o schema do dataframeit não foi instalado.
      return { ok: false, reason: error.code === "PGRST202" ? "schema-missing" : "unreachable" };
    }
    return data === true ? { ok: true } : { ok: false, reason: "not-native" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

const CHECK_MESSAGES: Record<Exclude<ConnectionCheck, { ok: true }>["reason"], string> = {
  unreachable:
    "Não foi possível falar com esse projeto Supabase. Confira a URL e a chave anônima.",
  "schema-missing":
    "O projeto existe, mas o dataframeit ainda não foi instalado nele. Use o assistente “Criar a nuvem do grupo”.",
  "not-native":
    "Esse projeto não está configurado para o modo estático (login pelo Supabase). Peça ao coordenador o link correto.",
};

export function ConnectScreen() {
  const urlId = useId();
  const keyId = useId();
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  // O link para a equipe chega no hash; lido uma vez, na montagem. Nunca
  // conecta sozinho: um link forjado levaria a pessoa a entrar (e a digitar
  // dados de pesquisa, ou gastar a chave de LLM) na nuvem de outra pessoa.
  // O endereço é mostrado e a troca exige um clique.
  const [fromLink] = useState(() => parseTeamLink(window.location.hash));
  const [status, setStatus] = useState<"idle" | "checking">("idle");
  const [error, setError] = useState<string | null>(null);
  const current = readConnection();

  function applyResult(connection: Connection, result: ConnectionCheck) {
    setStatus("idle");
    if (!result.ok) {
      setError(CHECK_MESSAGES[result.reason]);
      return;
    }
    saveConnection(connection);
    navigate("/auth/login", { replace: true });
  }

  function connect(connection: Connection) {
    setStatus("checking");
    setError(null);
    void checkConnection(connection).then((result) => applyResult(connection, result));
  }

  useEffect(() => {
    // O hash leva a chave anônima; não deixá-lo no histórico.
    if (fromLink) window.history.replaceState(null, "", window.location.pathname);
  }, [fromLink]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim().replace(/\/$/, "");
    if (!isValidSupabaseUrl(trimmed)) {
      setError("A URL do projeto deve começar com https://");
      return;
    }
    if (!anonKey.trim()) {
      setError("Informe a chave anônima (anon key) do projeto.");
      return;
    }
    connect({ url: trimmed, anonKey: anonKey.trim() });
  }

  return (
    <AuthShell
      title="Conectar à nuvem do grupo"
      subtitle="Abra o link que o coordenador enviou, ou informe a URL e a chave anônima do projeto Supabase do grupo."
    >
      {current ? (
        <p className="rounded-md border bg-muted/40 p-3 text-sm">
          Este navegador já está conectado a{" "}
          <strong>{current.name ?? new URL(current.url).hostname}</strong>.{" "}
          <Link href="/dashboard" className="text-brand underline">
            Ir para os projetos
          </Link>
        </p>
      ) : null}
      {fromLink ? (
        <div className="space-y-3 rounded-md border p-3 text-sm">
          <p>
            Este link conecta à nuvem{fromLink.name ? <> <strong>{fromLink.name}</strong></> : null} em{" "}
            <strong>{new URL(fromLink.url).hostname}</strong>.
          </p>
          {current && current.url !== fromLink.url ? (
            <p className="text-amber-800">
              Você está conectado a outra nuvem ({new URL(current.url).hostname}). Conectar troca a nuvem
              deste navegador. Só continue se o link veio do seu coordenador.
            </p>
          ) : null}
          <Button type="button" disabled={status === "checking"} onClick={() => connect(fromLink)}>
            {status === "checking" ? "Verificando…" : "Conectar a esta nuvem"}
          </Button>
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor={urlId}>URL do projeto</Label>
          <Input
            id={urlId}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://xxxx.supabase.co"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={keyId}>Chave anônima (anon key)</Label>
          <Input
            id={keyId}
            autoComplete="off"
            spellCheck={false}
            value={anonKey}
            onChange={(event) => setAnonKey(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={status === "checking"}>
          {status === "checking" ? "Verificando…" : "Conectar"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Coordenador de um grupo novo?{" "}
        <Link href="/nova-nuvem" className="text-brand underline">
          Criar a nuvem do grupo
        </Link>
      </p>
    </AuthShell>
  );
}
