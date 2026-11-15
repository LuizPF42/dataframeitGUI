// `next/dynamic` no modo estático: `React.lazy` com o mesmo contrato de
// `loading`. Não há SSR, então a opção `ssr` é ignorada.

import { lazy, Suspense, type ComponentType, type JSX, type ReactNode } from "react";

type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };

interface DynamicOptions {
  loading?: () => ReactNode;
  ssr?: boolean;
}

export default function dynamic<P extends object>(
  loader: () => Promise<Loaded<P>>,
  options: DynamicOptions = {},
): ComponentType<P> {
  const Lazy = lazy(async () => {
    const loaded = await loader();
    return { default: "default" in loaded ? loaded.default : loaded };
  });
  function DynamicComponent(props: P) {
    return (
      <Suspense fallback={options.loading ? options.loading() : null}>
        <Lazy {...(props as P & JSX.IntrinsicAttributes)} />
      </Suspense>
    );
  }
  return DynamicComponent;
}
