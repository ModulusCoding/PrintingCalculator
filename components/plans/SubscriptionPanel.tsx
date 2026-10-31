import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeAsaasUrl } from "@/lib/billing/contracts";
import { cancelSubscriptionAction, cancelCheckoutAction, startSubscriptionAction, refreshSubscriptionAction } from "@/lib/billing/actions";

const schema = z.object({ state: z.enum(["not_configured", "review", "pending", "cancel_unknown", "cancelled"]), checkout_url: z.string().nullable().optional(), effective_plan: z.string().nullable().optional(), next_due_date: z.string().nullable().optional(), coverage: z.array(z.object({ paid_from: z.string(), paid_until: z.string(), reversed: z.boolean() })).optional(), payments: z.array(z.object({ payment_id: z.string(), status: z.string(), value_cents: z.number().int(), due_date: z.iso.date(), invoice_url: z.string().nullable() })) });
const states = { not_configured: "Sem assinatura de cobrança vinculada", review: "Aguardando revisão financeira", pending: "Aguardando pagamento", cancel_unknown: "Cancelamento em verificação — novas contratações bloqueadas", cancelled: "Assinatura cancelada" };
export async function SubscriptionPanel() {
  let billing;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("get_my_saas_billing");
    if (error) throw error;
    billing = schema.parse(data);
  } catch {
    return <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-[#152336]" role="status"><h2 className="text-xl font-semibold tracking-tight">Minha assinatura</h2><p className="mt-3 text-slate-600">A consulta de cobrança está indisponível. O plano e as cotas acima continuam sendo resolvidos pelo servidor. Nenhuma cobrança foi iniciada.</p></section>;
  }
  return <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-[#152336]">
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Minha assinatura</h2>
      <p className="mt-1 text-sm text-slate-600">Visionário: R$ 39,90/mês, sem fidelidade. Magnata: R$ 79,90/mês, em breve e não contratável.</p>
    </div>
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm font-medium">
      <span className="inline-block px-2.5 py-1 rounded-full bg-blue-50 text-[#2B00FF] mr-2">{states[billing.state]}</span> · Acesso efetivo: <strong className="font-semibold text-[#152336]">{billing.effective_plan ?? "consulte acima"}</strong>
    </div>
    {billing.next_due_date && <p className="text-sm text-slate-600">Próximo vencimento de fatura: {billing.next_due_date}</p>}
    {safeAsaasUrl(billing.checkout_url, process.env.ASAAS_ENVIRONMENT === "production") && <div><a className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2B00FF] px-5 py-3 text-sm font-medium text-white hover:bg-[#2200CC]" href={safeAsaasUrl(billing.checkout_url, process.env.ASAAS_ENVIRONMENT === "production")!} target="_blank" rel="noopener noreferrer">Continuar checkout hospedado</a></div>}
    {billing.coverage && billing.coverage.length > 0 && <div className="space-y-2"><p className="text-sm font-medium">Coberturas registradas:</p><ul className="space-y-1 text-sm text-slate-600">{billing.coverage.map(c => <li key={c.paid_from}>De {c.paid_from} até {c.paid_until}{c.reversed ? " (revertida)" : ""}</li>)}</ul></div>}
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">Cobertura mensal a partir da primeira confirmação verificada pelo servidor. O retorno do checkout não ativa o plano. Nunca informe cartão ao Modulus.</p>
    {["not_configured", "cancelled", "pending"].includes(billing.state) && <form action={startSubscriptionAction} className="space-y-4 rounded-xl border border-slate-200 p-5 bg-slate-50">
      <h3 className="font-semibold text-sm">Contratar plano Visionário</h3>
      <input type="hidden" name="attempt" value={crypto.randomUUID()} />
      <div className="space-y-1"><label className="block text-xs font-medium text-slate-600">Nome do pagador</label><input className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#152336] bg-white" name="name" minLength={3} maxLength={100} required autoComplete="name" /></div>
      <div className="space-y-1"><label className="block text-xs font-medium text-slate-600">CPF/CNPJ (somente números)</label><input className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#152336] bg-white" name="cpfCnpj" pattern="([0-9]{11}|[0-9]{14})" required /></div>
      <div className="space-y-1"><label className="block text-xs font-medium text-slate-600">E-mail</label><input className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#152336] bg-white" name="email" type="email" required autoComplete="email" /></div>
      <div className="space-y-2 pt-2"><label className="flex items-center gap-2 text-sm"><input type="radio" name="method" value="CREDIT_CARD" required /> Cartão — checkout hospedado e renovação automática</label><label className="flex items-center gap-2 text-sm"><input type="radio" name="method" value="PIX" required /> Pix — pagar manualmente cada fatura mensal</label></div>
      <div className="pt-2"><label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" name="accepted" required className="mt-1" /> Aceito R$ 39,90/mês e cancelamento imediato sem reembolso automático.</label></div>
      <button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2B00FF] px-5 py-3 text-sm font-medium text-white hover:bg-[#2200CC]">Contratar / recuperar contratação</button>
    </form>}
    <form action={refreshSubscriptionAction}><button className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-[#152336] hover:bg-slate-50">Verificar pagamento / buscar próxima fatura Pix</button></form>
    <p className="text-xs text-slate-500">Cartão: recorrência em checkout hospedado. Pix: pagamento manual a cada mês; não é Pix Automático. Cancelamento confirmado encerra o acesso pago imediatamente, sem reembolso automático.</p>
    {["review", "pending"].includes(billing.state) && <form action={cancelSubscriptionAction} className="space-y-3 pt-2"><input type="hidden" name="attempt" value={crypto.randomUUID()} /><label className="flex items-start gap-2 text-sm text-red-800"><input type="checkbox" name="confirmed" required className="mt-1" /> Entendo a perda imediata do acesso pago após confirmação do cancelamento.</label><button className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100">Cancelar assinatura</button></form>}
    {billing.state === "pending" && billing.checkout_url && <form action={cancelCheckoutAction} className="space-y-3 pt-2"><input type="hidden" name="attempt" value={crypto.randomUUID()} /><label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" name="confirmed" required className="mt-1" /> Quero encerrar o checkout ainda não pago.</label><button className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-[#152336] hover:bg-slate-50">Cancelar checkout</button></form>}
    <div className="space-y-3 border-t border-slate-100 pt-6">
      <h3 className="font-semibold text-sm">Histórico de cobranças SaaS</h3>
      {billing.payments.length === 0 ? <p className="text-sm text-slate-500">Nenhuma cobrança registrada.</p> : <ul className="space-y-2">{billing.payments.map(payment => {
        const link = safeAsaasUrl(payment.invoice_url, process.env.ASAAS_ENVIRONMENT === "production");
        return <li key={payment.payment_id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm flex flex-wrap items-center justify-between gap-2"><span>{payment.due_date} · {(payment.value_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · <strong className="font-medium">{payment.status}</strong></span>{link && <a href={link} target="_blank" rel="noopener noreferrer" className="text-[#2B00FF] font-medium underline">Abrir fatura no Asaas</a>}</li>;
      })}</ul>}
    </div>
  </section>;
}
