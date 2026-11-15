-- LLM no navegador do coordenador (migration 20261115180000).
--
-- Contratos pareados: o que o coordenador consegue fazer no modo nativo e o
-- que pesquisador, estranho e o modo hospedado continuam sem conseguir.
--
-- Como rodar: igual às demais suítes (`npm run test:db:psql -- <arquivo>`).

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('5b700000-0000-0000-0000-000000000001', 'llm-coord@example.test', now()),
  ('5b700000-0000-0000-0000-000000000002', 'llm-researcher@example.test', now()),
  ('5b700000-0000-0000-0000-000000000003', 'llm-outsider@example.test', now());

-- Vínculo Clerk do coordenador, para exercitar o modo hospedado.
INSERT INTO public.clerk_user_mapping
  (clerk_user_id, supabase_user_id, access_sync_version)
VALUES ('user_llm_coord', '5b700000-0000-0000-0000-000000000001', 1);

INSERT INTO public.projects (id, name, created_by, pydantic_fields) VALUES
  ('5b710000-0000-0000-0000-000000000001', 'LLM no navegador',
   '5b700000-0000-0000-0000-000000000001',
   '[{"id":"5b720000-0000-4000-8000-000000000001","name":"q1"}]'),
  ('5b710000-0000-0000-0000-000000000002', 'Outro projeto',
   '5b700000-0000-0000-0000-000000000003', '[]');

INSERT INTO public.project_members (project_id, user_id, role) VALUES
  ('5b710000-0000-0000-0000-000000000001', '5b700000-0000-0000-0000-000000000002', 'pesquisador');

INSERT INTO public.rounds (id, project_id, label) VALUES
  ('5b730000-0000-0000-0000-000000000001', '5b710000-0000-0000-0000-000000000001', 'Rodada 1'),
  ('5b730000-0000-0000-0000-000000000002', '5b710000-0000-0000-0000-000000000002', 'Rodada 1');
UPDATE public.projects SET current_round_id = '5b730000-0000-0000-0000-000000000001'
WHERE id = '5b710000-0000-0000-0000-000000000001';
UPDATE public.projects SET current_round_id = '5b730000-0000-0000-0000-000000000002'
WHERE id = '5b710000-0000-0000-0000-000000000002';

INSERT INTO public.documents (id, project_id, title, text, text_hash) VALUES
  ('5b740000-0000-0000-0000-000000000001', '5b710000-0000-0000-0000-000000000001',
   'doc', 'texto', 'native-llm-doc');

-- Rodada do outro projeto, aberta por quem é dono dele (fixture como owner).
INSERT INTO public.llm_runs (job_id, project_id, status, round_id) VALUES
  ('5b750000-0000-0000-0000-0000000000ff', '5b710000-0000-0000-0000-000000000002', 'running',
   '5b730000-0000-0000-0000-000000000002');

CREATE TEMP TABLE native_llm_payload ON COMMIT DROP AS
SELECT jsonb_build_object(
  'project_id', '5b710000-0000-0000-0000-000000000001',
  'document_id', '5b740000-0000-0000-0000-000000000001',
  'round_id', '5b730000-0000-0000-0000-000000000001',
  'respondent_name', 'gemini-teste',
  'answers', jsonb_build_object('q1', 'sim'),
  'justifications', jsonb_build_object('q1', 'porque sim'),
  'is_partial', false,
  'pydantic_hash', 'abc',
  'llm_job_id', '5b750000-0000-0000-0000-000000000001'
) AS payload;
GRANT SELECT ON native_llm_payload TO authenticated;

-- ========== 1. Modo hospedado: nada muda ==========
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"user_llm_coord","supabase_uid":"5b700000-0000-0000-0000-000000000001"}', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.llm_runs (job_id, project_id, status)
    VALUES ('5b750000-0000-0000-0000-000000000009', '5b710000-0000-0000-0000-000000000001', 'running');
    RAISE EXCEPTION 'FALHOU: coordenador gravou llm_runs no modo hospedado';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.publish_llm_response_from_browser((SELECT payload FROM native_llm_payload));
    RAISE EXCEPTION 'FALHOU: publicação pelo navegador aceita no modo hospedado';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;
RESET ROLE;

-- ========== 2. Modo nativo ==========
UPDATE public.instance_settings SET native_supabase_auth = true;
UPDATE auth.users SET last_sign_in_at = now() WHERE id::text LIKE '5b700000-0000-0000-0000-%';

SET LOCAL ROLE authenticated;

-- Pesquisador não abre rodada nem publica.
SELECT set_config('request.jwt.claims',
  '{"sub":"5b700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.llm_runs (job_id, project_id, status)
    VALUES ('5b750000-0000-0000-0000-000000000008', '5b710000-0000-0000-0000-000000000001', 'running');
    RAISE EXCEPTION 'FALHOU: pesquisador abriu rodada do LLM';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

-- Coordenador abre a rodada.
SELECT set_config('request.jwt.claims',
  '{"sub":"5b700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
INSERT INTO public.llm_runs (job_id, project_id, status, phase)
VALUES ('5b750000-0000-0000-0000-000000000001', '5b710000-0000-0000-0000-000000000001', 'running', 'loading');

-- Coordenador não abre rodada em projeto alheio.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.llm_runs (job_id, project_id, status)
    VALUES ('5b750000-0000-0000-0000-000000000007', '5b710000-0000-0000-0000-000000000002', 'running');
    RAISE EXCEPTION 'FALHOU: coordenador abriu rodada em projeto alheio';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

-- Publicação: rodada de outro projeto e rodada inexistente são recusadas.
DO $$
BEGIN
  BEGIN
    PERFORM public.publish_llm_response_from_browser(
      (SELECT payload || jsonb_build_object('llm_job_id', '5b750000-0000-0000-0000-0000000000ff')
       FROM native_llm_payload));
    RAISE EXCEPTION 'FALHOU: publicou com rodada de outro projeto';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.publish_llm_response_from_browser(
      (SELECT payload - 'llm_job_id' FROM native_llm_payload));
    RAISE EXCEPTION 'FALHOU: publicou sem rodada';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

-- Publicação válida.
DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.publish_llm_response_from_browser((SELECT payload FROM native_llm_payload));
  IF NOT EXISTS (
    SELECT 1 FROM public.responses
    WHERE id = v_id AND respondent_type = 'llm' AND is_latest
      AND answers = '{"q1":"sim"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'FALHOU: resposta do LLM não ficou publicada';
  END IF;
END
$$;

-- Progresso e conclusão da rodada.
DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.llm_runs SET progress = 1, total = 1, status = 'completed', phase = 'completed'
  WHERE job_id = '5b750000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'FALHOU: coordenador não atualizou a própria rodada';
  END IF;
  UPDATE public.llm_runs SET status = 'error'
  WHERE job_id = '5b750000-0000-0000-0000-0000000000ff';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FALHOU: coordenador alterou rodada de projeto alheio';
  END IF;
END
$$;

-- Rodada concluída não aceita mais publicação.
DO $$
BEGIN
  BEGIN
    PERFORM public.publish_llm_response_from_browser((SELECT payload FROM native_llm_payload));
    RAISE EXCEPTION 'FALHOU: publicou depois de a rodada terminar';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

-- Estranho ao projeto não publica.
SELECT set_config('request.jwt.claims',
  '{"sub":"5b700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.publish_llm_response_from_browser((SELECT payload FROM native_llm_payload));
    RAISE EXCEPTION 'FALHOU: estranho publicou resposta do LLM';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;
RESET ROLE;

-- Sem sessão: nem EXECUTE.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.publish_llm_response_from_browser(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: anon pode executar a publicação';
  END IF;
END
$$;

ROLLBACK;

\echo 'native_llm_in_browser: OK'
