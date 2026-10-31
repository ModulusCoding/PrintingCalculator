import { Asterisk, Calculator, Check, Play, Sparkle } from "lucide-react";
import VaseLayers from "./VaseLayers";

export default function LandingHero() { return (
<section className="ml-hero" id="inicio">
<div className="ml-hero-grid" aria-hidden="true"></div><div className="ml-hero-glow" aria-hidden="true"></div>
<div className="ml-container ml-hero-content"><div className="ml-hero-copy">
<div className="ml-eyebrow ml-hero-in"><span className="ml-live-dot"></span> FEITO PARA QUEM CRIA EM 3D</div>
<h1 className="ml-hero-in">Sua próxima<br /> camada de<br /><span className="ml-purple-word">crescimento<svg viewBox="0 0 480 20" preserveAspectRatio="none" aria-hidden="true"><path d="M4 14 Q245 -3 475 10"/></svg></span><span className="ml-orange-dot">.</span></h1>
<p className="ml-hero-description ml-hero-in">Você transforma filamento em possibilidades.<br /> O Hub transforma sua rotina em uma operação organizada.</p>
<div className="ml-hero-ctas ml-hero-in"><a className="ml-button ml-magnetic" href="#planos">Começar minha jornada</a><a className="ml-demo-link" href="#demonstracao"><span className="ml-play"><Play size={14} strokeWidth={1.75} aria-hidden="true" /></span> Explorar o Hub</a></div>
<div className="ml-hero-note ml-hero-in"><span className="ml-tiny-check"><Check size={14} strokeWidth={1.75} aria-hidden="true" /></span> Plano gratuito <span className="ml-separator"></span> Sem cartão para começar</div>
</div>
<div className="ml-hero-art ml-hero-in" aria-label="Ilustração de um vaso impresso em camadas, com exemplos de precificação e filamento">
<div className="ml-orbital ml-orbital-one"></div><div className="ml-orbital ml-orbital-two"></div><div className="ml-art-coordinates">OBJETO 001 / IDEIAS EM MOVIMENTO</div>
<div className="ml-vase-stage"><div className="ml-vase-shadow"></div><svg id="vase" viewBox="0 0 420 460" role="img" aria-label="Vaso geométrico em camadas roxas"><defs><linearGradient id="vaseGrad" x1="0" x2="1"><stop offset="0" stopColor="#2B00FF"/><stop offset=".42" stopColor="#6344ff"/><stop offset=".7" stopColor="#A18AFF"/><stop offset="1" stopColor="#3D13D9"/></linearGradient><linearGradient id="vaseTop"><stop stopColor="#e0d7ff"/><stop offset="1" stopColor="#6744e7"/></linearGradient></defs><VaseLayers /></svg><div className="ml-platform"><span>m.</span></div></div>
<div className="ml-float-card ml-cost-float"><span className="ml-mini-icon ml-violet"><Calculator size={20} strokeWidth={1.75} aria-hidden="true" /></span><div><span className="ml-micro">CLAREZA PARA PRECIFICAR</span><strong>Conheça cada custo.</strong></div><span className="ml-card-spark"><Sparkle size={20} strokeWidth={1.75} aria-hidden="true" /></span></div>
<div className="ml-float-card ml-material-float"><div className="ml-spool-mini"><i></i></div><div><span className="ml-micro">SEU FILAMENTO, ORGANIZADO</span><strong>PLA · Violeta</strong><span className="ml-material-line"><i></i></span></div><span className="ml-material-amount">750<span>g</span></span></div>
<div className="ml-art-chip"><span className="ml-live-dot"></span> Menos improviso. Mais possibilidades.</div>
<span className="ml-art-star ml-star-one" aria-hidden="true"><Asterisk size="1em" strokeWidth={1.75} aria-hidden="true" /></span><span className="ml-art-star ml-star-two" aria-hidden="true"><Sparkle size="1em" strokeWidth={1.75} aria-hidden="true" /></span>
</div></div>
<div className="ml-container ml-hero-bottom"><span>DA IDEIA À ENTREGA. CADA ETAPA CONECTADA.</span><a href="#demonstracao" className="ml-scroll-cue" aria-label="Rolar para a demonstração"><span>ROLE PARA EXPLORAR</span></a></div>
</section>
); }
