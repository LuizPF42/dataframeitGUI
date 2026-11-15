import path from "node:path";
import { describe, expect, it } from "vitest";
import { findPrivilegedActions } from "../../../scripts/static/privileged-actions.mjs";

describe("divisão das actions entre navegador e Edge Function", () => {
  it("manda para a Edge Function só os módulos que alcançam a service role", async () => {
    const privileged = (await findPrivilegedActions(path.resolve(process.cwd(), "src"))) as Record<
      string,
      string[]
    >;
    // Usam a service role hoje (gestão de equipe, efeitos automáticos de
    // comparação/auto-revisão e materialização de assignments para terceiros).
    for (const moduleName of ["members", "field-reviews", "comparisons", "equivalences", "responses"]) {
      expect(Object.keys(privileged)).toContain(moduleName);
    }
    // Rodam no navegador com o JWT do usuário: a RLS é a fronteira.
    for (const moduleName of ["projects", "documents", "schema", "llm", "assignments", "stats", "export"]) {
      expect(Object.keys(privileged)).not.toContain(moduleName);
    }
    expect(privileged.members).toContain("addMember");
  }, 30_000);
});
