// Postgres local sem Docker para as suítes SQL do dataframeitGUI.
// uso: node db.mjs start | stop | build <migrationsDir> [extra.sql...] | test <file.sql...> | sql <db> <file.sql>
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const platform = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform] ?? process.platform;
const bin = path.join(here, `node_modules/@embedded-postgres/${platform}-${process.arch}/native/bin`);
const exe = (name) => path.join(bin, process.platform === "win32" ? `${name}.exe` : name);
const data = path.join(here, "data");
const PORT = Number(process.env.PGPORT_LOCAL ?? 54329);
const conn = (database) =>
  new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database });

// Divide um script como o psql: respeita strings, identificadores entre aspas,
// dollar quotes e comentários; linha que começa com barra invertida é meta-comando.
export function splitSql(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  const BS = String.fromCharCode(92);
  while (i < n) {
    const c = sql[i];
    const c2 = sql.slice(i, i + 2);
    if (c === BS && cur.trim() === "") {
      const end = sql.indexOf("\n", i);
      const j = end === -1 ? n : end;
      out.push({ meta: sql.slice(i, j).trim() });
      cur = "";
      i = j + 1;
      continue;
    }
    if (c2 === "--") {
      const end = sql.indexOf("\n", i);
      const j = end === -1 ? n : end;
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c2 === "/*") {
      let depth = 0;
      let j = i;
      do {
        if (sql.slice(j, j + 2) === "/*") { depth++; j += 2; }
        else if (sql.slice(j, j + 2) === "*/") { depth--; j += 2; }
        else j++;
      } while (depth > 0 && j < n);
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      const esc = /[eE]$/.test(cur);
      let j = i + 1;
      while (j < n) {
        if (esc && sql[j] === BS) { j += 2; continue; }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m && !/[A-Za-z0-9_]$/.test(cur)) {
        const tag = m[0];
        const j = sql.indexOf(tag, i + tag.length);
        const end = j === -1 ? n : j + tag.length;
        cur += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    if (c === ";") {
      if (cur.trim()) out.push({ sql: cur + ";" });
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.replace(/--[^\n]*/g, "").trim()) out.push({ sql: cur });
  return out;
}

async function run(database, sql) {
  const c = conn(database);
  await c.connect();
  try { await c.query(sql); } finally { await c.end().catch(() => {}); }
}

async function runScript(database, sql) {
  const c = conn(database);
  const notices = [];
  c.on("notice", (n) => notices.push(n.message));
  c.on("error", () => {});
  await c.connect();
  try {
    for (const st of splitSql(sql)) {
      if (st.meta) {
        if (st.meta.startsWith(String.fromCharCode(92) + "echo")) notices.push(st.meta.slice(5).trim());
        continue;
      }
      await c.query(st.sql);
    }
  } finally { await c.end().catch(() => {}); }
  return notices;
}

async function admin(...stmts) {
  for (const s of stmts) await run("postgres", s);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "start") {
  if (!existsSync(data)) {
    execFileSync(exe("initdb"), ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"], { stdio: "inherit" });
  }
  // pg_ctl herda os handles; desacoplado para o processo pai poder sair.
  const p = spawn(exe("pg_ctl"), ["-D", data, "-l", path.join(here, "pg.log"), "-o", `-p ${PORT} -c max_connections=200 -c fsync=off`, "start"], { detached: true, stdio: "ignore" });
  p.unref();
  for (let k = 0; k < 60; k++) {
    try { await run("postgres", "SELECT 1"); console.log(`ok: postgres em 127.0.0.1:${PORT}`); process.exit(0); }
    catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  console.error("postgres não respondeu"); process.exit(1);
} else if (cmd === "stop") {
  execFileSync(exe("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "inherit" });
} else if (cmd === "build") {
  const [dir, ...extra] = args;
  const target = process.env.BASE_DB ?? "base";
  await admin(`UPDATE pg_database SET datistemplate = false WHERE datname = '${target}'`, `DROP DATABASE IF EXISTS ${target} WITH (FORCE)`, `CREATE DATABASE ${target}`);
  await run(target, readFileSync(path.join(here, "supabase-shim.sql"), "utf8"));
  await run(target, `ALTER ROLE postgres SET search_path TO "$user", public, extensions; ALTER ROLE authenticated SET search_path TO "$user", public, extensions; ALTER ROLE anon SET search_path TO "$user", public, extensions; ALTER ROLE service_role SET search_path TO "$user", public, extensions;`);
  const migs = dir && statSync(dir).isDirectory()
    ? readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(dir, f))
    : dir ? [dir] : [];
  const files = migs.concat(extra);
  for (const f of files) {
    try { await runScript(target, readFileSync(f, "utf8")); }
    catch (e) { console.error(`FALHOU em ${path.basename(f)}: ${e.message}`); process.exit(1); }
  }
  await admin(`UPDATE pg_database SET datistemplate = true WHERE datname = '${target}'`);
  console.log(`ok: ${files.length} arquivos aplicados em ${target}`);
} else if (cmd === "test") {
  const base = process.env.BASE_DB ?? "base";
  let failed = 0;
  for (const f of args) {
    const db = "t_" + path.basename(f).replace(/\W/g, "_").slice(0, 50).toLowerCase();
    await admin(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`, `CREATE DATABASE ${db} TEMPLATE ${base}`);
    const t0 = Date.now();
    try {
      await runScript(db, readFileSync(f, "utf8"));
      console.log(`PASS ${path.basename(f)} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${path.basename(f)}: ${e.message}${e.where ? "\n     " + e.where.split("\n")[0] : ""}`);
    }
    await admin(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  }
  console.log(`${args.length - failed}/${args.length} suítes passaram`);
  process.exit(failed ? 1 : 0);
} else if (cmd === "sql") {
  const notices = await runScript(args[0], readFileSync(args[1], "utf8"));
  for (const n of notices) console.log("NOTICE:", n);
} else {
  console.error("uso: start | stop | build <dir> [extra...] | test <files...> | sql <db> <file>");
  process.exit(2);
}
