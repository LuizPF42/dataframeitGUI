// Consolida as migrations para a instalação de uma nuvem nova do modo estático.
//
// Saída em out/schema/:
//   schema.sql       — todas as migrations, em ordem, numa transação só, mais o
//                      registro em supabase_migrations.schema_migrations (o
//                      mesmo do `supabase db push`, para que atualizações
//                      futuras saibam o que já foi aplicado) e o modo nativo
//                      ligado (instance_settings.native_supabase_auth).
//   migrations.json  — [{ version, name, sql }], para o assistente aplicar só o
//                      que falta numa nuvem já instalada.
//
// As migrations continuam sendo a fonte (o modo hospedado segue com
// `supabase db push`). `BEGIN;`/`COMMIT;` de topo são retirados: a Management
// API do Supabase executa cada requisição numa transação, e um COMMIT no meio
// quebraria a atomicidade da instalação.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = path.join(frontendDir, "supabase/migrations");
const outDir = path.join(frontendDir, "out/schema");

const TOP_LEVEL_TX = /^\s*(BEGIN|COMMIT)\s*;\s*(--.*)?$/gim;

export function stripTopLevelTransactions(sql) {
  return sql.replace(TOP_LEVEL_TX, "-- (transação da migration incorporada à da instalação)");
}

export function readMigrations(dir = migrationsDir) {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const base = file.replace(/\.sql$/, "");
      const cut = base.indexOf("_");
      return {
        version: cut === -1 ? base : base.slice(0, cut),
        name: cut === -1 ? base : base.slice(cut + 1),
        sql: stripTopLevelTransactions(readFileSync(path.join(dir, file), "utf8")),
      };
    });
}

const quote = (text) => `'${text.replace(/'/g, "''")}'`;

export const MIGRATIONS_TABLE_SQL = `CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);`;

export function recordMigrationsSql(migrations) {
  if (!migrations.length) return "";
  return (
    "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES\n" +
    migrations.map((m) => `  (${quote(m.version)}, ${quote(m.name)})`).join(",\n") +
    "\nON CONFLICT (version) DO NOTHING;"
  );
}

export const ENABLE_NATIVE_SQL =
  "UPDATE public.instance_settings SET native_supabase_auth = true, updated_at = now() WHERE singleton;";

export function buildSchema(migrations) {
  const parts = [
    "-- dataframeit — instalação do modo estático (gerado por scripts/static/build-schema.mjs).",
    `-- ${migrations.length} migrations, de ${migrations[0]?.version} a ${migrations.at(-1)?.version}.`,
    MIGRATIONS_TABLE_SQL,
  ];
  for (const migration of migrations) {
    parts.push(`\n-- ===== ${migration.version}_${migration.name} =====\n${migration.sql}`);
  }
  parts.push(recordMigrationsSql(migrations), ENABLE_NATIVE_SQL, "");
  return parts.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const migrations = readMigrations();
  const schema = buildSchema(migrations);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "schema.sql"), schema);
  writeFileSync(path.join(outDir, "migrations.json"), JSON.stringify(migrations));
  console.log(`schema.sql: ${migrations.length} migrations, ${Math.round(schema.length / 1024)} kB`);
}
