// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
vi.mock("@/static/runtime/supabase", () => ({
  getAccessToken: async () => "jwt",
  getSupabase: () => ({
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

const { callBackend } = await import("@/static/llm/worker-client");

afterEach(() => {
  vi.unstubAllGlobals();
  maybeSingle.mockReset();
});

describe("rotas do backend Python no navegador", () => {
  it("recusa rota que não existe no modo estático", async () => {
    expect(await callBackend("POST", "/llm/desconhecida", {})).toEqual({
      ok: false,
      status: 404,
      detail: "Rota /llm/desconhecida não existe no modo estático.",
    });
  });

  it("explica que rodar o LLM exige JSPI quando o navegador não tem", async () => {
    vi.stubGlobal("WebAssembly", { ...WebAssembly, Suspending: undefined });
    const result = await callBackend("POST", "/llm/run", { project_id: "p" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.detail).toMatch(/JSPI \(Chrome ou Edge/);
  });

  it("status de rodada de outra aba vem de llm_runs no formato do runner", async () => {
    maybeSingle.mockResolvedValue({
      data: { status: "running", phase: "processing", progress: 3, total: 10, error_message: null, processed_complete: 2 },
      error: null,
    });
    const result = await callBackend("GET", "/llm/status/11111111-1111-4111-8111-111111111111", undefined);
    expect(result).toMatchObject({
      ok: true,
      data: { status: "running", phase: "processing", progress: 3, total: 10, errors: [], processed_complete: 2, eta_seconds: null },
    });
  });

  it("job inexistente segue o contrato do backend (Job not found)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await callBackend("GET", "/llm/status/11111111-1111-4111-8111-111111111112", undefined);
    expect(result).toMatchObject({ ok: true, data: { errors: ["Job not found"] } });
  });
});
