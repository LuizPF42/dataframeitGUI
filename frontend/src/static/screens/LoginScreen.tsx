// `/auth/login` do modo estático: e-mail e código de 6 dígitos (OTP) do
// Supabase Auth. O código é o caminho preferido porque filtros de e-mail
// corporativos abrem os links antes da pessoa e queimam o token — mas o
// Supabase só deixa trocar o modelo do e-mail por `{{ .Token }}` com SMTP
// próprio. Sem SMTP o e-mail traz link mágico, e esta tela também aceita o
// retorno dele (fluxo PKCE, ver `identity/email-link.ts`).

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  describeEmailLinkError,
  readEmailLinkResult,
  stripEmailLinkParams,
} from "@/static/identity/email-link";
import { siteRoot } from "@/static/runtime/base-path";
import { readConnection } from "@/static/runtime/connection";
import { navigate } from "@/static/runtime/navigation";
import { getSupabase } from "@/static/runtime/supabase";
import { AuthShell } from "@/static/screens/AuthShell";
import Link from "@/static/shims/next-link";

/** Só caminhos internos; evita usar o login como redirecionador aberto. */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/dashboard";
  }
  return raw;
}

export function describeAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("signups not allowed") || lower.includes("signup is disabled")) {
    return "Este e-mail ainda não foi cadastrado no grupo. Peça ao coordenador para adicioná-lo.";
  }
  if (lower.includes("expired") || lower.includes("invalid")) {
    return "Código inválido ou expirado. Peça um novo código.";
  }
  if (lower.includes("rate limit") || lower.includes("security purposes")) {
    return "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";
  }
  return message;
}

/** Codes já trocados nesta página: o StrictMode roda o efeito duas vezes, e o code é de uso único. */
const exchangedCodes = new Set<string>();

export function LoginScreen() {
  const emailId = useId();
  const codeId = useId();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  // Retorno do link mágico, lido uma vez ao montar.
  const [link] = useState(() => readEmailLinkResult(window.location.search, window.location.hash));
  const [busy, setBusy] = useState(link?.kind === "code");
  const [error, setError] = useState<string | null>(() =>
    link?.kind === "error" ? describeEmailLinkError(link.errorCode, link.description) : null,
  );
  const connection = readConnection();
  const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));

  useEffect(() => {
    if (link) {
      // O code é de uso único: sai da URL antes de qualquer outra coisa.
      window.history.replaceState(null, "", stripEmailLinkParams(new URL(window.location.href)));
      if (link.kind === "error" || exchangedCodes.has(link.code)) return;
      exchangedCodes.add(link.code);
      void getSupabase()
        .auth.exchangeCodeForSession(link.code)
        .then(({ error: exchangeError }) => {
          setBusy(false);
          if (exchangeError) setError(describeEmailLinkError("exchange", exchangeError.message));
          else navigate(next, { replace: true });
        });
      return;
    }
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) navigate(next, { replace: true });
      });
  }, [link, next]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("Informe um e-mail válido.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: otpError } = await getSupabase().auth.signInWithOtp({
      email: normalized,
      // Sem SMTP próprio o e-mail traz link (não código); ele volta para esta
      // tela, que troca o `code` pela sessão. Sem query: a lista de retorno do
      // projeto é `<site>/**`.
      options: { shouldCreateUser: true, emailRedirectTo: `${siteRoot()}/auth/login` },
    });
    setBusy(false);
    if (otpError) {
      setError(describeAuthError(otpError.message));
      return;
    }
    setEmail(normalized);
    setStep("code");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length < 6) {
      setError("Digite o código numérico do e-mail.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await getSupabase().auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    setBusy(false);
    if (verifyError) {
      setError(describeAuthError(verifyError.message));
      return;
    }
    navigate(next, { replace: true });
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle={
        connection?.name ? (
          <>
            Nuvem do grupo <strong>{connection.name}</strong>
          </>
        ) : (
          "Enviaremos um acesso para o seu e-mail."
        )
      }
    >
      {step === "email" ? (
        <form onSubmit={(event) => void sendCode(event)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor={emailId}>E-mail</Label>
            <Input
              id={emailId}
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Enviando…" : "Enviar acesso"}
          </Button>
        </form>
      ) : (
        <form onSubmit={(event) => void verify(event)} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">
            Enviamos um e-mail para <strong>{email}</strong>. Se ele trouxer um código, digite-o abaixo;
            se trouxer um link, abra-o neste mesmo navegador. Vale por alguns minutos.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={codeId}>Código</Label>
            <Input
              id={codeId}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={10}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Verificando…" : "Entrar"}
          </Button>
          <div className="flex justify-between text-sm">
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              Trocar e-mail
            </button>
            <button type="button" className="text-brand underline" disabled={busy} onClick={() => void sendCode()}>
              Reenviar e-mail
            </button>
          </div>
        </form>
      )}
      <p className="text-center text-xs text-muted-foreground">
        <Link href="/conectar" className="underline">
          Trocar de nuvem
        </Link>
      </p>
    </AuthShell>
  );
}
