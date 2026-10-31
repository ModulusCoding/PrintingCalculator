import Image from "next/image";
import {
  Home, Calculator, Package, ShoppingBag, Printer, Layers, CircleDot,
  Building2, Users, Settings, LogOut, CircleUserRound, CircleDollarSign,
  ClipboardList, Wallet, Menu,
} from "lucide-react";
import styles from "./LandingPreview.module.css";

// Static presentation of HomeDashboard and AuthenticatedShell, not a second app shell.
// Keep labels, navigation order and visual tokens aligned with those components.
const navigation = [
  { label: "Home", icon: Home },
  { label: "Precificadora", icon: Calculator },
  { label: "Produtos", icon: Package },
  { label: "Pedidos", icon: ShoppingBag },
  { label: "Impressoras", icon: Printer },
  { label: "Materiais gerais", icon: Layers },
  { label: "Carretéis", icon: CircleDot },
  { label: "Dados empresa", icon: Building2 },
  { label: "Equipe", icon: Users },
  { label: "Configurações", icon: Settings },
];
const metrics = [
  { label: "Vendas do mês", value: "R$ 4.280,00", note: "18 pedidos criados no mês", icon: ShoppingBag },
  { label: "Recebido no mês", value: "R$ 3.650,00", note: "Recebimentos líquidos", icon: Wallet },
  { label: "Saldo total a receber", value: "R$ 1.240,00", note: "Pedidos com saldo em aberto", icon: CircleDollarSign },
  { label: "Pedidos ativos", value: "8", note: "Em andamento na operação", icon: ClipboardList },
];
const months = [
  { label: "mai", sales: 2100, received: 1800 },
  { label: "jun", sales: 2850, received: 2400 },
  { label: "jul", sales: 2600, received: 2800 },
  { label: "ago", sales: 3400, received: 2950 },
  { label: "set", sales: 3800, received: 3300 },
  { label: "out", sales: 4280, received: 3650 },
];
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function LandingDemo() {
  return (
    <section className="ml-demo-section ml-section-pad" id="demonstracao">
      <div className="ml-container">
        <div className="ml-section-top ml-reveal">
          <div>
            <div className="ml-eyebrow">UM NOVO JEITO DE TOCAR SUA OPERAÇÃO</div>
            <h2>Seu talento cria.<br /><span className="ml-muted-heading">O Hub conecta.</span></h2>
          </div>
          <p>Troque as informações espalhadas por um lugar onde tudo faz sentido. Conheça uma prévia da Home do Hub.</p>
        </div>
        <figure className={`${styles.preview} ml-reveal`} aria-label="Prévia da Home atual do Modulus Hub">
          <figcaption className={styles.caption}>
            <span><span className="ml-live-dot" /> Modulus Hub · Home</span>
            <span>Prévia estática · Dados ilustrativos</span>
          </figcaption>
          <div className={styles.workspace}>
            <aside className={styles.sidebar} aria-label="Módulos do Hub nesta prévia">
              <div className={styles.brand}>
                <Image src="/logo_Horizontal.svg" alt="Modulus" width={184} height={38} />
                <small>HUB</small>
              </div>
              <ul>{navigation.map(({ label, icon: Icon }, index) => (
                <li key={label} className={index === 0 ? styles.active : undefined}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" /><span>{label}</span>
                </li>
              ))}</ul>
              <div className={styles.logout}><LogOut size={17} aria-hidden="true" /> Sair</div>
            </aside>
            <div className={styles.main}>
              <div className={styles.topbar}>
                <div><Menu className={styles.mobileMenu} size={19} aria-hidden="true" /><span><small>Visão geral</small><strong>Home</strong></span></div>
                <div><Building2 size={16} aria-hidden="true" /><span>Estúdio Forma</span><CircleUserRound size={21} aria-hidden="true" /></div>
              </div>
              <div className={styles.content}>
                <div className={styles.heading}>
                  <div><span className={styles.eyebrow}>VISÃO GERAL</span><h3>Sua operação, em perspectiva</h3><p>Vendas, recebimentos e andamento dos pedidos em um só lugar.</p></div>
                  <span className={styles.action}><Calculator size={15} aria-hidden="true" /> Abrir precificadora</span>
                </div>
                <div className={styles.notice}>Vendas por criação do pedido. Recebimentos por data efetiva. “Pago” é um status operacional, não prova de recebimento.</div>
                <div className={styles.metrics}>{metrics.map(({ label, value, note, icon: Icon }) => (
                  <div className={styles.card} key={label}><div className={styles.metricLabel}><span>{label}</span><Icon size={17} strokeWidth={1.75} aria-hidden="true" /></div><strong className={styles.value}>{value}</strong><small>{note}</small></div>
                ))}</div>
                <section className={styles.card} aria-label="Vendas e recebimentos ilustrativos">
                  <div className={styles.chartHeading}><div><h4>Vendas e recebimentos</h4><p>Últimos seis meses · BRL · America/Sao_Paulo</p></div><div className={styles.ticket}><small>Ticket médio dos pedidos do mês</small><strong>R$ 237,78</strong></div></div>
                  <div className={styles.chart} role="img" aria-label={months.map(m => `${m.label}: vendas ${money(m.sales)}, recebimentos ${money(m.received)}`).join("; ")}>
                    {months.map(month => <div className={styles.month} key={month.label}><div className={styles.bars}><i style={{ height: `${month.sales / 45}%` }} /><i style={{ height: `${month.received / 45}%` }} /></div><span>{month.label}</span></div>)}
                  </div>
                  <div className={styles.legend}><span><i />Vendas</span><span><i />Recebimentos líquidos</span></div>
                </section>
                <section className={`${styles.card} ${styles.orders}`} aria-label="Pedidos recentes ilustrativos">
                  <h4>Pedidos recentes</h4>
                  <div><span><strong>#024 · Luiza Costa</strong><small>28/10/2026</small></span><span className={styles.status}>Orçado</span><strong>R$ 390,00</strong></div>
                  <div><span><strong>#023 · Rafael Santos</strong><small>27/10/2026</small></span><span className={styles.delivered}>Entregue</span><strong>R$ 240,00</strong></div>
                </section>
                <p className={styles.footnote}>Valores gerenciais de pedidos e recebimentos manuais; não representam lucro.</p>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}
