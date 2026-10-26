import Link from "next/link";
import { requirePlanBusinessAccess } from "@/lib/plans";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";

export default async function HomePage() {
  try { await requirePlanBusinessAccess(); }
  catch (error) { return planAccessNotice(error); }
  return <section className="space-y-5"><h1 className="text-2xl font-bold tracking-tight">Modulus Hub</h1><p>Bem-vindo ao seu espaço de produção.</p><Link href="/precificadora" className="inline-block rounded-xl bg-[#5852ff] px-5 py-3 font-semibold text-white">Abrir precificadora</Link></section>;
}
