import { getSpoolConfig } from "@/lib/spools/actions";
import { ThresholdForm } from "@/components/spools/ThresholdForm";
import styles from "@/components/spools/SpoolPages.module.css";
import Link from "next/link";
import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidConfigPage() {
  return renderPaidModule("spools", "spools.read", () => ConfigPage());
}

async function ConfigPage() {
  const r = await getSpoolConfig();
  return (
    <section className={`${styles.page} ${styles.formPage}`}>
      <Link href="/estoque/carreteis" className={styles.textLink}>Voltar aos carretéis</Link>
      <header><p className={styles.eyebrow}>Configuração de estoque</p><h1>Alerta de estoque baixo</h1><p className={styles.muted}>Um limite compartilhado para acompanhar os carretéis da empresa.</p></header>
      {r.config && !r.error ? <div className={styles.panel}>
        <h2>Limite atual: {r.config.low_spool_threshold_percent}%</h2>
        <p className={styles.muted}>Um carretel ativo entra em estoque baixo quando tem saldo positivo menor ou igual a esse percentual do peso original. Saldo zero é classificado como esgotado.</p>
        {r.canManage ? <ThresholdForm config={r.config} /> : <p className={styles.notice}>Somente o proprietário pode alterar o limite. Você pode consultar a configuração atual.</p>}
      </div> : <div role="alert" className={styles.panel}><h2>Configuração indisponível</h2><p>Não foi possível carregar o limite. Nenhum valor estimado foi aplicado. Tente novamente.</p></div>}
    </section>
  );
}
