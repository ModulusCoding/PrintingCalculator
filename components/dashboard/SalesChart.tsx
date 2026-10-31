import type { DashboardData } from "@/lib/dashboard/schema";
import { formatCents, monthLabel } from "@/lib/dashboard/format";

export function SalesChart({ months }: { months: DashboardData["months"] }) {
  const values = months.flatMap((month) => [BigInt(month.sales_cents), BigInt(month.receipts_cents)]);
  const maximum = values.reduce((max, value) => (value < BigInt(0) ? -value : value) > max ? (value < BigInt(0) ? -value : value) : max, BigInt(1));
  const hasData = values.some((value) => value !== BigInt(0));
  const height = (value: string) => Number(((BigInt(value) < BigInt(0) ? -BigInt(value) : BigInt(value)) * BigInt(10000)) / maximum) / 100;
  return <>
    <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600"><span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-[#2B00FF]" />Vendas por criação do pedido</span><span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-[#FF4E26]" />Recebimentos líquidos por data efetiva</span></div>
    {!hasData ? <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Sem vendas ou movimentação financeira nos últimos seis meses.</p> : null}
    <div aria-hidden="true" className="grid grid-cols-6 gap-2 sm:gap-5">
      {months.map((month) => <div key={month.month} className="min-w-0"><div className="flex h-40 items-end justify-center gap-1 border-b border-slate-200 bg-[linear-gradient(to_top,transparent_49%,#f1f3f8_50%,transparent_51%)] sm:h-48 sm:gap-2">
        <div title={formatCents(month.sales_cents)} className="w-4 max-w-[35%] rounded-t bg-[#2B00FF] sm:w-7" style={{ height: `${height(month.sales_cents)}%` }} />
        <div title={formatCents(month.receipts_cents)} className={`w-4 max-w-[35%] rounded-t bg-[#FF4E26] sm:w-7 ${BigInt(month.receipts_cents) < BigInt(0) ? "opacity-50 ring-1 ring-[#FF4E26]" : ""}`} style={{ height: `${height(month.receipts_cents)}%` }} />
      </div><p className="mt-3 break-words text-center text-[10px] text-slate-600 sm:text-xs">{monthLabel(month.month)}</p>{BigInt(month.receipts_cents) < BigInt(0) ? <p className="mt-1 text-center text-[10px] text-red-800">Líquido negativo</p> : null}</div>)}
    </div>
    <details className="mt-6 text-sm"><summary className="flex min-h-11 cursor-pointer items-center font-medium text-[#2B00FF]">Consultar valores mensais</summary><ul className="mt-2 divide-y divide-slate-100">{months.map((month) => <li key={month.month} className="grid gap-1 py-3 sm:grid-cols-3"><strong className="font-medium">{monthLabel(month.month)}</strong><span>Vendas: {formatCents(month.sales_cents)}</span><span>Recebido: {formatCents(month.receipts_cents)}</span></li>)}</ul></details>
    <p className="mt-3 text-xs leading-relaxed text-slate-500">Recebimentos e estornos entram até o instante da consulta, no mês da própria data efetiva. Barras representam a magnitude; valores líquidos negativos são identificados e detalhados acima.</p>
  </>;
}
