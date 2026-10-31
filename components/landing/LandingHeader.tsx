"use client";

import Link from "next/link";
import LandingBrand from "./LandingBrand";
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
    <a className="ml-brand" href="#inicio" aria-label="Modulus Hub início"><LandingBrand /></a>
    <nav className="ml-desktop-nav" aria-label="Navegação principal">{links}</nav>
    <div className="ml-nav-actions"><Link className="ml-text-button ml-login" href="/admin/login">Entrar</Link><a className="ml-button ml-small ml-magnetic" href="#planos">Começar grátis</a><button ref={toggle} className="ml-menu-toggle" aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}><span /><span /></button></div>
  </div><nav className="ml-mobile-nav" id="mobile-nav" aria-label="Navegação móvel" hidden={!open} onClick={() => setOpen(false)}>{links}<Link href="/admin/login">Entrar no Hub</Link></nav></header>;
}
