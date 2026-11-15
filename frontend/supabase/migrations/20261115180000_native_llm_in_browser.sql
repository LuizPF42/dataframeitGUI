-- LLM rodando no navegador do coordenador (modo estático).
--
-- No modo hospedado o backend Python grava `llm_runs` e publica as respostas
-- do LLM com a service role: nenhuma sessão de usuário escreve ali, e
-- `publish_latest_llm_response` é executável só por `service_role`. No modo
-- estático não existe servidor: o mesmo `llm_runner` roda num Web Worker do
-- navegador do coordenador, com o JWT dele. Esta migration abre exatamente
-- essas duas escritas para coordenador/criador/master do projeto — e só quando
-- a instância está em modo nativo (`native_auth_enabled()`), de modo que no
-- modo hospedado nada muda.
--
-- Consequência aceita do desenho, registrada aqui: no navegador quem roda o
-- LLM é o coordenador, então nada impede que ele publique respostas "do LLM"
-- montadas à mão no próprio projeto. A RPC exige uma rodada `running` do mesmo
-- projeto e passa pelas mesmas validações da publicação do backend; a
-- integridade "a resposta veio do provedor" não é verificável sem servidor.

-- ========== 1. llm_runs: escrita do coordenador ==========
DROP POLICY IF EXISTS "Coordinators write llm_runs in native mode" ON public.llm_runs;
CREATE POLICY "Coordinators write llm_runs in native mode" ON public.llm_runs
  FOR INSERT
  WITH CHECK (
    public.native_auth_enabled()
    AND (
      project_id IN (SELECT public.auth_user_coordinator_or_creator_project_ids())
      OR public.is_master()
    )
  );

DROP POLICY IF EXISTS "Coordinators update llm_runs in native mode" ON public.llm_runs;
CREATE POLICY "Coordinators update llm_runs in native mode" ON public.llm_runs
  FOR UPDATE
  USING (
    public.native_auth_enabled()
    AND (
      project_id IN (SELECT public.auth_user_coordinator_or_creator_project_ids())
      OR public.is_master()
    )
  )
  WITH CHECK (
    public.native_auth_enabled()
    AND (
      project_id IN (SELECT public.auth_user_coordinator_or_creator_project_ids())
      OR public.is_master()
    )
  );

-- ========== 2. Publicação da resposta do LLM ==========
CREATE OR REPLACE FUNCTION public.publish_llm_response_from_browser(p_response jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_job_id uuid;
BEGIN
  IF NOT public.native_auth_enabled() THEN
    RAISE EXCEPTION 'publicação pelo navegador só existe no modo estático'
      USING ERRCODE = '42501';
  END IF;
  IF public.clerk_uid() IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '42501';
  END IF;
  IF p_response IS NULL OR pg_catalog.jsonb_typeof(p_response) <> 'object' THEN
    RAISE EXCEPTION 'p_response must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_project_id := NULLIF(p_response->>'project_id', '')::uuid;
  v_job_id := NULLIF(p_response->>'llm_job_id', '')::uuid;

  IF v_project_id IS NULL
     OR NOT (
       v_project_id IN (SELECT public.auth_user_coordinator_or_creator_project_ids())
       OR public.is_master()
     )
  THEN
    RAISE EXCEPTION 'só o coordenador do projeto publica respostas do LLM'
      USING ERRCODE = '42501';
  END IF;

  -- A resposta pertence a uma rodada viva deste projeto, aberta pelo mesmo
  -- fluxo (`init_job` → `llm_runs`). Sem isso a RPC publicaria "LLM" avulso.
  IF v_job_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.llm_runs run
    WHERE run.job_id = v_job_id
      AND run.project_id = v_project_id
      AND run.status = 'running'
  ) THEN
    RAISE EXCEPTION 'resposta do LLM sem rodada em andamento neste projeto'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.publish_latest_llm_response(p_response);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_llm_response_from_browser(jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.publish_llm_response_from_browser(jsonb)
  TO authenticated;
