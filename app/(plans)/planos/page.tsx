import Link from "next/link";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { getMyPlanAccess, PLAN_CAPABILITIES, PLAN_LABELS } from "@/lib/plans";
import { FreePlanChoice } from "./FreePlanChoice";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";
import styles from "./Plans.module.css";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const free = PLAN_CAPABILITIES.free;
const integrated = PLAN_CAPABILITIES.intermediate;
const categories = ["Precificação", "Produtos e pedidos", "Produção e materiais", "Estoque", "Equipe"];
const benefits = {
  free: [
    "Dados preenchidos manualmente no cálculo, sem integração aos cadastros.",
    `Até ${free.products} produtos e ${free.orders} pedidos no histórico total da empresa, em cada categoria. Não são limites mensais ou simultâneos.`,
    "Sem cadastro de impressoras, carretéis ou materiais gerais. Informe os parâmetros manualmente no cálculo.",
    "Sem controle de estoque físico.",
    "1 proprietário (owner), sem operadores.",
  ],
  intermediate: [
    "Precificadora integrada: use as referências das impressoras, carretéis e materiais cadastrados.",
    `${integrated.products === null && integrated.orders === null ? "Produtos e pedidos ilimitados" : `Até ${integrated.products} produtos e ${integrated.orders} pedidos`} nesta fase de lançamento. Mudanças futuras serão comunicadas previamente.`,
    `Cadastro de impressoras e ${integrated.sharedMaterials} cadastros compartilhados entre carretéis e materiais gerais. Não são ${integrated.sharedMaterials} de cada.`,
    "Controle de estoque de produtos acabados e dos saldos e movimentações dos materiais.",
    `1 proprietário (owner) + ${integrated.operators} operador (operator).`,
  ],
};

export default async function PlansPage() {
  const identity = await resolveMinimalIdentity();
  if (identity.state !== "business_ready") return null;
  let access;
  try {
    access = await getMyPlanAccess();
  } catch (error) {
    return planAccessNotice(error);
  }
  const owner = identity.role === "owner";
  const canSelect = owner && access?.selection_required === true;
  const currentPlan = access && !access.selection_required ? access.effective_plan : null;
  const paid = access?.access_state === "paid";
  const priorPaid = access && ["expired", "cancelled"].includes(access.access_state);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Um plano para cada momento</p>
        <h1>Seu ritmo.<br /><span>Sua próxima camada.</span></h1>
        <p className={styles.intro}>Comece gratuitamente. Ganhe integração quando sua operação pedir.<br />Compare os caminhos e escolha o que faz sentido para o seu momento.</p>
      </header>

      <section className={styles.notice} aria-label="Situação do plano">
        {!access ? <p role="alert">Não foi encontrado um plano para esta empresa. <Link href="/conta">Verificar Minha conta</Link>. A escolha está indisponível até a situação ser verificada.</p> : <>
          {!owner && <p role="status">Somente o proprietário pode escolher ou gerenciar o plano. Peça a ele para concluir a escolha ou regularizar o acesso da equipe.</p>}
          {access.selection_required ? <p>Sua empresa ainda não escolheu um plano. {owner ? "Comece pelo Aprendiz ou continue em Meu plano para escolher o Visionário." : "A escolha deve ser feita pelo proprietário."}</p> : <p>Plano atual de acesso: <strong>{PLAN_LABELS[access.effective_plan]}</strong>. {priorPaid ? `A contratação anterior${access.selected_plan ? ` de ${PLAN_LABELS[access.selected_plan]}` : ""} está ${access.access_state === "expired" ? "expirada" : "cancelada"}; ela não representa um plano pago ativo.` : "Este é o plano efetivamente disponível para sua empresa."}</p>}
        </>}
      </section>

      <div className={styles.grid}>
        {(["free", "intermediate", "advanced"] as const).map((key) => {
          const future = key === "advanced";
          const featured = key === "intermediate";
          const current = currentPlan === key;
          return (
            <article key={key} className={`${styles.card} ${featured ? styles.featured : ""} ${future ? styles.upcoming : ""}`} aria-labelledby={`plan-${key}`}>
              <div className={styles.ribbon}>{featured ? "Integração para sua operação" : future ? "Uma próxima etapa" : "Seu ponto de partida"}</div>
              <div className={styles.cardHeading}>
                <span className={styles.symbol} aria-hidden="true">{featured ? "✳" : future ? "✺" : "✧"}</span>
                <div className={styles.nameRow}><h2 id={`plan-${key}`}>{future ? PLAN_LABELS.advanced.replace(" (em breve)", "") : PLAN_LABELS[key]}</h2>{current && <span className={styles.current}>Plano atual</span>}</div>
                <p>{future ? "Um plano em desenvolvimento, ainda indisponível." : featured ? "Sua operação conectada aos seus cadastros." : "Seu primeiro passo para calcular e organizar."}</p>
              </div>
              <div className={styles.price}>
                <p><strong>{key === "free" ? "Grátis" : money(PLAN_CAPABILITIES[key].priceCents)}</strong>{key !== "free" && <span>/mês</span>}</p>
                <small>{future ? "valor previsto · plano futuro" : key === "free" ? "sem mensalidade" : "mensal, sem fidelidade"}</small>
              </div>
              {future ? <div className={styles.futureContent}><span className={styles.futureMark} aria-hidden="true">✺</span><h3>A próxima camada está em construção.</h3><p>Os recursos serão apresentados quando o plano estiver disponível. Não há contratação nem cobrança antecipada do Magnata.</p></div> : <dl className={styles.benefits}>{categories.map((category, index) => <div key={category}><dt>{category}</dt><dd>{benefits[key][index]}</dd></div>)}</dl>}
              <div className={styles.actions}>
                {future ? <><button className={`${styles.button} ${styles.secondary}`} disabled>Em breve</button><p>Ainda não disponível para contratação.</p></> : !access ? <p>Verifique sua conta para recuperar as opções de escolha.</p> : !owner ? <p>Escolha e gestão exclusivas do proprietário.</p> : key === "free" ? canSelect ? <FreePlanChoice /> : <><span className={styles.state}>{current ? "Plano atual" : "Plano gratuito"}</span><p>{current ? "Seu acesso atual está no Aprendiz." : "Esta página não realiza mudança para o plano gratuito."}</p></> : paid ? <><span className={styles.state}>Plano atual</span><Link href="/meu-plano" className={`${styles.button} ${styles.secondary}`}>Gerenciar Meu plano</Link></> : <><Link href="/meu-plano" className={`${styles.button} ${styles.primary}`}>Escolher {PLAN_LABELS.intermediate}</Link><p>Continuar em Meu plano: o fluxo verifica tentativas existentes antes de iniciar uma nova contratação.</p></>}
              </div>
            </article>
          );
        })}
      </div>

      <section className={styles.payment} aria-labelledby="payment-title">
        <div><p className={styles.eyebrow}>Antes de continuar</p><h2 id="payment-title">Pagamento com clareza.</h2></div>
        <div><p>O Visionário oferece cartão de crédito em checkout hospedado, com cobrança recorrente, ou Pix manual a cada mês.</p><p>A contratação e a consulta de tentativas acontecem em Meu plano. Voltar do pagamento não ativa o acesso: a confirmação depende do estado autorizado do pagamento no sistema.</p>{owner && access && <Link href="/meu-plano" className={styles.textLink}>{paid ? "Gerenciar Meu plano" : "Continuar em Meu plano"}</Link>}</div>
      </section>
      <nav className={styles.footerLinks} aria-label="Navegação da conta">
        {access && <Link href="/home">Voltar ao Hub</Link>}
        <Link href="/conta">Minha conta</Link>
      </nav>
    </div>
  );
}
