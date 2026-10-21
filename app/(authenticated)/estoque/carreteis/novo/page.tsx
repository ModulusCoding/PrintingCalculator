import Link from "next/link";
import { NewSpoolForm } from "@/components/spools/SpoolForms";

export default async function NewSpoolPage() {
  return (
    <section className="max-w-xl space-y-4">
      <div>
        <Link className="text-sm text-indigo-700 underline" href="/estoque/carreteis">← Voltar</Link>
        <h1 className="text-2xl font-bold mt-1">Novo carretel</h1>
      </div>
      <p className="text-sm text-slate-600">
        Cadastre um carretel informando tipo, marca, cor, identificador interno, peso total e saldo inicial.
      </p>
      <NewSpoolForm />
    </section>
  );
}