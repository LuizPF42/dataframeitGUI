import Link from "@/static/shims/next-link";

export function NotFoundScreen() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-muted-foreground">
        O endereço não existe ou você não tem acesso a ele.
      </p>
      <Link href="/dashboard" className="text-sm text-brand underline">
        Voltar aos projetos
      </Link>
    </main>
  );
}
