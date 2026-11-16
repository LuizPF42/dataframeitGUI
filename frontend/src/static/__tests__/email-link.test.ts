import { describe, expect, it } from "vitest";
import {
  describeEmailLinkError,
  readEmailLinkResult,
  stripEmailLinkParams,
} from "@/static/identity/email-link";
import { createBrowserClient } from "@/static/runtime/supabase";

describe("retorno do link mágico", () => {
  it("lê o code do fluxo PKCE na query", () => {
    expect(readEmailLinkResult("?code=0b6a3c7e-1f2d-4c5b-9a8e-123456789abc", "")).toEqual({
      kind: "code",
      code: "0b6a3c7e-1f2d-4c5b-9a8e-123456789abc",
    });
  });

  it("lê o erro do link expirado, venha na query ou no hash", () => {
    const fromHash = readEmailLinkResult(
      "",
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(fromHash).toEqual({
      kind: "error",
      errorCode: "otp_expired",
      description: "Email link is invalid or has expired",
    });
    expect(readEmailLinkResult("?error=server_error&error_description=x", "")).toMatchObject({
      kind: "error",
      errorCode: "server_error",
    });
  });

  it("não aceita tokens no hash (fluxo implícito): só o code do PKCE vira sessão", () => {
    // Um link forjado com a sessão de outra pessoa não pode logar quem o abre.
    expect(readEmailLinkResult("", "#access_token=a&refresh_token=b&type=magiclink")).toBeNull();
    expect(readEmailLinkResult("?next=/dashboard", "")).toBeNull();
    expect(readEmailLinkResult("?code=<script>", "")).toBeNull();
  });

  it("explica em português os erros que a pessoa consegue resolver", () => {
    expect(describeEmailLinkError("otp_expired")).toMatch(/expirou ou já foi usado/);
    expect(describeEmailLinkError("exchange", "invalid request: both auth code and code verifier should be non-empty")).toMatch(
      /mesmo navegador/,
    );
    expect(describeEmailLinkError("outro")).toMatch(/Peça um novo/);
  });

  it("tira o code da URL e preserva o resto", () => {
    const url = new URL("https://grupo.github.io/dataframeitGUI/auth/login?code=abc12345&next=%2Fx#frag");
    expect(stripEmailLinkParams(url)).toBe("/dataframeitGUI/auth/login?next=%2Fx");
  });
});

describe("cliente Supabase do navegador", () => {
  it("usa o fluxo PKCE, para o link mágico só valer no navegador que pediu", () => {
    const client = createBrowserClient({ url: "https://exemplo.supabase.co", anonKey: "anon", name: "x" });
    expect((client.auth as unknown as { flowType: string }).flowType).toBe("pkce");
  });
});
