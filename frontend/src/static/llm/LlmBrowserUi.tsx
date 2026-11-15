// Interface própria do LLM no navegador: o pedido da chave do provedor e o
// aviso de que uma rodada está rodando nesta aba (que precisa ficar aberta).

import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  answerKeyRequest,
  currentKeyRequest,
  PROVIDER_KEY_HELP,
  PROVIDER_LABELS,
  subscribeKeyRequests,
} from "@/static/llm/key-store";
import {
  currentLoadingMessage,
  hasRunningJob,
  subscribeLlmJobs,
} from "@/static/llm/job-state";

export function ProviderKeyDialog() {
  const provider = useSyncExternalStore(subscribeKeyRequests, currentKeyRequest);
  const keyId = useId();
  const rememberId = useId();
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    answerKeyRequest(key.trim(), remember);
    setKey("");
    setRemember(false);
  }

  return (
    <Dialog
      open={provider !== null}
      onOpenChange={(open) => {
        if (!open) {
          answerKeyRequest(null);
          setKey("");
        }
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Chave de API — {provider ? PROVIDER_LABELS[provider] : ""}</DialogTitle>
            <DialogDescription>
              O LLM roda neste navegador, com a sua chave. Ela vai direto ao provedor e não é gravada
              no banco do grupo nem enviada a outro servidor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={keyId}>Chave</Label>
            <Input
              id={keyId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            {provider ? (
              <p className="text-xs text-muted-foreground">
                Obtenha em{" "}
                <a className="underline" href={PROVIDER_KEY_HELP[provider]} target="_blank" rel="noreferrer">
                  {new URL(PROVIDER_KEY_HELP[provider]).hostname}
                </a>
                . A cobrança é feita na sua conta do provedor.
              </p>
            ) : null}
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id={rememberId} checked={remember} onCheckedChange={(value) => setRemember(value === true)} />
            <Label htmlFor={rememberId} className="text-sm font-normal leading-snug">
              Lembrar neste navegador. Qualquer pessoa com acesso a este computador e perfil poderá usá-la.
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => answerKeyRequest(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!key.trim()}>
              Usar chave
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Faixa fixa enquanto o Python carrega ou uma rodada roda nesta aba. */
export function LlmActivityBanner() {
  const running = useSyncExternalStore(subscribeLlmJobs, hasRunningJob);
  const loading = useSyncExternalStore(subscribeLlmJobs, currentLoadingMessage);

  useEffect(() => {
    if (!running) return;
    // A rodada vive nesta aba: fechar ou recarregar a interrompe. As respostas
    // já publicadas ficam no banco; rodar de novo com "pendentes" continua.
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  if (!running && !loading) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-amber-50 px-4 py-2 text-center text-sm text-amber-900"
    >
      {loading ??
        "O LLM está rodando neste navegador. Mantenha esta aba aberta: fechar interrompe a execução " +
          "(o que já foi processado fica salvo, e rodar de novo só para os pendentes continua de onde parou)."}
    </div>
  );
}
