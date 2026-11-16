// Renderiza a rota atual a partir da árvore `src/app`: carrega page, layouts,
// loading e error, executa os Server Components no navegador (ver
// `server-tree.ts`) e trata redirect/notFound como o App Router.

import {
  Component,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { RouteParamsContext } from "@/static/shims/next-navigation";
import { NotFoundSignal, RedirectSignal } from "@/static/runtime/control-flow";
import { getSnapshot, navigate, refresh, subscribe } from "@/static/runtime/navigation";
import { beginRequest } from "@/static/runtime/request-cache";
import { matchRoute, type RouteMatch } from "@/static/runtime/routes";
import { renderRouteModule } from "@/static/runtime/server-tree";
import { NotFoundScreen } from "@/static/screens/NotFoundScreen";

type ErrorComponent = ComponentType<{ error: Error; reset: () => void }>;

/** Elementos já resolvidos de cada nível: [layout0, layout1, …, page]. */
const SlotsContext = createContext<ReactNode[]>([]);

function ChildSlot({ level }: { level: number }) {
  return <>{useContext(SlotsContext)[level + 1] ?? null}</>;
}

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; Loading: ComponentType | null; previous: ReactNode }
  | { kind: "ready"; tree: ReactNode; ErrorView: ErrorComponent | null; key: string }
  | { kind: "error"; error: Error; ErrorView: ErrorComponent | null }
  | { kind: "not-found" };

class RouteErrorBoundary extends Component<
  { ErrorView: ErrorComponent | null; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (error instanceof RedirectSignal) {
      navigate(error.href, { replace: true });
      return;
    }
    console.error("[static] erro ao renderizar a rota", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (error instanceof RedirectSignal) return null;
    if (error instanceof NotFoundSignal) return <NotFoundScreen />;
    const reset = () => {
      this.setState({ error: null });
      refresh();
    };
    const { ErrorView } = this.props;
    return ErrorView ? <ErrorView error={error} reset={reset} /> : <DefaultError error={error} reset={reset} />;
  }
}

function DefaultError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-3 p-8">
      <h1 className="text-lg font-semibold">Algo deu errado</h1>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button type="button" className="text-sm underline" onClick={reset}>
        Tentar novamente
      </button>
    </div>
  );
}

function searchParamsObject(search: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const current = result[key];
    if (current === undefined) result[key] = value;
    else result[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }
  return result;
}

async function resolveMatch(match: RouteMatch, search: string) {
  const { route, params } = match;
  const [pageModule, layoutModules, errorModule] = await Promise.all([
    route.page(),
    Promise.all(route.layouts.map((layout) => layout.load())),
    route.error ? route.error() : Promise.resolve(null),
  ]);
  const paramsPromise = Promise.resolve(params);
  const searchPromise = Promise.resolve(searchParamsObject(search));

  // Layouts e page rodam em paralelo, como no App Router: cada layout recebe
  // como `children` um slot que mostra o nível seguinte já resolvido.
  const resolved = await Promise.all([
    ...layoutModules.map((module, level) =>
      renderRouteModule(module, {
        params: paramsPromise,
        children: <ChildSlot level={level} />,
      }),
    ),
    renderRouteModule(pageModule, {
      params: paramsPromise,
      searchParams: searchPromise,
    }),
  ]);

  const title = (pageModule as { metadata?: { title?: unknown } }).metadata?.title;
  if (typeof title === "string") document.title = title;
  else document.title = "dataframeit";

  return {
    tree: (
      <RouteParamsContext.Provider value={params}>
        <SlotsContext.Provider value={resolved}>{resolved[0]}</SlotsContext.Provider>
      </RouteParamsContext.Provider>
    ),
    ErrorView: errorModule?.default ?? null,
  };
}

export function RouteView() {
  const location = useSyncExternalStore(subscribe, getSnapshot);
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const generation = useRef(0);
  const settled = useRef(0);
  const lastTree = useRef<ReactNode>(null);
  const lastPath = useRef<string | null>(null);

  const match = useMemo(() => matchRoute(location.pathname), [location.pathname]);

  useEffect(() => {
    const current = ++generation.current;
    if (!match) return;
    // Refresh na mesma rota mantém a tela atual (como o Next); navegação para
    // outra rota mostra o `loading.tsx` mais próximo.
    const samePath = lastPath.current === location.pathname;
    lastPath.current = location.pathname;
    if (!samePath) {
      void (match.route.loading ? match.route.loading() : Promise.resolve(null)).then((module) => {
        if (generation.current === current && settled.current !== current) {
          setState({ kind: "loading", Loading: module?.default ?? null, previous: lastTree.current });
        }
      });
    }

    beginRequest();
    resolveMatch(match, location.search).then(
      ({ tree, ErrorView }) => {
        if (generation.current !== current) return;
        settled.current = current;
        lastTree.current = tree;
        setState({ kind: "ready", tree, ErrorView, key: location.pathname });
      },
      async (error: unknown) => {
        if (generation.current !== current) return;
        settled.current = current;
        if (error instanceof RedirectSignal) {
          navigate(error.href, { replace: true });
          return;
        }
        if (error instanceof NotFoundSignal) {
          setState({ kind: "not-found" });
          return;
        }
        const errorModule = match.route.error ? await match.route.error() : null;
        if (generation.current !== current) return;
        console.error("[static] falha ao carregar a rota", error);
        setState({
          kind: "error",
          error: error instanceof Error ? error : new Error(String(error)),
          ErrorView: errorModule?.default ?? null,
        });
      },
    );
  }, [match, location.pathname, location.search, location.refreshToken]);

  if (!match || state.kind === "not-found") return <NotFoundScreen />;
  if (state.kind === "error") {
    const reset = () => refresh();
    return state.ErrorView ? (
      <state.ErrorView error={state.error} reset={reset} />
    ) : (
      <DefaultError error={state.error} reset={reset} />
    );
  }
  if (state.kind === "loading") {
    return state.Loading ? <state.Loading /> : <>{state.previous}</>;
  }
  if (state.kind === "ready") {
    return (
      <RouteErrorBoundary key={state.key} ErrorView={state.ErrorView}>
        {state.tree}
      </RouteErrorBoundary>
    );
  }
  return null;
}
