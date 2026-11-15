import { describe, expect, it } from "vitest";
import { matchRoute, routes } from "@/static/runtime/routes";

describe("tabela de rotas do modo estático", () => {
  it("deriva as rotas da árvore src/app sem os grupos entre parênteses", () => {
    const match = matchRoute("/dashboard");
    expect(match?.route.dir).toBe("/(app)/dashboard");
    expect(match?.params).toEqual({});
  });

  it("captura o parâmetro dinâmico e monta a cadeia de layouts", () => {
    const match = matchRoute("/projects/abc-123/code");
    expect(match?.route.dir).toBe("/(app)/projects/[id]/code");
    expect(match?.params).toEqual({ id: "abc-123" });
    expect(match?.route.layouts.map((layout) => layout.dir)).toEqual([
      "/(app)",
      "/(app)/projects/[id]",
    ]);
    expect(match?.route.loading).not.toBeNull();
  });

  it("prefere o segmento estático ao dinâmico", () => {
    expect(matchRoute("/projects/new")?.route.dir).toBe("/(app)/projects/new");
  });

  it("decodifica o segmento da URL", () => {
    expect(matchRoute("/projects/a%20b")?.params).toEqual({ id: "a b" });
  });

  it("deixa de fora o login do Clerk e os route handlers", () => {
    expect(matchRoute("/auth/login")).toBeNull();
    expect(matchRoute("/auth/post-login")).toBeNull();
    expect(matchRoute("/api/health")).toBeNull();
    expect(routes.some((route) => route.dir.startsWith("/auth") || route.dir.startsWith("/api"))).toBe(false);
  });

  it("devolve null para caminho desconhecido", () => {
    expect(matchRoute("/nao-existe")).toBeNull();
    expect(matchRoute("/projects/abc/nao-existe")).toBeNull();
  });

  it("mapeia a raiz para a página que redireciona ao dashboard", () => {
    expect(matchRoute("/")?.route.dir).toBe("");
  });
});
