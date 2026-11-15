-- Só para a rodada nativa das suítes legadas: as fixtures emitem tokens no
-- formato do Clerk ({sub: id-clerk, supabase_uid: uuid}). Aqui o token é
-- traduzido para o que o Supabase Auth emitiria para a MESMA pessoa: sub = uuid.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN raw ? 'supabase_uid' THEN raw || jsonb_build_object('sub', raw->>'supabase_uid')
    ELSE raw
  END
  FROM (SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb AS raw) t
$$;
