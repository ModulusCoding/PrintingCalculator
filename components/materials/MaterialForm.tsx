"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { calculateCostPerGram } from "@/lib/materials/format";
import {
  createMaterial,
  setMaterialActive,
  updateMaterial,
  type MaterialRecord,
  type MaterialResult,
} from "@/lib/materials/actions";

const br = (value: string) => value.replace(".", ",");
const safeReturnTo = (value: string) => {
  if (!value.startsWith("/materiais") || value.startsWith("//")) return "/materiais";
  if (value.includes("#") || (value.match(/\?/g) || []).length > 1) return "/materiais";
  const [path, rawQuery = ""] = value.split("?", 2);
  if (path !== "/materiais" || rawQuery.length > 600) return "/materiais";
  const query = new URLSearchParams(rawQuery);
  for (const key of query.keys()) {
    if (key !== "search" && key !== "status" && key !== "page") return "/materiais";
  }
  const status = query.get("status");
  const page = query.get("page");
  const search = query.get("search");
  if (["status", "page", "search"].some((key) => query.getAll(key).length > 1)) return "/materiais";
  if ((search !== null && search.length > 200) || (status !== null && !["active", "archived", "all"].includes(status)) || (page !== null && !/^[1-9]\d{0,3}$/.test(page))) return "/materiais";
  return value;
};

const messageFor = (
  result: Exclude<MaterialResult, { status: "success" | "invalid_input" }>,
  action: string
) => {
  if (result.status === "session_expired") return "Sua sessão expirou. Entre novamente para continuar.";
  if (result.status === "permission_denied") return "Você não tem permissão para realizar esta ação.";
  if (result.status === "version_conflict") return "O material foi alterado em outra aba. Recarregue antes de continuar.";
  if (result.status === "material_unavailable") return "O material não está disponível para esta ação.";
  if (result.status === "unknown_result" || result.status === "technical") {
    return `Não foi possível confirmar ${action}. Consulte a listagem antes de tentar novamente.`;
  }
  return result.message || `Não foi possível ${action}.`;
};

type FormDataState = {
  name: string;
  materialType: string;
  brand: string;
  color: string;
  referenceWeightGrams: string;
  referencePrice: string;
};

export function MaterialForm({
  material,
  canWrite,
  canArchive,
  returnTo = "/materiais",
}: {
  material?: MaterialRecord;
  canWrite: boolean;
  canArchive: boolean;
  returnTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const destination = safeReturnTo(returnTo);
  const [data, setData] = useState<FormDataState>({
    name: material?.name || "",
    materialType: material?.material_type || "",
    brand: material?.brand || "",
    color: material?.color || "",
    referenceWeightGrams: material ? br(material.reference_weight_grams) : "",
    referencePrice: material ? br(material.reference_price) : "",
  });

  const set = (key: keyof FormDataState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setData((current) => ({ ...current, [key]: event.target.value }));
  };

  const price = Number(data.referencePrice.replace(",", "."));
  const weight = Number(data.referenceWeightGrams.replace(",", "."));
  const cost = Number.isFinite(price) && Number.isFinite(weight) && weight > 0
    ? calculateCostPerGram(String(price), String(weight)).replace(".", ",")
    : "—";

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWrite || locked.current) return;
    locked.current = true;
    setError("");
    setFields({});
    startTransition(async () => {
      try {
        const result = material
          ? await updateMaterial(material.id, material.version, data)
          : await createMaterial(data);
        if (result.status === "success") {
          router.push(destination);
          router.refresh();
        } else if (result.status === "invalid_input") {
          setFields(result.fieldErrors);
          if (Object.keys(result.fieldErrors).length === 0) setError("Revise os valores informados.");
        } else {
          setError(messageFor(result, "o salvamento"));
        }
      } catch {
        setError("Não foi possível confirmar o salvamento. Consulte a listagem antes de tentar novamente.");
      } finally {
        locked.current = false;
      }
    });
  };

  const toggleArchive = () => {
    if (!material || locked.current) return;
    const action = material.active ? "Arquivar" : "Restaurar";
    if (!window.confirm(`${action} este material?`)) return;
    locked.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = await setMaterialActive(material.id, material.version, !material.active);
        if (result.status === "success") {
          router.push(destination);
          router.refresh();
        } else if (result.status === "invalid_input") {
          setError(`Não foi possível ${action.toLowerCase()} o material.`);
        } else {
          setError(messageFor(result, "a alteração"));
        }
      } catch {
        setError("Não foi possível confirmar a alteração. Consulte a listagem antes de tentar novamente.");
      } finally {
        locked.current = false;
      }
    });
  };

  const summary = material && (
    <dl className="grid gap-3 sm:grid-cols-2">
      <Detail label="Tipo" value={material.material_type} />
      <Detail label="Marca" value={material.brand || "—"} />
      <Detail label="Cor" value={material.color || "—"} />
      <Detail label="Peso de referência" value={`${br(material.reference_weight_grams)} g`} />
      <Detail label="Preço de referência" value={`R$ ${br(material.reference_price)}`} />
      <Detail label="Custo por grama" value={`R$ ${br(material.cost_per_gram)}/g`} />
    </dl>
  );

  if (material && (!material.active || !canWrite)) {
    return (
      <section className="mx-auto max-w-2xl space-y-5 rounded-xl border bg-white p-6">
        <h1 className="text-2xl font-bold">{material.name}</h1>
        <p className="rounded bg-amber-50 p-3 text-amber-900">
          {material.active ? "Este material é somente leitura." : "Este material está arquivado e é somente leitura."}
        </p>
        {summary}
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          {!material.active && canArchive && (
            <button type="button" onClick={toggleArchive} className="rounded bg-green-600 px-4 py-2 text-white" disabled={pending}>Restaurar</button>
          )}
          <Link href={destination} className="rounded border px-4 py-2">Voltar</Link>
        </div>
      </section>
    );
  }

  if (!canWrite) {
    return (
      <section className="mx-auto max-w-2xl space-y-5 rounded-xl border bg-white p-6">
        <h1 className="text-2xl font-bold">Novo material</h1>
        <p className="rounded bg-amber-50 p-3 text-amber-900">Você não tem permissão para criar materiais.</p>
        <Link href={destination} className="inline-block rounded border px-4 py-2">Voltar</Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl space-y-5 rounded-xl border bg-white p-6">
      <form onSubmit={save} className="space-y-4">
        <h1 className="text-2xl font-bold">{material ? "Editar material" : "Novo material"}</h1>
        <p className="text-sm text-slate-600">Informe o preço correspondente ao peso de referência. Este cadastro não representa o saldo em estoque.</p>
        <Field id="material-name" label="Nome" value={data.name} onChange={set("name")} error={fields.name} required />
        <Field id="material-type" label="Tipo do material" value={data.materialType} onChange={set("materialType")} error={fields.materialType} required list="material-types" />
        <datalist id="material-types"><option value="PLA" /><option value="PETG" /><option value="ABS" /><option value="ASA" /><option value="TPU" /></datalist>
        <Field id="material-brand" label="Marca" value={data.brand} onChange={set("brand")} error={fields.brand} />
        <Field id="material-color" label="Cor" value={data.color} onChange={set("color")} error={fields.color} />
        <Field id="material-weight" label="Peso de referência (g)" value={data.referenceWeightGrams} onChange={set("referenceWeightGrams")} error={fields.referenceWeightGrams} required />
        <Field id="material-price" label="Preço de referência (R$)" value={data.referencePrice} onChange={set("referencePrice")} error={fields.referencePrice} required />
        <p className="rounded bg-slate-50 p-3 text-sm">Custo por grama: <strong>{cost === "—" ? "—" : `R$ ${cost}/g`}</strong></p>
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="rounded bg-violet-600 px-4 py-2 text-white disabled:opacity-50">{pending ? "Salvando…" : "Salvar"}</button>
          <Link href={destination} className="rounded border px-4 py-2">Cancelar</Link>
        </div>
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
      </form>
      {material && canArchive && (
        <div className="border-t pt-4"><button type="button" onClick={toggleArchive} className="rounded bg-red-600 px-4 py-2 text-white" disabled={pending}>Arquivar</button></div>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-sm text-slate-500">{label}</dt><dd>{value}</dd></div>;
}

function Field({ id, label, value, onChange, error, required = false, list }: {
  id: string;
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string[];
  required?: boolean;
  list?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}{required ? " *" : ""}</label>
      <input id={id} value={value} onChange={onChange} required={required} list={list} maxLength={120} className="w-full rounded border p-2" aria-invalid={Boolean(error?.length)} aria-describedby={error?.length ? `${id}-error` : undefined} />
      {error?.[0] && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error[0]}</p>}
    </div>
  );
}
