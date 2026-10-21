"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createGeneralMaterial,
  moveGeneralMaterial,
  setGeneralMaterialActive,
  updateGeneralMaterialCostReference,
  updateGeneralMaterialProfile,
  type MutationResult,
} from "@/lib/general-materials/actions";
import type { Material } from "@/lib/general-materials/schemas";

const units = ["unidade", "metro", "centimetro", "grama", "quilograma"] as const;
type FrozenPayload = Record<string, string | boolean | number>;

const messages: Record<string, string> = {
  created: "Material criado.", updated: "Alteração salva.", idempotent: "Operação já registrada.", no_change: "Nenhuma alteração necessária.", uncertain: "Não foi possível confirmar o resultado. Use Repetir tentativa para consultar com os mesmos dados.", permission_denied: "Sem permissão.", version_conflict: "O registro mudou. Atualize a página.", insufficient_balance: "Saldo insuficiente.", invalid_input: "Revise os campos.", technical: "Não foi possível concluir a operação.", material_unavailable: "Material indisponível.", idempotency_conflict: "Esta tentativa já foi usada com dados diferentes.", name_conflict: "Já existe um material com esse nome.", session_expired: "Sua sessão expirou. Entre novamente.",
};

function Notice({ result }: { result: MutationResult | undefined }) {
  if (!result) return null;
  const errors = result.fieldErrors ? Object.values(result.fieldErrors).flat().join(" ") : "";
  return <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{messages[result.status] ?? "Não foi possível concluir a operação."}{errors ? ` ${errors}` : ""}{result.correlation_id && ["technical", "uncertain"].includes(result.status) ? ` Código de suporte: ${result.correlation_id}.` : ""}</p>;
}

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block text-sm font-medium">{label}<input {...props} className="mt-1 block w-full rounded border p-2" /></label>;
}

function formPayload(data: FormData): Record<string, string> {
  return Object.fromEntries(Array.from(data.entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function NewGeneralMaterialForm() {
  const router = useRouter();
  const [result, setResult] = useState<MutationResult>();
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState<FrozenPayload>();

  async function submit(data: FormData) {
    const payload = frozen ?? { ...formPayload(data), attempt_id: crypto.randomUUID() };
    if (!frozen) setFrozen(payload);
    setBusy(true);
    try {
      const response = await createGeneralMaterial(payload);
      setResult(response);
      if ((response.status === "created" || response.status === "idempotent") && response.material_id) {
        router.push(`/estoque/materiais-gerais/${response.material_id}`);
      } else if (response.status !== "uncertain") {
        setFrozen(undefined);
      }
    } catch {
      setResult({ status: "uncertain" });
    } finally {
      setBusy(false);
    }
  }

  return <form action={submit} className="space-y-4 rounded border bg-white p-5"><Notice result={result} /><Field required name="name" label="Nome" disabled={busy || Boolean(frozen)} /><label className="block text-sm font-medium">Unidade de controle<select name="control_unit" className="mt-1 w-full rounded border p-2" disabled={busy || Boolean(frozen)}>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label><Field required name="reference_quantity" label="Quantidade de referência" inputMode="decimal" disabled={busy || Boolean(frozen)} /><Field required name="reference_price" label="Preço de referência" inputMode="decimal" disabled={busy || Boolean(frozen)} /><Field required name="opening_quantity" label="Quantidade inicial" inputMode="decimal" disabled={busy || Boolean(frozen)} /><button disabled={busy} className="rounded bg-indigo-700 p-2 text-white">{frozen ? "Repetir tentativa" : "Cadastrar"}</button></form>;
}

export function GeneralMaterialControls({ material, canArchive }: { material: Material; canArchive: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<MutationResult>();
  const [busy, setBusy] = useState(false);
  const [confirmedNeedsRefresh, setConfirmedNeedsRefresh] = useState(false);
  const [frozen, setFrozen] = useState<Record<string, FrozenPayload>>({});

  async function invoke(key: string, action: (payload: FrozenPayload) => Promise<MutationResult>, data: FormData) {
    const payload = frozen[key] ?? { ...formPayload(data), material_id: material.id, expected_version: String(material.version), attempt_id: crypto.randomUUID() };
    if (!frozen[key]) setFrozen((current) => ({ ...current, [key]: payload }));
    setBusy(true);
    try {
      const response = await action(payload);
      setResult(response);
      if (["created", "updated", "idempotent", "no_change"].includes(response.status)) {
        try { router.refresh(); } catch { setConfirmedNeedsRefresh(true); }
      } else if (response.status !== "uncertain") {
        setFrozen((current) => { const next = { ...current }; delete next[key]; return next; });
      }
    } catch {
      setResult({ status: "uncertain" });
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-5 rounded border bg-white p-5"><Notice result={result} />{confirmedNeedsRefresh && <p role="alert" className="rounded bg-amber-50 p-3 text-amber-800">Operação confirmada, mas não foi possível atualizar a tela. Abra novamente o material; não repita a movimentação.</p>}{material.active && <form action={(data) => invoke("move", moveGeneralMaterial, data)} className="space-y-3"><h2 className="font-semibold">Movimentar estoque</h2><select name="movement_type" className="w-full rounded border p-2" disabled={busy || Boolean(frozen.move)}><option value="entry">Entrada</option><option value="consumption">Consumo</option><option value="adjustment">Ajuste (quantidade contada)</option></select><label className="block text-sm font-medium">Unidade informada<select name="supplied_unit" defaultValue={material.control_unit} className="mt-1 w-full rounded border p-2" disabled={busy || Boolean(frozen.move)}>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label><Field required name="quantity" label="Quantidade informada" inputMode="decimal" disabled={busy || Boolean(frozen.move)} /><Field required name="reason" label="Motivo" disabled={busy || Boolean(frozen.move)} /><button className="rounded bg-indigo-700 p-2 text-white" disabled={busy}>{frozen.move ? "Repetir tentativa" : "Registrar"}</button></form>}{canArchive && <><form action={(data) => invoke("profile", updateGeneralMaterialProfile, data)} className="space-y-3 border-t pt-4"><h2 className="font-semibold">Perfil</h2><Field required name="name" label="Nome" defaultValue={material.name} disabled={busy || Boolean(frozen.profile)} /><p className="text-sm text-slate-600">A unidade de controle é imutável: {material.control_unit}.</p><button className="rounded border p-2" disabled={busy}>{frozen.profile ? "Repetir tentativa" : "Salvar perfil"}</button></form><form action={(data) => invoke("cost", updateGeneralMaterialCostReference, data)} className="space-y-3 border-t pt-4"><h2 className="font-semibold">Referência de custo</h2><Field required name="reference_quantity" label="Quantidade de referência" defaultValue={String(material.reference_quantity)} inputMode="decimal" disabled={busy || Boolean(frozen.cost)} /><Field required name="reference_price" label="Preço de referência" defaultValue={String(material.reference_price)} inputMode="decimal" disabled={busy || Boolean(frozen.cost)} /><button className="rounded border p-2" disabled={busy}>{frozen.cost ? "Repetir tentativa" : "Salvar referência"}</button></form><form action={(data) => invoke("active", setGeneralMaterialActive, data)} className="border-t pt-4"><input type="hidden" name="active" value={String(!material.active)} /><button className="rounded border p-2" disabled={busy}>{frozen.active ? "Repetir tentativa" : material.active ? "Arquivar material" : "Reativar material"}</button></form></>}</section>;
}
