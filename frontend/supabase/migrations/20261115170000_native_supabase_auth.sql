-- Identidade nativa do Supabase Auth, ligada por instância (modo estático).
--
-- Toda policy resolve a identidade por `public.clerk_uid()`. No modo hospedado
-- o JWT vem do Clerk e a função cruza `sub`, a claim `supabase_uid` e
-- `clerk_user_mapping`. No modo estático (GitHub Pages + Supabase do grupo) não
-- existe Clerk: o JWT é emitido pelo próprio Supabase Auth, `sub` já é o UUID de
-- `auth.users` e `profiles.id` referencia essa mesma linha.
--
-- O caminho nativo é uma propriedade da instância, não do token. Aceitar JWT
-- nativo também na instância hospedada abriria um segundo login (OTP do
-- Supabase Auth, com a chave anônima pública) que contorna os estados que o
-- Clerk controla (vínculo pendente, conta excluída). Por isso
-- `instance_settings.native_supabase_auth` nasce falso e só o instalador do
-- modo estático o liga; com ele falso, `clerk_uid()` executa exatamente a
-- consulta anterior. Com ele verdadeiro, o caminho do Clerk deixa de valer:
-- cada instância tem um único emissor de identidade.

-- ========== 1. Configuração da instância ==========
CREATE TABLE IF NOT EXISTS public.instance_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  native_supabase_auth boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.instance_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- Deny-by-default: nenhum papel da API lê ou escreve a configuração — nem a
-- service role, que no modo hospedado está no Next e no FastAPI: um defeito
-- ali não pode trocar o emissor de identidade da instância. Ela é lida só
-- pelas funções SECURITY DEFINER abaixo e alterada pelo instalador (SQL como
-- owner).
ALTER TABLE public.instance_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instance_settings FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.native_auth_enabled()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT settings.native_supabase_auth
     FROM public.instance_settings settings
     WHERE settings.singleton),
    false
  )
$$;
-- O cliente estático consulta o modo para escolher a tela de login; o valor
-- não é segredo.
GRANT EXECUTE ON FUNCTION public.native_auth_enabled()
  TO anon, authenticated, service_role;

-- ========== 2. Identidade ==========
-- Ramo nativo: `sub` precisa ter forma de UUID antes do cast (um `sub` do Clerk
-- como "user_2abc" faria o cast lançar e derrubaria a query inteira), o token
-- não pode ser de sessão anônima e a conta precisa existir e não estar
-- excluída nem banida. Tokens sem `sub` (chave anônima, service role) resolvem
-- para NULL, como antes.
CREATE OR REPLACE FUNCTION public.clerk_uid()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.native_auth_enabled() THEN (
      SELECT users.id
      FROM auth.users users
      WHERE (auth.jwt()->>'sub') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true'
        AND users.id = (
          CASE
            WHEN (auth.jwt()->>'sub') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (auth.jwt()->>'sub')::uuid
          END
        )
        AND users.deleted_at IS NULL
        AND (users.banned_until IS NULL OR users.banned_until <= now())
    )
    ELSE (
      SELECT mapping.supabase_user_id
      FROM public.clerk_user_mapping mapping
      WHERE mapping.clerk_user_id = auth.jwt()->>'sub'
        AND mapping.supabase_user_id::text = auth.jwt()->>'supabase_uid'
        AND mapping.access_sync_version >= 1
        AND NOT mapping.clerk_deleted
    )
  END
$$;
GRANT EXECUTE ON FUNCTION public.clerk_uid()
  TO anon, authenticated, service_role;

-- Nome neutro para a mesma identidade. As policies seguem chamando
-- `clerk_uid()`; código novo pode usar `app_uid()`.
CREATE OR REPLACE FUNCTION public.app_uid()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT public.clerk_uid()
$$;
GRANT EXECUTE ON FUNCTION public.app_uid()
  TO anon, authenticated, service_role;

-- ========== 3. Ativação do perfil no primeiro login nativo ==========
-- No modo hospedado `profiles.activated_at` é gravado pelo webhook do Clerk e
-- pela conclusão de acesso. No modo nativo o equivalente é o primeiro login: o
-- Supabase Auth atualiza `last_sign_in_at` ao emitir a sessão. Um perfil
-- pré-cadastrado pelo coordenador (conta criada sem login) continua pendente
-- até a pessoa entrar de fato.
CREATE OR REPLACE FUNCTION public.activate_profile_on_native_sign_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.native_auth_enabled() AND NEW.last_sign_in_at IS NOT NULL THEN
    UPDATE public.profiles
    SET activated_at = coalesce(activated_at, NEW.last_sign_in_at)
    WHERE id = NEW.id
      AND activated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_profile_on_native_sign_in()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS activate_profile_on_native_sign_in_trigger
  ON auth.users;
CREATE TRIGGER activate_profile_on_native_sign_in_trigger
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.activate_profile_on_native_sign_in();

-- ========== 4. Prova de identidade nas escritas de equipe ==========
-- Adicionar membro, vincular e-mail e unificar membros gravam uma identidade
-- "provada" por `assert_identity_write_proof`. No modo hospedado a prova de
-- uma conta já ativa é o snapshot de acesso do Clerk em `clerk_user_mapping`;
-- no modo nativo não há Clerk, e a conta ativa é a de `auth.users` com e-mail
-- confirmado cujo perfil já foi ativado pelo primeiro login. A versão do
-- snapshot nativo é o instante dessa ativação, que só muda se a conta for
-- recriada — o mesmo papel de "a identidade não mudou entre a leitura e a
-- escrita" que o snapshot do Clerk cumpre.

CREATE OR REPLACE FUNCTION public.native_identity_snapshot_version(p_activated_at timestamptz)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.floor(pg_catalog.date_part('epoch', p_activated_at) * 1000)::bigint
$$;

-- Dona atual de um e-mail no modo nativo. Só a Edge Function (service role)
-- consulta: a resposta revela se um e-mail tem conta.
CREATE OR REPLACE FUNCTION public.native_email_owner(p_email text)
RETURNS TABLE (user_id uuid, snapshot_version bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT profile.id, public.native_identity_snapshot_version(profile.activated_at)
  FROM public.profiles profile
  JOIN auth.users users ON users.id = profile.id
  WHERE public.native_auth_enabled()
    AND pg_catalog.lower(pg_catalog.btrim(profile.email)) = pg_catalog.lower(pg_catalog.btrim(p_email))
    AND profile.activated_at IS NOT NULL
    AND users.email_confirmed_at IS NOT NULL
    AND users.deleted_at IS NULL
    AND (users.banned_until IS NULL OR users.banned_until <= now())
$$;
REVOKE ALL ON FUNCTION public.native_email_owner(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.native_email_owner(text) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_identity_write_proof(
  p_user_id UUID,
  p_email TEXT,
  p_expected_snapshot_version BIGINT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_profile_email TEXT;
  v_activated_at TIMESTAMPTZ;
  v_access_sync_version INTEGER;
  v_access_snapshot_version BIGINT;
  v_clerk_deleted BOOLEAN;
BEGIN
  IF NULLIF(v_email, '') IS NULL THEN
    RAISE EXCEPTION 'e-mail canônico é obrigatório'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_snapshot_version IS NOT NULL AND public.native_auth_enabled() THEN
    PERFORM 1
    FROM public.profiles profile
    JOIN auth.users users ON users.id = profile.id
    WHERE profile.id = p_user_id
      AND pg_catalog.lower(pg_catalog.btrim(profile.email)) = v_email
      AND profile.activated_at IS NOT NULL
      AND public.native_identity_snapshot_version(profile.activated_at)
        = p_expected_snapshot_version
      AND users.email_confirmed_at IS NOT NULL
      AND users.deleted_at IS NULL
      AND (users.banned_until IS NULL OR users.banned_until <= now())
    FOR UPDATE OF profile;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'conta mudou antes da escrita de identidade'
        USING ERRCODE = '40001';
    END IF;
    RETURN;
  END IF;

  IF p_expected_snapshot_version IS NOT NULL THEN
    SELECT
      mapping.access_sync_version,
      mapping.access_snapshot_version,
      mapping.clerk_deleted
    INTO
      v_access_sync_version,
      v_access_snapshot_version,
      v_clerk_deleted
    FROM public.clerk_user_mapping mapping
    WHERE mapping.supabase_user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_clerk_deleted
       OR v_access_sync_version < 1
       OR v_access_snapshot_version <> p_expected_snapshot_version
    THEN
      RAISE EXCEPTION 'snapshot Clerk mudou antes da escrita de identidade'
        USING ERRCODE = '40001';
    END IF;
    RETURN;
  END IF;

  SELECT profile.email, profile.activated_at
  INTO v_profile_email, v_activated_at
  FROM public.profiles profile
  WHERE profile.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_activated_at IS NOT NULL
     OR pg_catalog.lower(pg_catalog.btrim(v_profile_email)) <> v_email
  THEN
    RAISE EXCEPTION 'placeholder deixou de ser reclamável'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.clerk_user_mapping mapping
  WHERE mapping.supabase_user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'placeholder já possui identidade Clerk'
      USING ERRCODE = '40001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_identity_write_proof(UUID, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;
