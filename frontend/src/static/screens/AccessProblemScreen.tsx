// `/auth/post-login` no modo estático. No modo hospedado é a conclusão de
// acesso do Clerk (vínculo pendente ou divergente). Aqui não há vínculo a
// concluir: chegar nesta rota significa que a sessão existe, mas a identidade
// não pôde ser confirmada (rede, projeto pausado, schema ausente). Mostrar o
// problema em vez de voltar ao dashboard evita um laço de redirecionamento.

import { Button } from "@/components/ui/button";
import { navigate } from "@/static/runtime/navigation";
import { getSupabase } from "@/static/runtime/supabase";
import { AuthShell } from "@/static/screens/AuthShell";
import { safeNextPath } from "@/static/screens/LoginScreen";

export function AccessProblemScreen() {
  const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
  return (
    <AuthShell
      title="Não foi possível verificar seu acesso"
      subtitle="A nuvem do grupo não respondeu como esperado. Pode ser a rede, ou o projeto do Supabase pausado por falta de uso (plano gratuito)."
    >
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => navigate(next, { replace: true })}>
          Tentar de novo
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void getSupabase()
              .auth.signOut()
              .finally(() => navigate("/auth/login", { replace: true }));
          }}
        >
          Sair
        </Button>
      </div>
    </AuthShell>
  );
}
