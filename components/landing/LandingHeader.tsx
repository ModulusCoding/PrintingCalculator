"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export default function LandingHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) { setOpen(false); toggle.current?.focus(); }
    };
    const resize = () => { if (window.innerWidth > 880) setOpen(false); };
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("keydown", escape); window.removeEventListener("resize", resize); };
  }, [open]);
  const links = <><a href="#funcionalidades">O que você ganha</a><a href="#fluxo">Como funciona</a><a href="#planos">Planos</a><a href="#duvidas">Dúvidas</a></>;
  return <header className="ml-header" id="topo"><div className="ml-nav-wrap">
    <a className="ml-brand" href="#inicio" aria-label="Modulus Hub início"><svg viewBox="0 0 34 34" className="ml-brand-mark" aria-hidden="true"><path d="M3 25V9l7-4 7 9 7-9 7 4v16l-7 4V16l-7 9-7-9v13Z" fill="currentColor" /></svg><span>modulus<span className="ml-brand-dot">.</span></span><span className="ml-hub-tag">hub</span></a>
    <nav className="ml-desktop-nav" aria-label="Navegação principal">{links}</nav>
    <div className="ml-nav-actions"><Link className="ml-text-button ml-login" href="/admin/login">Entrar <span>↗</span></Link><a className="ml-button ml-small ml-magnetic" href="#planos">Começar grátis <span>↗</span></a><button ref={toggle} className="ml-menu-toggle" aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}><span /><span /></button></div>
  </div><nav className="ml-mobile-nav" id="mobile-nav" aria-label="Navegação móvel" hidden={!open} onClick={() => setOpen(false)}>{links}<Link href="/admin/login">Entrar no Hub ↗</Link></nav></header>;
}
