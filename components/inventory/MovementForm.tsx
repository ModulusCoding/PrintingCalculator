"use client";
import { planActionMessages } from "@/lib/plans/action-messages";

import { useState, useRef, useId, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { moveProductInventory, type MutationResult } from "@/lib/inventory/actions";
import { movementInputSchema, parseUnits } from "@/lib/inventory/validation";

const MESSAGES: Record<string, string> = {
  ...planActionMessages,
  created: "Movimentação registrada com sucesso.",
  idempotent: "Esta operação já foi processada anteriormente; exibindo resultado histórico.",
  no_change: "O saldo informado é igual ao saldo atual. Nenhuma alteração foi necessária.",
  invalid_input: "Dados inválidos. Verifique os campos destacados.",
  session_expired: "Sua sessão expirou. Por favor, faça login novamente.",
  denied: "Acesso bloqueado ou negado.",
  permission_denied: "Você não possui permissão para realizar esta movimentação.",
  product_unavailable: "O produto não foi encontrado ou está arquivado.",
  version_conflict: "O saldo do produto foi alterado por outra operação. Atualize a página e revise os valores antes de tentar novamente.",
  idempotency_conflict: "Conflito de identificação: uma tentativa diferente foi enviada com este ID.",
  insufficient_stock: "Saldo insuficiente para realizar a saída.",
  balance_limit_exceeded: "O saldo final excederia o limite permitido de 1.000.000.000 unidades.",
  version_limit_exceeded: "O limite de histórico do produto foi atingido.",
  technical: "Ocorreu um erro técnico antes do envio. Tente novamente.",
  uncertain: "O estado da operação é desconhecido. A movimentação pode ter sido concluída ou não.",
};

interface MovementFormProps {
  productId: string;
  productName: string;
  balance: number;
  version: number;
}

export function MovementForm({ productId, productName, balance, version }: MovementFormProps) {
  const router = useRouter();
  const [type, setType] = useState<"entry" | "exit" | "adjustment">("entry");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MutationResult | null>(null);
  const [frozen, setFrozen] = useState<Record<string, unknown> | null>(null);
  const [stale, setStale] = useState(false);

  const typeId = useId();
  const valueId = useId();
  const reasonId = useId();
  const valueErrorId = useId();
  const reasonErrorId = useId();

  const isAdjustment = type === "adjustment";
  const parsed = parseUnits(value, isAdjustment);
  const delta = parsed === null ? null : type === "entry" ? parsed : type === "exit" ? -parsed : parsed - balance;
  const predicted = delta === null ? null : balance + delta;

  const lastProps = useRef({ productId, version });
  useEffect(() => {
    if (lastProps.current.productId !== productId || lastProps.current.version !== version) {
      lastProps.current = { productId, version };
      setStale(false);
    }
  }, [productId, version]);

  async function perform(payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await moveProductInventory(payload);
      setResult(r);
      if (["created", "idempotent", "no_change"].includes(r.status)) {
        router.refresh();
      }
    } catch {
      setResult({ status: "uncertain" });
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || frozen || stale) return;

    const payload = {
      attemptId: crypto.randomUUID(),
      productId,
      expectedVersion: version,
      movementType: type,
      ...(isAdjustment ? { countedBalance: value } : { quantity: value }),
      reason: reason.trim(),
    };

    const v = movementInputSchema.safeParse(payload);
    if (!v.success) {
      setResult({ status: "invalid_input", fieldErrors: v.error.flatten().fieldErrors as Record<string, string[]> });
      return;
    }

    const confirmed = confirm(
      `Confirmação de Movimentação\n\n` +
      `Produto: ${productName}\n` +
      `Tipo: ${type === "entry" ? "Entrada" : type === "exit" ? "Saída" : "Ajuste"}\n` +
      `Quantidade/Novo Saldo: ${value}\n` +
      `Saldo atual: ${balance}\n` +
      `Diferença: ${delta !== null ? (delta > 0 ? "+" : "") + delta : "---"}\n` +
      `Saldo previsto: ${predicted !== null ? predicted : "---"}\n` +
      `Motivo: ${payload.reason}\n\n` +
      `Deseja registrar esta operação?`
    );

    if (!confirmed) return;

    setFrozen(payload);
    await perform(payload);
  }

  const fieldErrors = result?.fieldErrors;
  const valueErrors = fieldErrors?.[isAdjustment ? "countedBalance" : "quantity"];
  const reasonErrors = fieldErrors?.reason;

  const isSuccess = result && ["created", "idempotent", "no_change"].includes(result.status);
  const isBlockingError = result && !isSuccess && result.status !== "uncertain" && result.status !== "invalid_input";
  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <header>
        <h2 className="text-lg font-semibold">Movimentar estoque</h2>
        <p className="mt-1 text-sm text-slate-600">
          Registre entradas, saídas ou correções de saldo para <strong>{productName}</strong>.
        </p>
      </header>

      <div className="rounded-xl border border-modulus-primary/10 bg-modulus-primary/5 p-4 text-sm leading-relaxed text-slate-700" role="note">
        A entrada manual registra peças existentes. Ela não comprova produção nem altera o custo médio de materiais.
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor={typeId} className="block text-sm font-medium text-slate-700">Tipo de movimentação</label>
          <select
            id={typeId}
            value={type}
            onChange={(e) => {
              setType(e.target.value as typeof type);
              setValue("");
              setResult(null);
            }}
            disabled={busy || !!frozen}
            className="mt-2 block min-h-11 w-full rounded-xl border bg-slate-50 border-slate-300 p-2 shadow-sm focus:border-modulus-primary focus:ring-modulus-primary disabled:bg-slate-50 disabled:text-slate-500"
          >
            <option value="entry">Entrada (+)</option>
            <option value="exit">Saída (-)</option>
            <option value="adjustment">Ajuste por conferência (=)</option>
          </select>
        </div>

        <div>
          <label htmlFor={valueId} className="block text-sm font-medium text-slate-700">
            {isAdjustment ? "Saldo contado atual" : "Quantidade"}
          </label>
          <input
            id={valueId}
            type="text"
            inputMode="numeric"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (result?.status === "invalid_input") setResult(null);
            }}
            disabled={busy || !!frozen}
            aria-invalid={!!valueErrors}
            aria-describedby={valueErrors ? valueErrorId : undefined}
            className={`mt-2 block min-h-11 w-full rounded-xl border bg-slate-50 p-2 shadow-sm focus:ring-modulus-primary disabled:bg-slate-50 disabled:text-slate-500 ${
              valueErrors ? "border-red-300 focus:border-red-500" : "border-slate-300 focus:border-modulus-primary"
            }`}
          />
          {valueErrors && (
            <p id={valueErrorId} className="mt-1 text-xs text-red-600">{valueErrors.join(" ")}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Saldo físico atual: {balance}.
            {predicted !== null && predicted >= 0 ? (
              <span className="ml-1 font-medium">
                Previsto: {predicted} ({delta! > 0 ? "+" : ""}{delta})
              </span>
            ) : (
              <span className="ml-1">Informe um valor válido.</span>
            )}
          </p>
        </div>

        <div>
          <label htmlFor={reasonId} className="block text-sm font-medium text-slate-700">Motivo</label>
          <textarea
            id={reasonId}
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (result?.status === "invalid_input") setResult(null);
            }}
            maxLength={500}
            disabled={busy || !!frozen}
            aria-invalid={!!reasonErrors}
            aria-describedby={reasonErrors ? reasonErrorId : undefined}
            className={`mt-2 block min-h-11 w-full rounded-xl border bg-slate-50 p-2 shadow-sm focus:ring-modulus-primary disabled:bg-slate-50 disabled:text-slate-500 ${
              reasonErrors ? "border-red-300 focus:border-red-500" : "border-slate-300 focus:border-modulus-primary"
            }`}
            placeholder="Ex: Contagem mensal, erro de digitação, etc."
          />
          {reasonErrors && (
            <p id={reasonErrorId} className="mt-1 text-xs text-red-600">{reasonErrors.join(" ")}</p>
          )}
        </div>

        {result && (
          <div
            role="alert"
            className={`rounded border p-3 text-sm ${
              isSuccess ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <p className="font-medium">{MESSAGES[result.status] || "Ocorreu um erro inesperado."}</p>
            
            {result.status === "uncertain" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => frozen && perform(frozen)}
                  className="min-h-11 rounded-xl bg-red-100 px-3 py-2 text-xs font-semibold hover:bg-red-200 disabled:opacity-50"
                >
                  Repetir mesma tentativa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStale(true);
                    router.refresh();
                  }}
                  className="min-h-11 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold hover:bg-red-100"
                >
                  Atualizar e conferir saldo
                </button>
              </div>
            )}

            {isBlockingError && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setStale(true);
                    router.refresh();
                  }}
                  className="min-h-11 rounded-xl bg-red-100 px-3 py-2 text-xs font-semibold hover:bg-red-200"
                >
                  Atualizar dados para tentar novamente
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          {!frozen && !isSuccess && (
            <button
              type="submit"
              disabled={busy || stale}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-modulus-primary px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-modulus-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modulus-primary disabled:bg-slate-400 sm:w-auto"
            >
              {busy ? "Processando..." : "Registrar movimentação"}
            </button>
          )}

          {isSuccess && (
            <button
              type="button"
              onClick={() => {
                setFrozen(null);
                setResult(null);
                setValue("");
                setReason("");
                setStale(true);
                router.refresh();
              }}
              className="min-h-11 rounded-xl bg-modulus-primary px-5 py-3 text-sm font-semibold text-white hover:bg-modulus-primary/90"
            >
              Nova movimentação
            </button>
          )}

          {stale && (
            <span className="text-xs italic text-slate-500">
              Aguardando atualização de dados...
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
