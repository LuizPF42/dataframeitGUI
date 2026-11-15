import type { ReactNode } from "react";

/** Moldura das telas fora da aplicação (conectar, entrar, criar nuvem). */
export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} space-y-6 rounded-lg border bg-background p-8 shadow-sm`}>
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-brand">dataframeit</p>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
        </header>
        {children}
      </div>
    </main>
  );
}
