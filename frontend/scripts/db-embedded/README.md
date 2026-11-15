# Postgres local sem Docker

Roda as migrations e as suítes de `supabase/tests/` contra um Postgres 17 real
baixado como pacote npm (`embedded-postgres`), sem Docker nem Supabase CLI.
Serve para quem não pode rodar o `npx supabase start` (Windows sem WSL, CI sem
Docker) e para validar o modo estático.

`supabase-shim.sql` recria o subconjunto do Supabase que as migrations usam:
papéis `anon`/`authenticated`/`service_role`, `auth.uid()`/`auth.jwt()`/
`auth.role()`, `auth.users`, o schema `extensions` com `pgcrypto` e `dblink`, e
os privilégios default do schema `public`.

```bash
cd frontend/scripts/db-embedded
npm install
node db.mjs start                                   # porta 54329
node db.mjs build ../../supabase/migrations         # banco-modelo "base"
node db.mjs test ../../supabase/tests/*.test.sql    # cada suíte num banco novo
```

Modo estático (identidade nativa do Supabase Auth): o banco-modelo liga
`instance_settings.native_supabase_auth`, e `native-translate-fixtures.sql`
traduz os tokens das fixtures (formato Clerk: `sub` do Clerk + `supabase_uid`)
para o que o Supabase Auth emitiria para a mesma pessoa (`sub` = UUID).

```bash
BASE_DB=base_native node db.mjs build ../../supabase/migrations enable-native.sql native-translate-fixtures.sql
BASE_DB=base_native node db.mjs test ../../supabase/tests/*.test.sql
```

Limites conhecidos: não há pgTAP (as duas suítes pgTAP falham ao criar a
extensão) e `schema_revision_serialization` abre `dblink` para a porta 5432 do
banco `postgres`, fixa no arquivo.
