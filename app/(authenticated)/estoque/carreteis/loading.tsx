import styles from "@/components/spools/SpoolPages.module.css";

export default function Loading() {
  return <section className={styles.page} aria-busy="true" aria-label="Carregando carretéis" role="status">
    <span className={styles.muted}>Carregando carretéis…</span>
    <div className={styles.skeletonTitle} aria-hidden="true" />
    <div className={styles.skeletonFilter} aria-hidden="true" />
    <div className={styles.cards} aria-hidden="true">{[0, 1, 2].map(item => <div key={item} className={styles.skeletonCard} />)}</div>
  </section>;
}
