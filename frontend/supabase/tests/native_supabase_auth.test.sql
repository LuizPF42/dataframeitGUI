-- Identidade nativa do Supabase Auth (modo estático).
--
-- Fixa três contratos da migration 20261115170000:
--   1. Com `native_supabase_auth` desligado (modo hospedado), um JWT nativo
--      não resolve identidade e o caminho do Clerk continua valendo.
--   2. Com ele ligado, `sub` é a identidade, tokens malformados, anônimos ou
--      de conta excluída/banida resolvem para NULL sem erro, e o caminho do
--      Clerk deixa de valer.
--   3. A RLS existente isola projetos entre usuários nativos sem mudança nas
--      policies, e o primeiro login ativa o perfil só no modo nativo.
--
-- E o contrato da migration 20261116120000: instância nativa não guarda senha
-- (cadastro por senha de terceiro não sobrevive à confirmação do dono).
--
-- Como rodar: igual às demais suítes (`npm run test:db:psql -- <arquivo>`).

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('5a700000-0000-0000-0000-000000000001', 'native-a@example.test'),
  ('5a700000-0000-0000-0000-000000000002', 'native-b@example.test'),
  ('5a700000-0000-0000-0000-000000000003', 'native-deleted@example.test'),
  ('5a700000-0000-0000-0000-000000000004', 'native-banned@example.test'),
  ('5a700000-0000-0000-0000-000000000005', 'native-preregistered@example.test');

-- O Supabase Auth confirma o e-mail ao verificar o código OTP.
UPDATE auth.users SET email_confirmed_at = now()
WHERE id::text LIKE '5a700000-0000-0000-0000-%';
UPDATE auth.users SET deleted_at = now()
WHERE id = '5a700000-0000-0000-0000-000000000003';
UPDATE auth.users SET banned_until = now() + interval '1 day'
WHERE id = '5a700000-0000-0000-0000-000000000004';

-- Vínculo Clerk da conta A, para provar que ele vale só no modo hospedado.
INSERT INTO public.clerk_user_mapping
  (clerk_user_id, supabase_user_id, access_sync_version)
VALUES ('user_native_a', '5a700000-0000-0000-0000-000000000001', 1);

-- ========== 1. Modo hospedado (padrão) ==========
DO $$
BEGIN
  IF public.native_auth_enabled() THEN
    RAISE EXCEPTION 'FALHOU: native_supabase_auth deveria nascer desligado';
  END IF;
END
$$;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"5a700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
DO $$
BEGIN
  IF public.clerk_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: JWT nativo resolveu identidade no modo hospedado';
  END IF;
END
$$;

SELECT set_config('request.jwt.claims',
  '{"sub":"user_native_a","supabase_uid":"5a700000-0000-0000-0000-000000000001"}', true);
DO $$
BEGIN
  IF public.clerk_uid() IS DISTINCT FROM '5a700000-0000-0000-0000-000000000001'::uuid
     OR public.app_uid() IS DISTINCT FROM public.clerk_uid() THEN
    RAISE EXCEPTION 'FALHOU: caminho do Clerk mudou no modo hospedado';
  END IF;
END
$$;

RESET ROLE;

-- O cliente não lê nem altera a configuração da instância.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.instance_settings;
    RAISE EXCEPTION 'FALHOU: authenticated leu instance_settings';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    UPDATE public.instance_settings SET native_supabase_auth = true;
    RAISE EXCEPTION 'FALHOU: authenticated alterou instance_settings';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;
RESET ROLE;

-- Nem a service role altera a configuração da instância.
DO $$
BEGIN
  IF has_table_privilege('service_role', 'public.instance_settings', 'UPDATE')
     OR has_table_privilege('service_role', 'public.instance_settings', 'DELETE') THEN
    RAISE EXCEPTION 'FALHOU: service_role pode alterar instance_settings';
  END IF;
END
$$;

-- Login no modo hospedado não ativa perfil pela via nativa.
UPDATE auth.users SET last_sign_in_at = now()
WHERE id = '5a700000-0000-0000-0000-000000000002';
DO $$
BEGIN
  IF (SELECT activated_at FROM public.profiles
      WHERE id = '5a700000-0000-0000-0000-000000000002') IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: login ativou perfil no modo hospedado';
  END IF;
END
$$;

-- ========== 2. Modo nativo ==========
UPDATE public.instance_settings SET native_supabase_auth = true;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"5a700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
DO $$
BEGIN
  IF public.clerk_uid() IS DISTINCT FROM '5a700000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FALHOU: JWT nativo não resolveu a própria conta';
  END IF;
END
$$;

-- Token do Clerk deixa de valer na instância nativa, mesmo com mapping válido.
SELECT set_config('request.jwt.claims',
  '{"sub":"user_native_a","supabase_uid":"5a700000-0000-0000-0000-000000000001"}', true);
DO $$
BEGIN
  IF public.clerk_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: JWT do Clerk resolveu identidade na instância nativa';
  END IF;
END
$$;

-- Casos que precisam resolver para NULL, sem erro de cast.
DO $$
DECLARE
  claims text;
BEGIN
  FOREACH claims IN ARRAY ARRAY[
    '{}',
    '{"role":"anon"}',
    '{"sub":"nao-e-uuid"}',
    '{"sub":"5a700000-0000-0000-0000-000000000001","is_anonymous":true}',
    '{"sub":"5a700000-0000-0000-0000-000000000003"}',
    '{"sub":"5a700000-0000-0000-0000-000000000004"}',
    '{"sub":"5a700000-0000-0000-0000-0000000000ff"}'
  ] LOOP
    PERFORM set_config('request.jwt.claims', claims, true);
    IF public.clerk_uid() IS NOT NULL THEN
      RAISE EXCEPTION 'FALHOU: claims % resolveram identidade', claims;
    END IF;
  END LOOP;
END
$$;

-- ========== 3. RLS entre usuários nativos ==========
SELECT set_config('request.jwt.claims',
  '{"sub":"5a700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
INSERT INTO public.projects (id, name, created_by)
VALUES ('5a710000-0000-0000-0000-000000000001', 'Projeto nativo A',
        '5a700000-0000-0000-0000-000000000001');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects
                 WHERE id = '5a710000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FALHOU: criador nativo não enxerga o próprio projeto';
  END IF;
END
$$;

-- A conta A não cria projeto em nome de B.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.projects (id, name, created_by)
    VALUES ('5a710000-0000-0000-0000-000000000002', 'Projeto forjado',
            '5a700000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FALHOU: conta nativa criou projeto em nome de outra';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

SELECT set_config('request.jwt.claims',
  '{"sub":"5a700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
DO $$
DECLARE
  affected integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects
             WHERE id = '5a710000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FALHOU: conta nativa B enxerga projeto de A';
  END IF;
  UPDATE public.projects SET name = 'invadido'
  WHERE id = '5a710000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FALHOU: conta nativa B alterou projeto de A';
  END IF;
END
$$;

-- Sem sessão, nada é visível.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects) THEN
    RAISE EXCEPTION 'FALHOU: token sem sub enxerga projetos';
  END IF;
END
$$;

RESET ROLE;

-- ========== 4. Ativação no primeiro login nativo ==========
DO $$
BEGIN
  IF (SELECT activated_at FROM public.profiles
      WHERE id = '5a700000-0000-0000-0000-000000000005') IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: perfil pré-cadastrado nasceu ativado';
  END IF;
END
$$;

UPDATE auth.users SET last_sign_in_at = '2026-11-15 12:00:00+00'
WHERE id = '5a700000-0000-0000-0000-000000000005';

DO $$
BEGIN
  IF (SELECT activated_at FROM public.profiles
      WHERE id = '5a700000-0000-0000-0000-000000000005')
     IS DISTINCT FROM '2026-11-15 12:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'FALHOU: primeiro login nativo não ativou o perfil';
  END IF;
END
$$;

-- Logins seguintes não reescrevem a data de ativação.
UPDATE auth.users SET last_sign_in_at = '2026-11-16 12:00:00+00'
WHERE id = '5a700000-0000-0000-0000-000000000005';
DO $$
BEGIN
  IF (SELECT activated_at FROM public.profiles
      WHERE id = '5a700000-0000-0000-0000-000000000005')
     IS DISTINCT FROM '2026-11-15 12:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'FALHOU: login seguinte reescreveu activated_at';
  END IF;
END
$$;

-- ========== 5. Prova de identidade nas escritas de equipe ==========
-- A conta 005 entrou (seção 4): é dona ativa do e-mail; a 002 nunca entrou no
-- modo nativo: continua placeholder reclamável.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"5a700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.native_email_owner('native-preregistered@example.test');
    RAISE EXCEPTION 'FALHOU: authenticated consultou native_email_owner';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE
  owner record;
BEGIN
  SELECT * INTO owner FROM public.native_email_owner(' Native-Preregistered@example.test ');
  IF owner.user_id IS DISTINCT FROM '5a700000-0000-0000-0000-000000000005'::uuid
     OR owner.snapshot_version IS DISTINCT FROM 1794744000000 THEN
    RAISE EXCEPTION 'FALHOU: native_email_owner devolveu % / %', owner.user_id, owner.snapshot_version;
  END IF;
  IF EXISTS (SELECT 1 FROM public.native_email_owner('native-b@example.test')) THEN
    RAISE EXCEPTION 'FALHOU: conta sem login nativo apareceu como dona do e-mail';
  END IF;

  -- Versão errada: a conta "mudou" entre a leitura e a escrita.
  BEGIN
    PERFORM public.add_project_member_with_identity_proof(
      '5a710000-0000-0000-0000-000000000001',
      '5a700000-0000-0000-0000-000000000005',
      'pesquisador', 'native-preregistered@example.test', 1);
    RAISE EXCEPTION 'FALHOU: prova nativa aceitou versão divergente';
  EXCEPTION WHEN serialization_failure THEN
    NULL;
  END;

  -- Versão certa: membro ativo entra.
  PERFORM public.add_project_member_with_identity_proof(
    '5a710000-0000-0000-0000-000000000001',
    '5a700000-0000-0000-0000-000000000005',
    'pesquisador', 'native-preregistered@example.test', 1794744000000);

  -- Placeholder (sem snapshot) continua pelo caminho de pré-registro.
  PERFORM public.add_project_member_with_identity_proof(
    '5a710000-0000-0000-0000-000000000001',
    '5a700000-0000-0000-0000-000000000002',
    'pesquisador', 'native-b@example.test', NULL);

  IF (SELECT count(*) FROM public.project_members
      WHERE project_id = '5a710000-0000-0000-0000-000000000001'
        AND user_id IN ('5a700000-0000-0000-0000-000000000005',
                        '5a700000-0000-0000-0000-000000000002')) <> 2 THEN
    RAISE EXCEPTION 'FALHOU: membros nativos não foram adicionados';
  END IF;
END
$$;
RESET ROLE;

-- O membro adicionado enxerga o projeto pela RLS existente.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"5a700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects
                 WHERE id = '5a710000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FALHOU: membro nativo não enxerga o projeto';
  END IF;
END
$$;
RESET ROLE;

-- ========== 6. Instância nativa não guarda senha ==========
-- Cadastro por senha de terceiro com o e-mail de outra pessoa: no modo nativo a
-- senha nunca chega a valer, nem no INSERT nem numa troca posterior.
INSERT INTO auth.users (id, email, encrypted_password)
VALUES ('5a700000-0000-0000-0000-000000000006', 'native-pw@example.test', '$2a$10$senhadoterceiro');
DO $$
BEGIN
  IF (SELECT encrypted_password FROM auth.users
      WHERE id = '5a700000-0000-0000-0000-000000000006') <> '' THEN
    RAISE EXCEPTION 'FALHOU: instância nativa gravou senha no cadastro';
  END IF;
END
$$;

UPDATE auth.users SET encrypted_password = '$2a$10$outrasenha', email_confirmed_at = now()
WHERE id = '5a700000-0000-0000-0000-000000000006';
DO $$
BEGIN
  IF (SELECT encrypted_password FROM auth.users
      WHERE id = '5a700000-0000-0000-0000-000000000006') <> '' THEN
    RAISE EXCEPTION 'FALHOU: instância nativa gravou senha na troca';
  END IF;
END
$$;

-- Modo hospedado: auth.users segue como antes.
UPDATE public.instance_settings SET native_supabase_auth = false;
UPDATE auth.users SET encrypted_password = '$2a$10$hospedado'
WHERE id = '5a700000-0000-0000-0000-000000000006';
DO $$
BEGIN
  IF (SELECT encrypted_password FROM auth.users
      WHERE id = '5a700000-0000-0000-0000-000000000006') <> '$2a$10$hospedado' THEN
    RAISE EXCEPTION 'FALHOU: o modo hospedado perdeu a senha gravada';
  END IF;
END
$$;
UPDATE public.instance_settings SET native_supabase_auth = true;

ROLLBACK;

\echo 'native_supabase_auth: OK'
