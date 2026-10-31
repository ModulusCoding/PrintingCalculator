"use client";

import { useEffect, useRef, useState } from "react";

type DemoTab = "pricing" | "stock" | "orders";

const tabTitles: Record<DemoTab, [string, string]> = {
  pricing: ["MEU ATELIÊ / PRECIFICAÇÃO", "Quanto vale sua criação?"],
  stock: ["MEU ATELIÊ / MATERIAIS", "Sua bancada, organizada."],
  orders: ["MEU ATELIÊ / PEDIDOS", "Cada criação tem um caminho."],
};
const tabs: { key: DemoTab; icon: string; label: string }[] = [
  { key: "pricing", icon: "⌘", label: "Precificadora" },
  { key: "stock", icon: "▦", label: "Materiais" },
  { key: "orders", icon: "▤", label: "Pedidos" },
];
const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function LandingDemo() {
  const [tab, setTab] = useState<DemoTab>("pricing");
  const [tabChanged, setTabChanged] = useState(false);
  const [weight, setWeight] = useState(100);
  const [filament, setFilament] = useState(10.5);
  const [orderStage, setOrderStage] = useState(0);
  const [orderChanged, setOrderChanged] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const priceFrame = useRef(0);
  const currentFilament = useRef(10.5);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    cancelAnimationFrame(priceFrame.current);
    if (toastTimeout.current !== null) clearTimeout(toastTimeout.current);
  }, []);

  function updatePrice(nextWeight: number) {
    setWeight(nextWeight);
    cancelAnimationFrame(priceFrame.current);
    const target = nextWeight * 1.05 * 0.1;
    const start = currentFilament.current;
    const time = performance.now();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function frame(now: number) {
      const progress = motion.matches ? 1 : Math.min(1, (now - time) / 180);
      const value = start + (target - start) * (1 - (1 - progress) ** 3);
      currentFilament.current = value;
      setFilament(value);
      if (progress < 1) priceFrame.current = requestAnimationFrame(frame);
    }
    priceFrame.current = requestAnimationFrame(frame);
  }

  function toast(message: string) {
    if (toastTimeout.current !== null) clearTimeout(toastTimeout.current);
    setToastMessage(message);
    toastTimeout.current = setTimeout(() => setToastMessage(""), 4300);
  }

  function advanceOrder() {
    if (orderStage >= 2) return;
    setOrderStage(orderStage + 1);
    setOrderChanged(true);
    toast(orderStage === 0
      ? "Pagamento registrado neste exemplo."
      : "Mais uma criação entregue! Esta é uma simulação.");
  }

  const sliderPercent = ((weight - 20) / 280) * 100;
  const panelClass = (key: DemoTab) =>
    `ml-tab-panel${tabChanged && tab === key ? " ml-panel-in" : ""}`;
  const orderCard = (
    <article
      className={`ml-order-card${orderChanged ? " ml-panel-in" : ""}`}
      id="interactive-order"
      key={`order-${orderStage}`}
    >
      <span className="ml-order-number">PEDIDO #024</span>
      <h4>Vasos geométricos</h4>
      <p>3 peças · Violeta</p>
      <div className="ml-order-footer">
        <strong>R$ 117,00</strong>
        <span className="ml-initials">LC</span>
      </div>
      <button type="button" id="advance-order" disabled={orderStage === 2} onClick={advanceOrder}>
        {orderStage === 0 ? "Marcar como pago" : orderStage === 1 ? "Marcar como entregue" : "Pedido entregue"}{" "}
        <span>{orderStage === 2 ? "✓" : "→"}</span>
      </button>
    </article>
  );

  return (
    <section className="ml-demo-section ml-section-pad" id="demonstracao">
      <div className="ml-container">
        <div className="ml-section-top ml-reveal">
          <div>
            <div className="ml-eyebrow">UM NOVO JEITO DE TOCAR SUA OPERAÇÃO</div>
            <h2>Seu talento cria.<br /><span className="ml-muted-heading">O Hub conecta.</span></h2>
          </div>
          <p>Troque as informações espalhadas por um lugar onde tudo faz sentido. Explore uma amostra da experiência.</p>
        </div>
        <div className="ml-app-window ml-reveal">
          <div className="ml-window-top">
            <div className="ml-window-dots"><i /><i /><i /></div>
            <span>Modulus Hub / Meu ateliê</span>
            <span className="ml-sample-badge"><i /> Demonstração interativa</span>
          </div>
          <div className="ml-app-inner">
            <aside className="ml-app-sidebar">
              <div className="ml-app-logo">m<span>.</span></div>
              <span className="ml-app-side-label">MEU ESPAÇO</span>
              {tabs.map(({ key, icon, label }) => (
                <button
                  type="button"
                  className={`ml-app-tab${tab === key ? " ml-active" : ""}`}
                  data-tab={key}
                  aria-controls={`panel-${key}`}
                  aria-pressed={tab === key}
                  onClick={() => { setTab(key); setTabChanged(true); }}
                  key={key}
                >
                  <span>{icon}</span> {label}
                </button>
              ))}
              <div className="ml-side-bottom">
                <span className="ml-user-avatar">MA</span>
                <div>Meu ateliê<small>Plano Visionário</small></div>
                <span>⌄</span>
              </div>
            </aside>
            <div className="ml-app-main">
              <div className="ml-app-heading">
                <div>
                  <span className="ml-micro" id="app-breadcrumb">{tabTitles[tab][0]}</span>
                  <h3 id="app-title">{tabTitles[tab][1]}</h3>
                </div>
                <span className="ml-demo-tag">Dados ilustrativos</span>
              </div>
              <div className={panelClass("pricing")} id="panel-pricing" hidden={tab !== "pricing"}>
                <div className="ml-calc-layout">
                  <div className="ml-calc-inputs">
                    <div className="ml-field-top">
                      <span className="ml-field-icon">◇</span>
                      <div><small>PRODUTO</small><strong>Vaso geométrico</strong></div>
                      <span className="ml-field-chevron">⌄</span>
                    </div>
                    <div className="ml-calc-field">
                      <label htmlFor="weight">
                        Filamento previsto <strong><output id="weight-value" htmlFor="weight">{weight}</output> g</strong>
                      </label>
                      <input
                        id="weight"
                        type="range"
                        min="20"
                        max="300"
                        step="5"
                        value={weight}
                        aria-valuetext={`${weight} gramas`}
                        onChange={(event) => updatePrice(Number(event.target.value))}
                        style={{ background: `linear-gradient(to right,var(--ml-purple, var(--purple, #2B00FF)) ${sliderPercent}%,#ececf6 ${sliderPercent}%)` }}
                      />
                      <div className="ml-range-labels"><span>20 g</span><span>300 g</span></div>
                    </div>
                    <div className="ml-loss-row"><span>Perda adicional de filamento</span><span>5%</span></div>
                    <div className="ml-source-chip">
                      <div className="ml-purple-swatch" />
                      <div><strong>PLA · Violeta</strong><small>Carretel de 1 kg · R$ 100,00</small></div>
                      <span>✓</span>
                    </div>
                    <div className="ml-calc-hint"><span>↔</span> Mova o controle e veja o preço mudar.</div>
                  </div>
                  <div className="ml-calc-result">
                    <div className="ml-micro">COMPOSIÇÃO DO CUSTO</div>
                    <div className="ml-cost-row"><span>Filamento + perda</span><strong id="filament-cost">{brl(filament)}</strong></div>
                    <div className="ml-cost-row"><span>Energia e máquina</span><strong>R$ 5,00</strong></div>
                    <div className="ml-cost-row"><span>Embalagem e acabamento</span><strong>R$ 4,00</strong></div>
                    <div className="ml-cost-total"><span>Custo estimado</span><strong id="cost-total">{brl(filament + 9)}</strong></div>
                    <div className="ml-suggested">
                      <span>Preço com acréscimo de 100%</span>
                      <strong id="suggested">{brl((filament + 9) * 2)}</strong>
                      <small>Exemplo de cálculo, ajustável à sua operação.</small>
                    </div>
                    <button
                      type="button"
                      className="ml-button ml-demo-save"
                      onClick={() => toast("Exemplo calculado! Na versão real, ele fica no seu histórico.")}
                    >
                      Salvar precificação <span>↗</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className={panelClass("stock")} id="panel-stock" hidden={tab !== "stock"}>
                <div className="ml-stock-head">
                  <div><h4>Cada material no seu lugar.</h4><p>Saldo físico, referência de custo e histórico.</p></div>
                  <span className="ml-stock-total">3 materiais neste exemplo</span>
                </div>
                <div className="ml-material-grid">
                  <article className="ml-material-demo">
                    <div className="ml-big-spool ml-purple-spool"><i /></div>
                    <span className="ml-micro">FILAMENTO / PLA</span>
                    <h4>Violeta criativo</h4>
                    <div className="ml-stock-stat">750 <small>/ 1.000 g</small></div>
                    <div className="ml-stock-bar"><i style={{ width: "75%" }} /></div>
                    <span className="ml-stock-caption">Preço de compra: R$ 100,00</span>
                  </article>
                  <article className="ml-material-demo">
                    <div className="ml-big-spool ml-orange-spool"><i /></div>
                    <span className="ml-micro">FILAMENTO / PETG</span>
                    <h4>Terracota</h4>
                    <div className="ml-stock-stat">420 <small>/ 1.000 g</small></div>
                    <div className="ml-stock-bar ml-orange"><i style={{ width: "42%" }} /></div>
                    <span className="ml-stock-caption">Preço de compra: R$ 120,00</span>
                  </article>
                  <article className="ml-material-demo">
                    <div className="ml-box-art">▱</div>
                    <span className="ml-micro">MATERIAL GERAL / EMBALAGEM</span>
                    <h4>Caixa kraft</h4>
                    <div className="ml-stock-stat">24 <small>unidades</small></div>
                    <div className="ml-stock-bar ml-gray"><i style={{ width: "80%" }} /></div>
                    <span className="ml-stock-caption">Referência: R$ 2,50 por unidade</span>
                  </article>
                </div>
              </div>
              <div className={panelClass("orders")} id="panel-orders" hidden={tab !== "orders"}>
                <div className="ml-stock-head">
                  <div><h4>Uma visão do que vem pela frente.</h4><p>Experimente avançar o pedido entre as etapas.</p></div>
                  <button
                    type="button"
                    className="ml-text-button"
                    id="reset-order"
                    onClick={() => { setOrderStage(0); setOrderChanged(true); }}
                  >
                    Reiniciar ↺
                  </button>
                </div>
                <div className="ml-kanban">
                  <div className="ml-kanban-col">
                    <div className="ml-kanban-label"><i /> Orçado <span id="count-quoted">{orderStage === 0 ? 1 : 0}</span></div>
                    {orderStage === 0 && orderCard}
                  </div>
                  <div className="ml-kanban-col">
                    <div className="ml-kanban-label"><i className="ml-orange-bg" /> Pago <span id="count-paid">{orderStage === 1 ? 1 : 0}</span></div>
                    <div className="ml-kanban-empty" id="empty-paid" hidden={orderStage === 1}>Próxima etapa<br /><span>↘</span></div>
                    {orderStage === 1 && orderCard}
                  </div>
                  <div className="ml-kanban-col">
                    <div className="ml-kanban-label"><i className="ml-green-bg" /> Entregue <span id="count-delivered">{orderStage === 2 ? 2 : 1}</span></div>
                    <article className="ml-order-card ml-delivered-card">
                      <span className="ml-order-number">PEDIDO #021</span>
                      <h4>Suporte de mesa</h4>
                      <p>1 peça · Grafite</p>
                      <div className="ml-order-footer"><strong>R$ 45,00</strong><span className="ml-delivered-check">✓</span></div>
                    </article>
                    {orderStage === 2 && orderCard}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="ml-app-bottom">
            <span><i /> Explore as abas acima</span>
            <span>Uma prévia visual. Nenhum dado real é alterado.</span>
          </div>
        </div>
      </div>
      <div className={`ml-toast${toastMessage ? " ml-visible" : ""}`} role="status" aria-live="polite" aria-atomic="true">
        <span aria-hidden="true">✓</span><p>{toastMessage}</p>
      </div>
    </section>
  );
}
