# Modo estático (GitHub Pages + Supabase do grupo)

Modo alternativo de publicação da GUI: um site estático no GitHub Pages e **um único serviço por grupo, um projeto Supabase do próprio grupo**. Não há Fly.io, Clerk, servidor Next nem servidor Python. O LLM roda no navegador do coordenador, com a chave dele.

O modo hospedado (dataframeit.com.br) não muda: tudo o que é específico do modo estático está em `frontend/src/static`, `frontend/scripts/static`, `frontend/supabase/functions/static-setup` e em três migrations cujo comportamento novo só liga numa instância marcada como nativa.

## Arquitetura

```
Navegador (GitHub Pages)
 ├─ SPA (Vite) que executa a mesma árvore src/app ──supabase-js + JWT do Supabase Auth──► Supabase do grupo
 │   ├─ páginas e layouts (Server Components) rodam no navegador            ├─ Postgres + RLS (schema atual)
 │   ├─ actions sem service role rodam no navegador                         ├─ Auth (e-mail com código de 6 dígitos)
 │   └─ actions com service role → Edge Function `actions` ───────────────► └─ Edge Function `actions` (mesmo código)
 └─ Web Worker com Pyodide: backend/services (llm_runner…) + adataframeit
     └─ fetch direto ao provedor de LLM com a chave do coordenador
```

### Mesmo código, infraestrutura trocada

O build estático (`vite.static.config.mts`) não reescreve páginas nem actions. Ele troca módulos de infraestrutura, declarados num lugar só, `scripts/static/aliases.mjs`:

| Módulo da aplicação | Modo hospedado | Navegador (estático) | Edge Function `actions` |
|---|---|---|---|
| `@/lib/identity/server` | sessão do Clerk + `clerk_user_mapping` | sessão do Supabase Auth | JWT da requisição |
| `@/lib/supabase/server` | cliente com JWT do Clerk | cliente da sessão | cliente com o JWT de quem chamou |
| `@/lib/supabase/admin` | service role | **lança erro** (nunca no navegador) | service role do próprio projeto |
| `@/lib/api`, `@/lib/api-server` | FastAPI no Fly | worker Pyodide | — |
| `next/navigation`, `next/link`, `next/dynamic`, `next/cache`, `next/headers` | Next | roteador próprio (`src/static/runtime`) | shims por requisição |
| `cache` do React | por request | por resolução de rota (`runtime/request-cache.ts`) | por requisição (`edge/request-cache.ts`) |

`src/static/runtime/RouteView.tsx` carrega `page.tsx`, `layout.tsx`, `loading.tsx` e `error.tsx` da árvore `src/app` (via `import.meta.glob`) e executa os componentes `async` no navegador (`runtime/server-tree.ts`). `redirect()` e `notFound()` funcionam como no App Router. As URLs são as mesmas do modo hospedado; rotas profundas no Pages caem no `404.html`, que é cópia do `index.html`.

A identidade foi separada de `lib/auth.ts` em `lib/identity/{types,server,client,access-rows}.ts`. O resto de `lib/auth.ts` (contexto de acesso, coordenador, ator do projeto) é o mesmo nos dois modos.

## Banco

| Migration | O quê | Efeito no modo hospedado |
|---|---|---|
| `20261115170000_native_supabase_auth` | `instance_settings.native_supabase_auth`; ramo nativo em `clerk_uid()` (`sub` do JWT do Supabase Auth); `app_uid()`; ativação do perfil no primeiro login; prova de identidade nativa em `assert_identity_write_proof` (`native_email_owner`) | nenhum: o flag nasce desligado e, desligado, `clerk_uid()` executa a consulta anterior |
| `20261115180000_native_llm_in_browser` | coordenador grava `llm_runs` e publica respostas do LLM (`publish_llm_response_from_browser`) | nenhum: as policies e a RPC exigem o modo nativo |

As policies existentes não mudam: todas resolvem a identidade por `clerk_uid()`. Uma instância tem **um** emissor de identidade; no modo nativo o token do Clerk não vale, e no hospedado o JWT nativo não vale (o contrário abriria um segundo login, por OTP com a chave anônima pública, contornando os estados que o Clerk controla).

Suítes: `native_supabase_auth.test.sql` e `native_llm_in_browser.test.sql`, com contratos pareados (o que o coordenador consegue e o que pesquisador, estranho e o modo hospedado continuam sem conseguir).

## Actions: navegador ou Edge Function

`scripts/static/privileged-actions.mjs` monta o grafo real de imports a cada build (esbuild, com as trocas do modo estático) e separa os módulos de `src/actions`:

- **Edge Function** (alcançam `createSupabaseAdmin`): `comparisons`, `equivalences`, `field-reviews`, `members`, `responses`. No navegador viram proxies gerados que chamam `functions/v1/actions`; a função executa **o mesmo código**, com os mesmos gates, e com a service role injetada pelo próprio Supabase. `complete-access` (conclusão de acesso do Clerk) não é servida.
- **Navegador**: os demais 13 módulos (`projects`, `documents`, `schema`, `llm`, `assignments`, `stats`, `export`, …).

**Por que rodar no navegador não reduz a segurança.** No modo hospedado, a fronteira dessas 13 actions já é a RLS: o token do Clerk que elas usam é o mesmo que o navegador obtém por `useAuth().getToken()` (ver `RunCard`, `useLlmRun`), e com ele qualquer usuário consegue chamar o PostgREST direto. As checagens que essas actions fazem antes de escrever são de experiência, não de autorização. O que exige servidor é a service role, e ela fica na Edge Function. O build falha se `lib/supabase/admin.ts`, o emissor do Clerk ou `@clerk/*` entrarem no grafo do navegador (`boundaryGuardPlugin`), e `supabase-admin-boundary.test.ts` verifica que, em `src/static`, só a Edge Function importa o admin e lê o secret.

## LLM no navegador

`src/static/llm` atende as rotas do FastAPI (`/llm/run`, `/llm/run-field`, `/llm/status/{id}`, `/llm/preview-prompt`, `/llm/cleanup-stale`, `/pydantic/recover-fields`) com dois Web Workers Pyodide (rodadas e chamadas curtas) que executam o próprio `backend/services` (`llm_runner`, `pydantic_compiler`, `condition_evaluator`):

- **Banco**: `python/supabase_shim.py` implementa o subconjunto do supabase-py que o runner usa, sobre o PostgREST com o JWT do coordenador (XHR síncrono no worker).
- **dataframeit**: `dataframeit(...)` vai para `adataframeit(...)` por `pyodide.ffi.run_sync`, o que exige **JSPI** (Chrome ou Edge recentes). Fatiamento do schema, canário, justificativas, publicação e classificação de erros são os do runner.
- **Ambiente**: `packages.ts` fixa Pyodide 314.0.7 e os pacotes. Os três provedores (Google, OpenAI, Anthropic) importam com `micropip.install(..., deps=False)`; Anthropic precisa de `anthropic-dangerous-direct-browser-access` (aplicado em `static_backend.py`).
- **Chave**: pedida ao coordenador na primeira rodada; fica em memória ou, se ele marcar, no `localStorage`. Nunca vai para o banco.
- **Aba aberta**: a rodada vive na aba (faixa de aviso e `beforeunload`). Cada documento é publicado assim que volta; fechar a aba interrompe, e rodar de novo com o filtro de pendentes continua.

`scripts/static/pyodide-smoke.mjs` executa o caminho inteiro no Pyodide (Node com `--experimental-wasm-jspi`) contra OpenAI e PostgREST simulados: 50 documentos, paralelismo 5, publicação pela RPC nova, JWT do coordenador em toda chamada.

**Dependência no dataframeit**: o modo assíncrono (`adataframeit`) está na branch `feature/modo-assincrono` do dataframeit. Até sair no PyPI, o build aceita uma wheel publicada junto do site (`VITE_DATAFRAMEIT_WHEEL`).

## Criar a nuvem do grupo

`/nova-nuvem` cria (ou atualiza) um projeto Supabase na conta do coordenador: aplica `schema/schema.sql`, publica a Edge Function `actions`, configura o login (código de 6 dígitos válido por 15 minutos, JWT de 15 minutos, sem login anônimo e, se o projeto tiver SMTP próprio, modelos de e-mail com `{{ .Token }}`), obtém a chave pública, verifica a instalação (RLS em todas as tabelas, modo nativo, funções) e entrega o link para a equipe (`/conectar#url=…&key=…&nome=…`).

O Supabase não responde CORS fora de supabase.com na API de gerenciamento nem no token OAuth, e a troca do código exige o client secret do app OAuth (medido pelo QualiLab). Por isso o assistente usa uma Edge Function de setup, `supabase/functions/static-setup`, publicada **uma vez pelos mantenedores** num projeto deles, com uma lista fixa de operações. Ela não guarda nada, e os dados da pesquisa nunca passam por ela. Sem ela configurada, o assistente mostra o passo a passo manual.

`schema/schema.sql` é gerado por `scripts/static/build-schema.mjs` a partir das migrations (que continuam sendo a fonte do modo hospedado): uma transação só, versões registradas em `supabase_migrations.schema_migrations` e modo nativo ligado. `schema/migrations.json` permite aplicar só o que falta numa nuvem existente.

## Publicação

Workflow `.github/workflows/static-pages.yml`: testes do modo estático, `npm run build:static` (site, Edge Function e schema) e deploy no Pages com o base path do repositório. Variáveis opcionais do repositório: `STATIC_SETUP_FUNCTION_URL`, `STATIC_SETUP_ANON_KEY`, `STATIC_SUPABASE_OAUTH_CLIENT_ID`, `STATIC_DATAFRAMEIT_REPO` + `STATIC_DATAFRAMEIT_REF` (o workflow gera a wheel com `adataframeit` dessa branch e a serve em `py/`, na mesma origem do site, enquanto a versão não sai no PyPI) ou `STATIC_DATAFRAMEIT_WHEEL` (wheel já publicada; precisa de CORS, e asset de release do GitHub não manda).

## Desenvolvimento

```bash
cd frontend
npm run dev:static          # http://localhost:5173
npm run build:static        # out/ (site), out/edge, out/schema
npx vitest run src/static
```

Banco sem Docker: `scripts/db-embedded/README.md` (Postgres 17 por pacote npm; roda as migrations e as suítes, inclusive no modo nativo).

## Segurança: o que mudar ao publicar

- **Origem compartilhada no GitHub Pages.** A sessão do Supabase Auth e as chaves de LLM "lembradas" ficam no `localStorage`, que é por origem, não por caminho. Em `https://<dono>.github.io/<repo>/`, qualquer outro repositório do mesmo dono que publique JavaScript no Pages lê esses dados. Publique o modo estático com **domínio próprio** (ou numa conta/organização cujo Pages só sirva este site). As chaves de LLM, por padrão, ficam só em memória.
- **Link para a equipe.** O link nunca conecta sozinho: mostra o endereço da nuvem e pede confirmação, e as chaves de LLM ficam presas à nuvem em que foram informadas.
- **Validade do token.** No modo nativo a identidade vale enquanto o JWT vale (o banco não consulta a sessão). O assistente reduz o `jwt_exp` para 15 minutos; o padrão do Supabase é 1 hora.
- **Dreno da auto-revisão.** Na Edge Function, só coordenador ou master o aciona, e as contagens (que somam todos os projetos) não voltam ao navegador.
- **A conferir no Supabase real.** Com "só entra quem o coordenador cadastrar" desligado, o cadastro por senha do GoTrue continua aberto. Falta confirmar se um cadastro por senha não confirmado, feito por terceiro com o e-mail de outra pessoa, perde a senha quando o dono confirma por código.

## Login: código ou link

O caminho preferido é o código de 6 dígitos, porque filtros de e-mail corporativos abrem links antes da pessoa e queimam o token. Mas o Supabase só deixa trocar o modelo do e-mail por `{{ .Token }}` com **SMTP próprio** (medido em nov/2026); sem ele, o e-mail padrão traz um link mágico. A tela de login aceita os dois: o link volta para `/auth/login` com `?code=` (fluxo **PKCE**, `identity/email-link.ts`), e o `code` só vira sessão no navegador que pediu o e-mail. O fluxo implícito, que devolve os tokens no `#hash`, ficou de fora de propósito: aceitar qualquer `#access_token` deixaria um terceiro logar a vítima na conta dele. O assistente tenta gravar os modelos com código numa chamada separada e, se o projeto não tem SMTP, conclui o passo avisando que o e-mail traz link.

## Limites conhecidos

- **Navegador para rodar o LLM**: exige JSPI (Chrome/Edge). Os demais fluxos funcionam em qualquer navegador moderno.
- **Plano gratuito do Supabase**: pausa projetos sem uso por uma semana; o SMTP embutido envia poucos e-mails por hora. Grupos maiores precisam de SMTP próprio.
- **Integridade das respostas do LLM**: no navegador quem roda o LLM é o coordenador. A RPC de publicação exige rodada em andamento do mesmo projeto, mas a origem "veio do provedor" não é verificável sem servidor.
- **Primeira carga do LLM**: Pyodide e pacotes (≈ 20 MB, cacheados pelo navegador), carregados só quando a aba do LLM é usada.
