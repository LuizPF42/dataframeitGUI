/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_GROUP_NAME?: string;
  readonly VITE_DATAFRAMEIT_WHEEL?: string;
  readonly VITE_SETUP_FUNCTION_URL?: string;
  readonly VITE_SETUP_ANON_KEY?: string;
  readonly VITE_SUPABASE_OAUTH_CLIENT_ID?: string;
}
