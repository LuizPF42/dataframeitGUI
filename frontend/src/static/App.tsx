// Raiz do site estático. Equivale a `app/layout.tsx` do modo hospedado, sem
// Clerk: as telas de conexão, login e criação da nuvem ficam aqui; o resto
// vem da árvore `src/app` pelo `RouteView`.

import { lazy, Suspense, useSyncExternalStore } from "react";
import { Toaster } from "@/components/ui/sonner";
import { MobileWarning } from "@/components/shell/MobileWarning";
import { LlmActivityBanner, ProviderKeyDialog } from "@/static/llm/LlmBrowserUi";
import { readConnection } from "@/static/runtime/connection";
import { getSnapshot, navigate, subscribe } from "@/static/runtime/navigation";
import { RouteView } from "@/static/runtime/RouteView";
import { ConnectScreen } from "@/static/screens/ConnectScreen";
import { LoginScreen } from "@/static/screens/LoginScreen";

const SetupWizard = lazy(() =>
  import("@/static/setup/SetupWizard").then((module) => ({ default: module.SetupWizard })),
);

/** Rotas que não exigem conexão com a nuvem do grupo. */
const PUBLIC_PATHS = new Set(["/conectar", "/nova-nuvem"]);

function Screen() {
  const { pathname } = useSyncExternalStore(subscribe, getSnapshot);
  const connection = readConnection();

  if (pathname === "/nova-nuvem") {
    return (
      <Suspense fallback={null}>
        <SetupWizard />
      </Suspense>
    );
  }
  if (pathname === "/conectar") return <ConnectScreen />;
  if (!connection && !PUBLIC_PATHS.has(pathname)) {
    queueMicrotask(() => navigate("/conectar", { replace: true }));
    return null;
  }
  if (pathname === "/auth/login") return <LoginScreen />;
  if (pathname === "/auth/post-login") {
    queueMicrotask(() => navigate("/dashboard", { replace: true }));
    return null;
  }
  return <RouteView />;
}

export function App() {
  return (
    <>
      <MobileWarning />
      <Screen />
      <ProviderKeyDialog />
      <LlmActivityBanner />
      <Toaster />
    </>
  );
}
