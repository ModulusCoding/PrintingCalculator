import Link from "next/link";
import { ArrowDownLeft, Banknote, Calculator, CircleDollarSign, ClipboardList, Package, ScrollText, ShoppingBag } from "lucide-react";
import type { DashboardData, ReadResult, StockResult } from "@/lib/dashboard/schema";
import { averageCents, dateLabel, formatCents, monthLabel } from "@/lib/dashboard/format";
import { SalesChart } from "./SalesChart";
import { PaidModuleNotice } from "@/components/plans/PaidModuleNotice";

const panel = "min-w-0 rounded-xl border border-[#e1e5ee] bg-white p-5 shadow-sm sm:p-6";
const link = "inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[#2B00FF] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2B00FF]";
const statuses: Record<string, string> = { em_conversao: "Em Conversão", orcado: "Orçado", pago: "Pago", modelando: "Modelando", imprimindo: "Imprimindo", entregue: "Entregue", cancelado: "Cancelado" };

function ReadError({ message }: { message: string }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-900">{message} <span className="block mt-1">Nenhum valor foi substituído por zero.</span></div>;
}
function Metric({ title, value, description, icon: Icon }: { title: string; value: string; description: string; icon: typeof Banknote }) {
  return <article className={panel}><div className="flex items-start justify-between gap-3"><h2 className="text-xs font-medium uppercase tracking-wider text-slate-600">{title}</h2><span className="rounded-lg bg-[#A6B4FF]/20 p-2 text-[#2B00FF]"><Icon size={18} aria-hidden="true" /></span></div><p className="mt-5 break-words text-[clamp(1.4rem,2.2vw,2rem)] font-semibold leading-tight tracking-tight text-[#152336]">{value}</p><p className="mt-3 text-xs leading-relaxed text-slate-500">{description}</p></article>;
}
function FinancialSummary({ data }: { data: DashboardData }) {
  return <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 min-[1280px]:grid-cols-4">
    <Metric title="Vendas do mês" value={formatCents(data.sales_cents)} description={`${data.month_orders_count.toLocaleString("pt-BR")} pedidos criados no mês, excluindo cancelados.`} icon={ShoppingBag} />
    <Metric title="Recebido no mês" value={formatCents(data.receipts_cents)} description="Recebimentos manuais menos estornos, por data efetiva no mês, até o instante da consulta." icon={ArrowDownLeft} />
    <Metric title="Saldo total a receber" value={formatCents(data.pending_cents)} description="Todos os pedidos não cancelados, independentemente do mês de criação." icon={CircleDollarSign} />
    <Metric title="Pedidos ativos" value={data.active_orders_count.toLocaleString("pt-BR")} description="Em andamento: todos os pedidos não entregues e não cancelados." icon={ClipboardList} />
  </div>;
}
function StockPanel({ stock }: { stock: Exclude<StockResult, { status: "free" }> }) {
  return <section className={panel} aria-labelledby="stock-heading"><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 id="stock-heading" className="text-lg font-semibold tracking-tight">Estoque da operação</h2><Package size={20} className="text-[#2B00FF]" aria-hidden="true" /></div>
    {stock.status === "unavailable" ? <ReadError message="Não foi possível autorizar a leitura do estoque." /> : <div className="space-y-5">
      {stock.inventory.status === "error" ? <ReadError message={stock.inventory.message} /> : <><div className="grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-50 p-4"><p className="text-xs text-slate-500">Disponível</p><p className="mt-2 break-words text-2xl font-semibold">{BigInt(stock.inventory.data.available_units).toLocaleString("pt-BR")}</p><p className="mt-1 text-xs text-slate-500">unidades livres</p></div><div className="rounded-lg bg-slate-50 p-4"><p className="text-xs text-slate-500">Reservado</p><p className="mt-2 break-words text-2xl font-semibold">{BigInt(stock.inventory.data.reserved_units).toLocaleString("pt-BR")}</p><p className="mt-1 text-xs text-slate-500">unidades físicas</p></div></div><p className="text-sm text-slate-600">{stock.inventory.data.stocked_products === 0 ? "Sem produtos com saldo físico disponível ou reservado." : `${stock.inventory.data.stocked_products.toLocaleString("pt-BR")} produtos com saldo físico.`}</p></>}
      <Link href="/estoque/produtos" className={link}>Ver produtos prontos</Link>
      <div className="border-t border-slate-100 pt-5">{stock.spools.status === "error" ? <ReadError message={stock.spools.message} /> : <><h3 className="text-sm font-medium">Atenção aos carretéis</h3><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-600">Saldo baixo</dt><dd className="font-semibold">{stock.spools.data.low_count.toLocaleString("pt-BR")}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-600">Esgotados</dt><dd className="font-semibold">{stock.spools.data.empty_count.toLocaleString("pt-BR")}</dd></div></dl><p className="mt-3 text-xs leading-relaxed text-slate-500">Limite configurado: {stock.spools.data.threshold_percent}% do peso inicial. Carretéis arquivados não entram na contagem.</p></>}
      <Link href="/estoque/carreteis" className={`${link} mt-2`}>Consultar carretéis</Link></div>
    </div>}
  </section>;
}

export function HomeDashboard({ finance, stock, downgraded = false }: { finance: ReadResult<DashboardData>; stock: StockResult; downgraded?: boolean }) {
  const data = finance.status === "ready" ? finance.data : null;
  const ticket = data ? averageCents(data.sales_cents, data.month_orders_count) : null;
  return <div className="mx-auto max-w-[1600px] space-y-6 text-[#152336]">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-xs font-medium uppercase tracking-widest text-[#2B00FF]">Visão geral</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Sua operação, em perspectiva</h1><p className="mt-2 text-sm leading-relaxed text-slate-600">Vendas, recebimentos e andamento dos pedidos em um só lugar.</p></div><Link href="/precificadora" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-[#2B00FF] px-4 py-3 text-sm font-medium text-white hover:bg-[#2200CC] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2B00FF]"><Calculator size={17} aria-hidden="true" />Abrir precificadora</Link></header>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#A6B4FF]/40 bg-[#A6B4FF]/10 p-4 text-xs leading-relaxed text-[#152336]"><p>Vendas por criação do pedido. Recebimentos por data efetiva. “Pago” é um status operacional, não prova de recebimento.</p>{data ? <p className="font-medium capitalize">{monthLabel(data.current_month, true)} · São Paulo</p> : null}</div>
    {finance.status === "error" ? <ReadError message={finance.message} /> : <FinancialSummary data={finance.data} />}
    <section className={panel} aria-labelledby="sales-heading"><div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><h2 id="sales-heading" className="text-lg font-semibold tracking-tight">Vendas e recebimentos</h2><p className="mt-1 text-xs text-slate-500">Últimos seis meses · BRL · America/Sao_Paulo</p></div>{data ? <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs"><p className="text-slate-500">Ticket médio dos pedidos do mês</p><p className="mt-1 font-semibold">{ticket === null ? "Sem pedidos no mês" : formatCents(ticket)}</p></div> : null}</div>{data ? <SalesChart months={data.months} /> : <p className="text-sm text-slate-600">Evolução indisponível até que a leitura financeira seja concluída com sucesso.</p>}</section>
    <div className="grid items-start gap-6 min-[1200px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <section className={panel} aria-labelledby="recent-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 id="recent-heading" className="text-lg font-semibold tracking-tight">Pedidos recentes</h2><p className="mt-1 text-xs text-slate-500">Últimos cinco pedidos criados</p></div><Link href="/admin/orders" className={link}>Ver pedidos</Link></div>
        {!data ? <p className="py-6 text-sm text-slate-600">A listagem de pedidos está indisponível nesta leitura.</p> : data.recent_orders.length === 0 ? <div className="rounded-lg bg-slate-50 p-6 text-center"><ScrollText className="mx-auto mb-3 text-slate-400" aria-hidden="true" /><p className="font-medium">Ainda não há pedidos</p><p className="mt-2 text-sm text-slate-500">Os pedidos da sua empresa aparecerão aqui quando forem cadastrados.</p></div> : <ul className="divide-y divide-slate-100">{data.recent_orders.map((order) => <li key={order.id} className="py-4"><Link href={`/admin/orders?orderId=${order.id}`} className="group flex min-w-0 flex-col gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2B00FF] sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words text-sm font-medium group-hover:text-[#2B00FF]">#{order.display_number} · {order.buyer_name}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(order.created_at)}</p></div><div className="flex flex-wrap items-center gap-3 sm:justify-end"><span className={`rounded-md px-2 py-1 text-xs font-medium ${order.operational_status === "cancelado" ? "bg-red-50 text-red-800" : order.operational_status === "entregue" ? "bg-emerald-50 text-emerald-800" : "bg-[#A6B4FF]/20 text-[#2B00FF]"}`}>{statuses[order.operational_status]}</span><span className="break-words text-sm font-semibold">{formatCents(order.total_cents)}</span></div></Link></li>)}</ul>}
      </section>{stock.status === "free" ? <PaidModuleNotice module="inventory" downgraded={downgraded} /> : <StockPanel stock={stock} />}
    </div>
    <p className="text-xs leading-relaxed text-slate-500">Valores gerenciais de pedidos e recebimentos manuais; não representam lucro e não incluem assinaturas SaaS da Modulus.{data ? ` Leitura em ${dateLabel(data.as_of)}, horário de São Paulo.` : ""}</p>
  </div>;
}
