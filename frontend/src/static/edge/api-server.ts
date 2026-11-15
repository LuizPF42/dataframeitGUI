// Nenhuma action privilegiada chama o backend Python; no modo estático ele roda
// no navegador do coordenador, não aqui.
export async function fetchFastAPIServer<T>(path: string): Promise<T> {
  throw new Error(`Rota ${path} do backend Python não existe na Edge Function.`);
}
