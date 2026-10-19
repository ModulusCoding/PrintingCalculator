import { getSpoolConfig } from "@/lib/spools/actions";
import { ThresholdForm } from "@/components/spools/ThresholdForm";
import Link from "next/link";
export default async function ConfigPage(){const r=await getSpoolConfig();return <section className="max-w-xl space-y-4"><Link href="/estoque/carreteis" className="text-indigo-700 underline">← Carretéis</Link><h1 className="text-2xl font-bold">Alerta de estoque baixo</h1>{r.config?<><p>Limite atual: {r.config.low_spool_threshold_percent}% do peso original.</p>{r.canManage?<ThresholdForm config={r.config}/>:<p>Somente o proprietário pode alterar o limite.</p>}</>:<p role="alert">Não foi possível carregar a configuração.</p>}</section>}
