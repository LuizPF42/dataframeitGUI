-- Instância nativa (modo estático) não tem login por senha.
--
-- O app só entra por código ou link de e-mail. O GoTrue, porém, mantém o
-- cadastro por senha aberto sempre que o cadastro está aberto, e não há
-- configuração que desligue só a senha. Medido no Supabase real (nov/2026): um
-- terceiro se cadastra por senha com o e-mail de outra pessoa, sem confirmar;
-- quando o dono entra por código, a conta é confirmada e a senha do terceiro
-- passa a valer — acesso permanente à conta (e aos projetos) do dono.
--
-- Defesa no banco, que vale para toda forma de gravar senha (cadastro, troca,
-- recuperação, API admin): numa instância nativa, `encrypted_password` fica
-- sempre vazio, e o login por senha do GoTrue falha como credencial inválida.
-- No modo hospedado (flag desligado) nada muda: o Clerk é o emissor de
-- identidade e `auth.users` segue como antes.

CREATE OR REPLACE FUNCTION public.strip_password_on_native_instance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.native_auth_enabled() AND coalesce(NEW.encrypted_password, '') <> '' THEN
    NEW.encrypted_password := '';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.strip_password_on_native_instance()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS strip_password_on_native_instance_trigger ON auth.users;
CREATE TRIGGER strip_password_on_native_instance_trigger
  BEFORE INSERT OR UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.strip_password_on_native_instance();

-- Nuvens nativas já instaladas: senhas gravadas antes desta migration (de
-- terceiros, inclusive) deixam de valer.
UPDATE auth.users
SET encrypted_password = ''
WHERE public.native_auth_enabled()
  AND coalesce(encrypted_password, '') <> '';
