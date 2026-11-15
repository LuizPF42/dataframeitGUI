// `/nova-nuvem`: cria (ou atualiza) a nuvem do grupo — um projeto Supabase na
// conta do próprio coordenador, com o schema do dataframeit, a Edge Function
// `actions` e o login por código. Ao fim entrega o link para a equipe.

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildTeamLink, saveConnection, type Connection } from "@/static/runtime/connection";
import { navigate } from "@/static/runtime/navigation";
import { AuthShell } from "@/static/screens/AuthShell";
import {
  finishOAuth,
  loadActionsBundle,
  loadInstallSql,
  loadMigrations,
  pendingMigrationsSql,
  readSetupConfig,
  setupCall,
  siteRoot,
  startOAuth,
  verifyProblems,
  type SetupConfig,
  type VerifyReport,
} from "@/static/setup/setup-client";

const REGIONS: { code: string; label: string }[] = [
  { code: "sa-east-1", label: "São Paulo (sa-east-1)" },
  { code: "us-east-1", label: "Virgínia, EUA (us-east-1)" },
  { code: "eu-west-1", label: "Irlanda (eu-west-1)" },
  { code: "eu-central-1", label: "Frankfurt (eu-central-1)" },
];

type StepState = "pending" | "running" | "done" | "failed";
interface Step {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
}

const INSTALL_STEPS: Omit<Step, "state">[] = [
  { id: "wait", label: "Aguardar o projeto ficar pronto" },
  { id: "schema", label: "Instalar o banco do dataframeit" },
  { id: "functions", label: "Publicar a Edge Function de ações" },
  { id: "auth", label: "Configurar o login por código" },
  { id: "keys", label: "Obter o endereço e a chave pública" },
  { id: "verify", label: "Verificar a instalação" },
];

const STATE_LABEL: Record<StepState, string> = {
  pending: "",
  running: " (em andamento)",
  done: " (concluído)",
  failed: " (falhou)",
};
const STATE_MARK: Record<StepState, string> = { pending: "·", running: "…", done: "✓", failed: "✗" };

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

function ManualSetup() {
  return (
    <AuthShell title="Criar a nuvem do grupo" wide>
      <div className="space-y-3 text-sm">
        <p>
          Este site foi publicado sem o serviço de configuração automática. A instalação manual leva
          poucos minutos:
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Crie um projeto em supabase.com (o plano gratuito serve; região São Paulo).</li>
          <li>
            No SQL Editor do projeto, cole e execute o arquivo{" "}
            <a className="underline" href={`${siteRoot()}/schema/schema.sql`}>
              schema.sql
            </a>{" "}
            deste site.
          </li>
          <li>
            Publique a Edge Function <code>actions</code>: salve{" "}
            <a className="underline" href={`${siteRoot()}/edge/actions/index.js`}>
              actions/index.js
            </a>{" "}
            como <code>supabase/functions/actions/index.ts</code> e rode{" "}
            <code>npx supabase functions deploy actions --project-ref SEU_REF</code>.
          </li>
          <li>
            Em Authentication → Email Templates, troque o link pelo código <code>{"{{ .Token }}"}</code> nos
            modelos “Magic Link” e “Confirm signup”. Em URL Configuration, use o endereço deste site.
          </li>
          <li>
            Em Settings → API, copie a URL e a chave <em>anon</em> e use-as em{" "}
            <a className="underline" href={`${siteRoot()}/conectar`}>
              Conectar
            </a>
            .
          </li>
        </ol>
      </div>
    </AuthShell>
  );
}

export function SetupWizard() {
  const config = readSetupConfig();
  if (!config) return <ManualSetup />;
  return <Wizard config={config} />;
}

function Wizard({ config }: { config: SetupConfig }) {
  const nameId = useId();
  const orgId = useId();
  const regionId = useId();
  const groupId = useId();
  const inviteId = useId();
  const projectId = useId();
  const [phase, setPhase] = useState<"start" | "auth" | "form" | "install" | "done">("start");
  const [mode, setMode] = useState<"create" | "update">("create");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ ref: string; name: string; status: string }[]>([]);
  const [org, setOrg] = useState("");
  const [projectName, setProjectName] = useState("dataframeit");
  const [region, setRegion] = useState("sa-east-1");
  const [groupName, setGroupName] = useState("");
  const [inviteOnly, setInviteOnly] = useState(true);
  const [existingRef, setExistingRef] = useState("");
  const [dbPass, setDbPass] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [connection, setConnection] = useState<Connection | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fail = (err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    };
    finishOAuth(config).then(async (result) => {
      if (!result || cancelled) return;
      setToken(result.token);
      setMode(result.mode);
      setPhase("auth");
      try {
        if (result.mode === "create") {
          const { orgs: list } = await setupCall<{ orgs: { slug: string; name: string }[] }>(config, {
            op: "orgs",
            token: result.token,
          });
          setOrgs(list);
          setOrg(list[0]?.slug ?? "");
        } else {
          const { projects: list } = await setupCall<{ projects: { ref: string; name: string; status: string }[] }>(
            config,
            { op: "projects", token: result.token },
          );
          setProjects(list);
          setExistingRef(list[0]?.ref ?? "");
        }
        if (!cancelled) setPhase("form");
      } catch (err) {
        fail(err);
      }
    }, fail);
    return () => {
      cancelled = true;
    };
  }, [config]);

  function mark(id: string, state: StepState, detail?: string) {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, state, detail } : step)));
  }

  async function install(ref: string, creating: boolean) {
    if (!token) return;
    setPhase("install");
    setError(null);
    setSteps(INSTALL_STEPS.map((step) => ({ ...step, state: "pending" })));
    const call = <T,>(body: Record<string, unknown>) => setupCall<T>(config, { token, ref, ...body });
    let current = "wait";
    try {
      mark("wait", "running");
      for (let attempt = 0; ; attempt++) {
        const { status } = await call<{ status: string }>({ op: "status" });
        if (status === "ACTIVE_HEALTHY") break;
        if (attempt >= 119) throw new Error(`O projeto não ficou pronto (status ${status}).`);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      mark("wait", "done");

      current = "schema";
      mark("schema", "running");
      const migrations = await loadMigrations();
      if (creating) {
        await call({ op: "schema", sql: await loadInstallSql() });
        mark("schema", "done", `${migrations.length} migrations aplicadas numa transação.`);
      } else {
        const { versions } = await call<{ versions: string[] }>({ op: "applied" });
        const pending = pendingMigrationsSql(migrations, versions);
        if (pending.count) await call({ op: "schema", sql: pending.sql });
        mark("schema", "done", pending.count ? `${pending.count} migrations novas aplicadas.` : "Banco já atualizado.");
      }

      current = "functions";
      mark("functions", "running");
      await call({ op: "deploy", code: await loadActionsBundle() });
      mark("functions", "done");

      current = "auth";
      mark("auth", "running");
      await call({ op: "auth", site_url: siteRoot(), redirect: `${siteRoot()}/**`, invite_only: inviteOnly });
      mark("auth", "done", inviteOnly ? "Só e-mails cadastrados pelo coordenador entram." : "Qualquer e-mail pode criar conta.");

      current = "keys";
      mark("keys", "running");
      const { url, key } = await call<{ url: string; key: string | null }>({ op: "keys" });
      if (!key) throw new Error("O projeto não devolveu chave pública.");
      mark("keys", "done");

      current = "verify";
      mark("verify", "running");
      const { report } = await call<{ report: VerifyReport | null }>({ op: "verify" });
      const problems = verifyProblems(report, migrations.length);
      if (problems.length) throw new Error(problems.join(" "));
      mark("verify", "done", "RLS em todas as tabelas, modo nativo ligado, funções presentes.");

      const result: Connection = { url, anonKey: key, name: groupName.trim() || undefined };
      saveConnection(result);
      setConnection(result);
      setPhase("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mark(current, "failed", message);
      setError(message);
    }
  }

  async function createProject() {
    if (!token) return;
    setError(null);
    try {
      const created = await setupCall<{ ref: string; db_pass: string }>(config, {
        op: "create",
        token,
        org,
        name: projectName.trim(),
        region,
      });
      setDbPass(created.db_pass);
      await install(created.ref, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (phase === "done" && connection) {
    const link = buildTeamLink(siteRoot(), connection);
    return (
      <AuthShell title="Nuvem do grupo pronta" wide>
        <div className="space-y-4 text-sm">
          <p>Envie este link aos pesquisadores. Ao abri-lo, o navegador se conecta à nuvem do grupo.</p>
          <div className="flex gap-2">
            <Input readOnly value={link} aria-label="Link para a equipe" />
            <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(link)}>
              Copiar
            </Button>
          </div>
          {dbPass ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
              Senha do banco (mostrada só agora; guarde num gerenciador de senhas): <code>{dbPass}</code>
            </p>
          ) : null}
          <p className="text-muted-foreground">
            No plano gratuito o Supabase pausa projetos sem uso por uma semana e limita os e-mails de login a
            poucos por hora. Para um grupo grande, configure um SMTP próprio em Authentication → SMTP.
          </p>
          <Button type="button" onClick={() => navigate("/auth/login", { replace: true })}>
            Entrar
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={mode === "update" && phase !== "start" ? "Atualizar a nuvem do grupo" : "Criar a nuvem do grupo"}
      subtitle="O projeto fica na sua conta do Supabase. Os dados da pesquisa vão direto do navegador para ele."
      wide
    >
      {phase === "start" ? (
        <div className="space-y-4 text-sm">
          <p>
            Você vai entrar no supabase.com e autorizar este assistente a criar um projeto na sua conta,
            instalar o banco do dataframeit e configurar o login por código.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void startOAuth(config, "create")}>
              Criar nuvem nova
            </Button>
            <Button type="button" variant="outline" onClick={() => void startOAuth(config, "update")}>
              Atualizar nuvem existente
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "auth" ? <p className="text-sm text-muted-foreground">Conectando ao Supabase…</p> : null}

      {phase === "form" && mode === "create" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createProject();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={orgId}>Organização</Label>
              <select id={orgId} className={selectClass} value={org} onChange={(event) => setOrg(event.target.value)}>
                {orgs.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={regionId}>Região</Label>
              <select id={regionId} className={selectClass} value={region} onChange={(event) => setRegion(event.target.value)}>
                {REGIONS.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={nameId}>Nome do projeto no Supabase</Label>
              <Input id={nameId} value={projectName} maxLength={64} onChange={(event) => setProjectName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={groupId}>Nome do grupo (aparece no login)</Label>
              <Input id={groupId} value={groupName} maxLength={80} onChange={(event) => setGroupName(event.target.value)} />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id={inviteId} checked={inviteOnly} onCheckedChange={(value) => setInviteOnly(value === true)} />
            <Label htmlFor={inviteId} className="text-sm font-normal leading-snug">
              Só entra quem o coordenador cadastrar (recomendado). Sem isto, qualquer pessoa com o link cria
              conta — sem ver projeto algum, mas ocupando a cota do plano.
            </Label>
          </div>
          <Button type="submit" disabled={!org || !projectName.trim()}>
            Criar e instalar
          </Button>
        </form>
      ) : null}

      {phase === "form" && mode === "update" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void install(existingRef, false);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={projectId}>Projeto</Label>
            <select
              id={projectId}
              className={selectClass}
              value={existingRef}
              onChange={(event) => setExistingRef(event.target.value)}
            >
              {projects.map((item) => (
                <option key={item.ref} value={item.ref}>
                  {item.name} ({item.ref})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id={inviteId} checked={inviteOnly} onCheckedChange={(value) => setInviteOnly(value === true)} />
            <Label htmlFor={inviteId} className="text-sm font-normal leading-snug">
              Só entra quem o coordenador cadastrar.
            </Label>
          </div>
          <Button type="submit" disabled={!existingRef}>
            Atualizar
          </Button>
        </form>
      ) : null}

      {phase === "install" ? (
        <ol className="space-y-2 text-sm" aria-live="polite">
          {steps.map((step) => (
            <li key={step.id} className="flex gap-2">
              <span aria-hidden className="w-4">
                {STATE_MARK[step.state]}
              </span>
              <span>
                {step.label}
                <span className="sr-only">{STATE_LABEL[step.state]}</span>
                {step.detail ? <span className="block text-xs text-muted-foreground">{step.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </AuthShell>
  );
}
