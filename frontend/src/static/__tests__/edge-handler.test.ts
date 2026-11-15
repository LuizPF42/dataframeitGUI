import type { User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { currentContext } from "@/static/edge/context";
import { createActionHandler, GENERIC_FAILURE } from "@/static/edge/handler";
import { revalidatePath } from "@/static/edge/next-cache";
import { cache } from "@/static/edge/request-cache";
import { RedirectSignal } from "@/static/runtime/control-flow";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "a@example.test" } as User;

function request(body: unknown, token: string | null = "jwt-ok", method = "POST") {
  return new Request("https://edge.test/functions/v1/actions", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function handlerWith(registry: Record<string, Record<string, unknown>>) {
  const getUser = vi.fn(async (token: string) => (token === "jwt-ok" ? USER : null));
  const waitUntil = vi.fn();
  return { handle: createActionHandler(registry, { getUser, waitUntil }), getUser, waitUntil };
}

describe("Edge Function actions", () => {
  it("responde ao preflight de CORS", async () => {
    const { handle } = handlerWith({});
    const response = await handle(new Request("https://edge.test", { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("authorization");
  });

  it("exige JWT válido antes de olhar o corpo", async () => {
    const action = vi.fn();
    const { handle } = handlerWith({ members: { addMember: action } });
    expect((await handle(request({ module: "members", name: "addMember", args: [] }, null))).status).toBe(401);
    expect((await handle(request({ module: "members", name: "addMember", args: [] }, "forjado"))).status).toBe(401);
    expect(action).not.toHaveBeenCalled();
  });

  it("só executa actions registradas, nem herdadas do protótipo", async () => {
    const { handle } = handlerWith({ members: { addMember: vi.fn() } });
    for (const [module, name] of [
      ["members", "naoExiste"],
      ["outro", "addMember"],
      ["members", "constructor"],
      ["members", "__proto__"],
      ["__proto__", "toString"],
      ["members", "hasOwnProperty"],
    ]) {
      const response = await handle(request({ module, name, args: [] }));
      expect(response.status, `${module}.${name}`).toBe(404);
    }
    expect((await handle(request({ module: "members", name: "addMember", args: "x" }))).status).toBe(400);
  });

  it("executa a action com o usuário do JWT no contexto e devolve a revalidação", async () => {
    const seen: unknown[] = [];
    const { handle } = handlerWith({
      members: {
        async addMember(projectId: string, email: string) {
          seen.push(currentContext().user.id, currentContext().token, projectId, email);
          revalidatePath(`/projects/${projectId}`);
          return { ok: true };
        },
      },
    });
    const response = await handle(request({ module: "members", name: "addMember", args: ["p1", "x@y.z"] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { ok: true }, revalidated: true });
    expect(seen).toEqual([USER.id, "jwt-ok", "p1", "x@y.z"]);
  });

  it("isola a memória de cache() entre requisições concorrentes", async () => {
    let counter = 0;
    const whoAmI = cache(async () => {
      counter += 1;
      return `${currentContext().token}-${counter}`;
    });
    const getUser = async (token: string) => ({ ...USER, id: token }) as User;
    const handle = createActionHandler(
      {
        m: {
          async run() {
            const first = await whoAmI();
            const second = await whoAmI();
            return [first, second];
          },
        },
      },
      { getUser },
    );
    const [a, b] = await Promise.all([
      handle(request({ module: "m", name: "run", args: [] }, "token-a")).then((r) => r.json()),
      handle(request({ module: "m", name: "run", args: [] }, "token-b")).then((r) => r.json()),
    ]);
    expect(a.result[0]).toBe(a.result[1]);
    expect(b.result[0]).toBe(b.result[1]);
    expect(a.result[0]).toMatch(/^token-a-/);
    expect(b.result[0]).toMatch(/^token-b-/);
  });

  it("esconde o detalhe da exceção e trata redirect como sucesso", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handle } = handlerWith({
      m: {
        async boom() {
          throw new Error("detalhe interno com dado sensível");
        },
        async go() {
          throw new RedirectSignal("/dashboard");
        },
      },
    });
    const failed = await handle(request({ module: "m", name: "boom", args: [] }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: GENERIC_FAILURE, revalidated: false });

    const redirected = await handle(request({ module: "m", name: "go", args: [] }));
    expect(await redirected.json()).toEqual({ ok: true, result: null, redirect: "/dashboard", revalidated: false });
    consoleError.mockRestore();
  });
});
