// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildTeamLink, isValidSupabaseUrl, parseTeamLink } from "@/static/runtime/connection";
import { describeAuthError, safeNextPath } from "@/static/screens/LoginScreen";

describe("link para a equipe", () => {
  it("faz ida e volta com URL, chave e nome do grupo", () => {
    const link = buildTeamLink("https://grupo.github.io/dataframeitGUI/", {
      url: "https://abcd.supabase.co",
      anonKey: "eyJ.chave.anon",
      name: "Grupo de Direito & Dados",
    });
    expect(link.startsWith("https://grupo.github.io/dataframeitGUI/conectar#")).toBe(true);
    expect(parseTeamLink(new URL(link).hash)).toEqual({
      url: "https://abcd.supabase.co",
      anonKey: "eyJ.chave.anon",
      name: "Grupo de Direito & Dados",
    });
  });

  it("recusa link sem chave ou com URL que não é https", () => {
    expect(parseTeamLink("#url=https://abcd.supabase.co")).toBeNull();
    expect(parseTeamLink("#url=http://abcd.supabase.co&key=x")).toBeNull();
    expect(parseTeamLink("#url=javascript:alert(1)&key=x")).toBeNull();
  });

  it("aceita http só para o Supabase local", () => {
    expect(isValidSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isValidSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isValidSupabaseUrl("http://exemplo.com")).toBe(false);
  });
});

describe("login por código", () => {
  it("só redireciona para caminhos internos", () => {
    expect(safeNextPath("/projects/1/code")).toBe("/projects/1/code");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
  });

  it("traduz os erros do Supabase Auth em mensagens acionáveis", () => {
    expect(describeAuthError("Signups not allowed for otp")).toMatch(/coordenador/);
    expect(describeAuthError("Token has expired or is invalid")).toMatch(/Código inválido/);
    expect(describeAuthError("For security purposes, you can only request this after 30 seconds"))
      .toMatch(/Aguarde/);
    expect(describeAuthError("outro erro")).toBe("outro erro");
  });
});
