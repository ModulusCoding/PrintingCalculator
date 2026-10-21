import Link from "next/link";
import { notFound } from "next/navigation";
import { GeneralMaterialControls } from "@/components/general-materials/GeneralMaterialForms";
import { getGeneralMaterial } from "@/lib/general-materials/actions";
import { formatCurrency, formatDate, formatQuantity } from "@/lib/general-materials/format";
import type { Movement, CostHistory } from "@/lib/general-materials/schemas";
import { normalizeReturnTo } from "@/lib/general-materials/navigation";

type Query = { page?: string; returnTo?: string };

export default async function GeneralMaterialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params, q = await searchParams, page = Math.max(1, Number(q.page) || 1);
  const back = normalizeReturnTo(q.returnTo);
  const r = await getGeneralMaterial(id, page);
  if (!r.material) {
    if (r.error === "material_unavailable") notFound();
    return <section className="space-y-4"><Link className="text-indigo-700 underline" href={back}>← Voltar</Link><h1 className="text-2xl font-bold">Não foi possível carregar o material</h1><p role="alert">{r.error === "permission_denied" ? "Sem permissão para ver este material." : r.error === "session_expired" ? "Sua sessão expirou." : `Erro técnico ao consultar o material. Código de suporte: ${r.correlation_id}.`}</p><Link className="text-indigo-700 underline" href={`/estoque/materiais-gerais/${id}?returnTo=${encodeURIComponent(back)}`}>Tentar novamente</Link></section>;
  }

  const m = r.material, movs = r.movements, hist = r.history, ctx = r.context;
  const canWrite = ["owner", "admin", "operator"].includes(ctx.role);
  const canArchive = ["owner", "admin"].includes(ctx.role);

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link className="text-sm text-indigo-700 underline" href={back}>← Voltar</Link>
          <h1 className="text-2xl font-bold mt-1">{m.name}</h1>
        </div>
        <span className={`text-sm px-2 py-1 rounded ${m.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
          {m.active ? "Ativo" : "Arquivado"}
        </span>
      </div>

      <div className="rounded border bg-slate-50 p-5 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <dt className="text-slate-600">Unidade de controle</dt>
          <dd className="font-mono">{m.control_unit}</dd>
          <dt className="text-slate-600">Referência de custo</dt>
          <dd>{m.reference_quantity} {m.control_unit} = {formatCurrency(m.reference_price)}</dd>
          <dt className="text-slate-600">Saldo atual</dt>
          <dd>{formatQuantity(m.current_balance, m.control_unit)}</dd>
        </dl>
      </div>

      <div className="space-y-3">
        {canWrite && (
          <GeneralMaterialControls material={m} canArchive={canArchive} />
        )}
        <div className="rounded border bg-white p-5">
          <h2 className="font-semibold mb-3">Histórico de movimentações</h2>
          {movs.length === 0 ? (
            <p className="text-slate-500">Nenhuma movimentação registrada.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="p-2 text-left">Tipo</th>
                  <th className="p-2 text-left">Informado</th>
                  <th className="p-2 text-left">Na unidade de controle</th>
                  <th className="p-2 text-right">Saldo antes</th>
                  <th className="p-2 text-right">Saldo depois</th>
                  <th className="p-2 text-right">Custo</th>
                  <th className="p-2 text-left">Motivo</th>
                  <th className="p-2 text-left">Data</th>
                </tr>
              </thead>
              <tbody>
                {movs.map((mv: Movement) => (
                  <tr key={mv.id} className="border-t">
                    <td className="p-2 capitalize">{mv.movement_type}</td>
                    <td className="p-2">{formatQuantity(mv.supplied_quantity, mv.supplied_unit)}</td>
                    <td className="p-2">{formatQuantity(mv.quantity_control, m.control_unit)}</td>
                    <td className="p-2 text-right">{formatQuantity(mv.balance_before, m.control_unit)}</td>
                    <td className="p-2 text-right">{formatQuantity(mv.balance_after, m.control_unit)}</td>
                    <td className="p-2 text-right">{formatCurrency(Number(mv.cost_signed))}</td>
                    <td className="p-2">{mv.reason ?? ""}</td>
                    <td className="p-2">{formatDate(mv.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded border bg-white p-5">
          <h2 className="font-semibold mb-3">Histórico de referência de custo</h2>
          {hist.length === 0 ? (
            <p className="text-slate-500">Sem alterações de referência registradas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="p-2 text-left">Antiga referência</th>
                  <th className="p-2 text-left">Nova referência</th>
                  <th className="p-2 text-left">Ator</th>
                  <th className="p-2 text-left">Data</th>
                </tr>
              </thead>
              <tbody>
                {hist.map((h: CostHistory) => (
                  <tr key={h.id} className="border-t">
                    <td className="p-2">{h.old_quantity} {m.control_unit} = {formatCurrency(h.old_price)}</td>
                    <td className="p-2">{h.new_quantity} {m.control_unit} = {formatCurrency(h.new_price)}</td>
                    <td className="p-2">{h.actor_id}</td>
                    <td className="p-2">{formatDate(h.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}