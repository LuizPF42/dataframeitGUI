import { describe, expect, it, vi } from "vitest";
import { handle, underAllowed, publicKeyOf } from "../../../supabase/functions/static-setup/logica.mjs";

const ENV = {
  ALLOWED_ORIGINS: "https://grupo.github.io, http://localhost:5173",
  DFIT_OAUTH_CLIENT_ID: "client",
  DFIT_OAUTH_CLIENT_SECRET: "secret",
};
const REF = "abcdefghijklmnopqrst";

function request(body: unknown, origin = "https://grupo.github.io") {
  return new Request("https://setup.example/functions/v1/static-setup", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("função de setup do assistente", () => {
  it("recusa origem fora da lista", async () => {
    const response = await handle(request({ op: "orgs", token: "t" }, "https://outro.site"), ENV, vi.fn());
    expect(response.status).toBe(403);
  });

  it("troca o código OAuth com o client secret, sem expô-lo", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { access_token: "tok", expires_in: 3600, refresh_token: "nao-sai" }));
    const response = await handle(
      request({ op: "exchange", code: "c", code_verifier: "v", redirect_uri: "https://grupo.github.io/nova-nuvem" }),
      ENV,
      fetchImpl,
    );
    expect(await response.json()).toEqual({ access_token: "tok", expires_in: 3600 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.supabase.com/v1/oauth/token");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("client:secret")}`);
  });

  it("não troca código para redirecionamento de outro site", async () => {
    const fetchImpl = vi.fn();
    const response = await handle(
      request({ op: "exchange", code: "c", code_verifier: "v", redirect_uri: "https://evil.example/cb" }),
      ENV,
      fetchImpl,
    );
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aplica o schema numa requisição só e recusa ref malformado", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, []));
    expect((await handle(request({ op: "schema", token: "t", ref: "curto", sql: "select 1" }), ENV, fetchImpl)).status).toBe(400);
    const response = await handle(request({ op: "schema", token: "t", ref: REF, sql: "select 1" }), ENV, fetchImpl);
    expect(response.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.supabase.com/v1/projects/${REF}/database/query`);
    expect(JSON.parse(String(init.body))).toEqual({ query: "select 1" });
  });

  it("configura o login por código de 6 dígitos apontando para o próprio site", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    const bad = await handle(
      request({ op: "auth", token: "t", ref: REF, site_url: "https://evil.example", redirect: "https://evil.example/**" }),
      ENV,
      fetchImpl,
    );
    expect(bad.status).toBe(400);
    const ok = await handle(
      request({ op: "auth", token: "t", ref: REF, site_url: "https://grupo.github.io", redirect: "https://grupo.github.io/**" }),
      ENV,
      fetchImpl,
    );
    expect(ok.status).toBe(200);
    const payload = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(payload.mailer_otp_length).toBe(6);
    expect(payload.mailer_templates_magic_link_content).toContain("{{ .Token }}");
    expect(payload.mailer_templates_confirmation_content).toContain("{{ .Token }}");
  });

  it("devolve só a chave pública do projeto", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, [
        { name: "anon", type: "legacy", api_key: "anon-key" },
        { name: "service_role", type: "legacy", api_key: "SEGREDO" },
        { name: "default", type: "secret", api_key: "SEGREDO2" },
      ]),
    );
    const response = await handle(request({ op: "keys", token: "t", ref: REF }), ENV, fetchImpl);
    const body = await response.json();
    expect(body).toEqual({ key: "anon-key", url: `https://${REF}.supabase.co` });
    expect(JSON.stringify(body)).not.toContain("SEGREDO");
  });

  it("publica a Edge Function actions por multipart", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { slug: "actions" }));
    const response = await handle(request({ op: "deploy", token: "t", ref: REF, code: "export {}" }), ENV, fetchImpl);
    expect(response.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=actions`);
    expect(init.body).toBeInstanceOf(FormData);
    expect(JSON.parse(String((init.body as FormData).get("metadata")))).toMatchObject({ name: "actions", verify_jwt: true });
  });

  it("consultas de leitura são fixas, não vêm da página", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [{ versions: ["001", "002"] }]));
    const response = await handle(request({ op: "applied", token: "t", ref: REF, sql: "DROP TABLE x" }), ENV, fetchImpl);
    expect(await response.json()).toEqual({ versions: ["001", "002"] });
    const sent = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).query;
    expect(sent).not.toContain("DROP");
  });

  it("aceita endereço sob as origens permitidas", () => {
    const allowed = ["https://grupo.github.io"];
    expect(underAllowed("https://grupo.github.io/dataframeitGUI/nova-nuvem", allowed)).toBe(true);
    expect(underAllowed("https://grupo.github.io.evil.example/x", allowed)).toBe(false);
    expect(underAllowed("https://grupo.github.io/a,https://evil.example", allowed)).toBe(false);
    expect(publicKeyOf([{ type: "publishable", api_key: "pk" }])).toBe("pk");
  });
});
