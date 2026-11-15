// "Criar a nuvem do grupo" — a única peça de servidor do assistente do modo
// estático. Desenho e medições herdados do QualiLab (supabase/functions/
// server-setup), que mediu em out/2026:
//
// - O Supabase não responde CORS fora de supabase.com no endpoint de token
//   OAuth nem na Management API; e a troca do código exige o CLIENT SECRET do
//   app OAuth, que não pode morar numa página. Por isso estas chamadas — e só
//   elas — passam por esta função.
// - Uma requisição a /database/query é uma transação: um erro no fim desfaz
//   tudo (183 KB, 3.004 comandos). O schema do dataframeit (≈ 0,9 MB) vai inteiro
//   numa requisição.
//
// O QUE PASSA AQUI: por chamada, um token de curta duração que a pessoa
// concedeu no supabase.com. Nada é guardado nem registrado. A lista de
// operações é fixa (a página nomeia a operação, nunca um caminho da API). Os
// dados de pesquisa nunca passam aqui: o projeto é criado na conta do próprio
// grupo e o navegador fala direto com ele. Chaves secretas (service_role) são
// filtradas aqui e não chegam ao navegador.
//
// JavaScript puro de propósito: index.ts (Deno) importa, e o Vitest testa com
// fetch falso.

const API = "https://api.supabase.com";
const SETUP_REGIONS = [
  "sa-east-1", "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1", "eu-central-1", "eu-central-2",
  "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2", "ap-east-1",
];
const REF_RE = /^[a-z0-9]{20}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SQL_MAX = 2 * 1024 * 1024;
const CODE_MAX = 2 * 1024 * 1024;
const ACTIONS_FUNCTION_SLUG = "actions";

/** Consultas fixas de leitura (a página não manda SQL para estas). */
const APPLIED_MIGRATIONS_SQL =
  "SELECT coalesce(json_agg(version ORDER BY version), '[]'::json) AS versions " +
  "FROM supabase_migrations.schema_migrations";
const VERIFY_SQL = `
SELECT json_build_object(
  'native_auth', public.native_auth_enabled(),
  'tables_without_rls', (
    SELECT coalesce(json_agg(c.relname), '[]'::json)
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
  ),
  'migrations', (SELECT count(*) FROM supabase_migrations.schema_migrations),
  'publish_rpc', to_regprocedure('public.publish_llm_response_from_browser(jsonb)') IS NOT NULL,
  'identity_fn', to_regprocedure('public.clerk_uid()') IS NOT NULL
) AS report`;

/** E-mail do código de acesso (OTP de 6 dígitos, não link mágico). */
const OTP_SUBJECT = "Seu código de acesso ao dataframeit";
const OTP_TEMPLATE =
  "<h2>Código de acesso</h2>" +
  "<p>Use este código para entrar no dataframeit:</p>" +
  '<p style="font-size:24px;letter-spacing:4px"><strong>{{ .Token }}</strong></p>' +
  "<p>Ele vale por 15 minutos. Se você não pediu este código, ignore este e-mail.</p>";

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

// Um endereço é do app se for uma das origens permitidas ou estiver sob ela.
// Vírgula ou espaço são separadores na lista de redirecionamento do Supabase.
export function underAllowed(url, allowed) {
  if (/[\s,]/.test(String(url))) return false;
  try {
    const u = new URL(url);
    return (
      (u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      allowed.includes(u.origin)
    );
  } catch {
    return false;
  }
}

function reply(status, body, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function upstreamError(r) {
  let msg = "";
  try {
    const j = await r.json();
    msg = String((j && (j.message || j.error_description || j.error)) || "");
  } catch {
    // corpo sem JSON
  }
  return { error: "upstream", status: r.status, message: msg.slice(0, 300) };
}

export function publicKeyOf(list) {
  const arr = Array.isArray(list) ? list : [];
  const anon = arr.find((k) => k && k.name === "anon" && (k.type === "legacy" || k.type == null));
  const pub = arr.find((k) => k && k.type === "publishable");
  return (anon && anon.api_key) || (pub && pub.api_key) || null;
}

export async function handle(req, env, fetchImpl) {
  const f = fetchImpl || fetch;
  const allowed = allowedOrigins(env);
  const origin = req.headers.get("origin") || "";
  const ok = allowed.includes(origin);
  const cors = ok
    ? {
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      }
    : {};
  if (req.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers: cors });
  if (!ok) return reply(403, { error: "origin" }, cors);
  if (req.method !== "POST") return reply(405, { error: "method" }, cors);
  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "json" }, cors);
  }
  const op = body && body.op;

  if (op === "exchange") {
    // Prefixo DFIT_: o painel recusa segredos com prefixo SUPABASE_.
    if (!env.DFIT_OAUTH_CLIENT_ID || !env.DFIT_OAUTH_CLIENT_SECRET) return reply(500, { error: "not_configured" }, cors);
    const code = String(body.code || "");
    const verifier = String(body.code_verifier || "");
    const redirect = String(body.redirect_uri || "");
    if (!code || !verifier) return reply(400, { error: "args" }, cors);
    if (!underAllowed(redirect, allowed)) return reply(400, { error: "redirect" }, cors);
    const form = new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirect });
    const r = await f(API + "/v1/oauth/token", {
      method: "POST",
      body: form.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: "Basic " + btoa(env.DFIT_OAUTH_CLIENT_ID + ":" + env.DFIT_OAUTH_CLIENT_SECRET),
      },
    });
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    const t = await r.json();
    return reply(200, { access_token: t.access_token, expires_in: t.expires_in }, cors);
  }

  const token = String(body.token || "");
  if (!token) return reply(401, { error: "token" }, cors);
  const call = (method, path, payload, headers) =>
    f(API + path, {
      method,
      headers: { Authorization: "Bearer " + token, Accept: "application/json", ...(payload instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(headers || {}) },
      body: payload === undefined ? undefined : payload instanceof FormData ? payload : JSON.stringify(payload),
    });
  const ref = String(body.ref || "");
  const needRef = () => REF_RE.test(ref);

  if (op === "orgs") {
    const r = await call("GET", "/v1/organizations");
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    return reply(200, { orgs: (await r.json()).map((o) => ({ slug: o.slug, name: o.name })) }, cors);
  }
  if (op === "projects") {
    const r = await call("GET", "/v1/projects");
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    return reply(200, { projects: (await r.json()).map((p) => ({ ref: p.ref ?? p.id, name: p.name, status: p.status })) }, cors);
  }
  if (op === "create") {
    const name = String(body.name || "").trim();
    const org = String(body.org || "");
    const region = String(body.region || "");
    if (!name || name.length > 64 || !SLUG_RE.test(org) || !SETUP_REGIONS.includes(region)) return reply(400, { error: "args" }, cors);
    const dbPass = randomPassword();
    const r = await call("POST", "/v1/projects", {
      name,
      organization_slug: org,
      db_pass: dbPass,
      region_selection: { type: "specific", code: region },
    });
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    const p = await r.json();
    // A senha do banco é criada aqui e entregue UMA vez; nada guarda cópia.
    return reply(200, { ref: p.ref ?? p.id, status: p.status, db_pass: dbPass }, cors);
  }
  if (!needRef()) return reply(400, { error: "ref" }, cors);

  if (op === "status") {
    const r = await call("GET", "/v1/projects/" + ref);
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    return reply(200, { status: (await r.json()).status }, cors);
  }
  if (op === "schema") {
    const sql = String(body.sql || "");
    if (!sql || sql.length > SQL_MAX) return reply(400, { error: "args" }, cors);
    const r = await call("POST", "/v1/projects/" + ref + "/database/query", { query: sql });
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    return reply(200, { ok: true }, cors);
  }
  if (op === "applied" || op === "verify") {
    const r = await call("POST", "/v1/projects/" + ref + "/database/query", {
      query: op === "applied" ? APPLIED_MIGRATIONS_SQL : VERIFY_SQL,
    });
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    const rows = await r.json();
    const first = Array.isArray(rows) ? rows[0] : null;
    return reply(200, op === "applied" ? { versions: (first && first.versions) || [] } : { report: first && first.report }, cors);
  }
  if (op === "auth") {
    const site = String(body.site_url || "");
    const redirect = String(body.redirect || "");
    if (!underAllowed(site, allowed) || !underAllowed(redirect.replace(/\*+$/, ""), allowed)) return reply(400, { error: "args" }, cors);
    const r = await call("PATCH", "/v1/projects/" + ref + "/config/auth", {
      site_url: site,
      uri_allow_list: redirect,
      external_email_enabled: true,
      mailer_autoconfirm: false,
      mailer_otp_length: 6,
      mailer_otp_exp: 900,
      mailer_subjects_magic_link: OTP_SUBJECT,
      mailer_templates_magic_link_content: OTP_TEMPLATE,
      mailer_subjects_confirmation: OTP_SUBJECT,
      mailer_templates_confirmation_content: OTP_TEMPLATE,
      disable_signup: body.invite_only === true,
    });
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    return reply(200, { ok: true }, cors);
  }
  if (op === "deploy") {
    const code = String(body.code || "");
    if (!code || code.length > CODE_MAX) return reply(400, { error: "args" }, cors);
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({ entrypoint_path: "index.ts", name: ACTIONS_FUNCTION_SLUG, verify_jwt: true }),
    );
    form.append("file", new Blob([code], { type: "application/typescript" }), "index.ts");
    const r = await call("POST", "/v1/projects/" + ref + "/functions/deploy?slug=" + ACTIONS_FUNCTION_SLUG, form);
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    return reply(200, { ok: true }, cors);
  }
  if (op === "keys") {
    const r = await call("GET", "/v1/projects/" + ref + "/api-keys");
    if (!r.ok) return reply(502, await upstreamError(r), cors);
    // Chaves secretas / service_role nunca saem desta função.
    return reply(200, { key: publicKeyOf(await r.json()), url: "https://" + ref + ".supabase.co" }, cors);
  }
  return reply(400, { error: "op" }, cors);
}
