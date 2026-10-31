"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Home, Building2, Users, Menu, X, Package, Printer, Layers, Calculator, LockKeyhole, Settings, ChevronDown, PanelLeftClose, PanelLeftOpen, ShoppingBag, CircleUserRound, CircleDot, type LucideIcon } from "lucide-react";
import { LogoutButton } from "@/app/conta/LogoutButton";
import { getNavigation, getPageNavigation, isItemActive, matchesRoute, type ShellAccess } from "@/components/layout/navigation";
import styles from "@/components/layout/shell.module.css";

const icons: Record<string, LucideIcon> = { home: Home, pricing: Calculator, products: Package, orders: ShoppingBag, printers: Printer, materials: Layers, spools: CircleDot, enterprise: Building2, team: Users };

export function AuthenticatedShell({ children, enterpriseName, ...access }: ShellAccess & { children: React.ReactNode; enterpriseName?: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [settingsPreference, setSettingsPreference] = useState<{ pathname: string; open: boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const page = getPageNavigation(pathname, access);
  const settingsActive = ["/conta", "/meu-plano", "/planos"].includes(pathname);
  const settingsOpen = settingsPreference?.pathname === pathname ? settingsPreference.open : settingsActive;

  const previousOverflow = useRef<string | null>(null);
  function restoreScroll() {
    if (previousOverflow.current !== null) { document.body.style.overflow = previousOverflow.current; previousOverflow.current = null; }
  }
  function closeDrawer() { dialog.current?.close(); restoreScroll(); }
  function openDrawer() {
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    closeButton.current?.focus();
  }

  useEffect(() => { dialog.current?.close(); }, [pathname]);
  useEffect(() => () => {
    if (previousOverflow.current !== null) document.body.style.overflow = previousOverflow.current;
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const onChange = () => { if (media.matches) dialog.current?.close(); };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function navigation(mobile: boolean) {
    const compact = collapsed && !mobile;
    const prefix = mobile ? "mobile" : "desktop";
    return <nav aria-label={mobile ? "Navegação principal móvel" : "Navegação principal"} className={styles.navigation}>
      <ul className={styles.list}>
        {getNavigation(access).filter((item) => item.visible).map((item) => {
          const Icon = icons[item.icon];
          const active = isItemActive(pathname, item);
          const href = item.href;
          return <li key={href}><Link href={href} prefetch={item.paid && access.paidModulesLocked ? false : undefined} onClick={mobile ? closeDrawer : undefined} className={`${styles.navItem} ${active ? styles.active : ""}`} aria-current={active ? "page" : undefined} title={compact ? item.label : undefined}>
            <Icon size={20} aria-hidden="true" /><span className={compact ? "sr-only" : styles.navLabel}>{item.label}</span>
            {item.paid && access.paidModulesLocked ? <LockKeyhole size={14} className={styles.lock} aria-label="Requer Visionário; conhecer este recurso" /> : null}
          </Link></li>;
        })}
        <li>
          <button type="button" className={`${styles.navItem} ${settingsActive ? styles.active : ""}`} aria-expanded={settingsOpen} aria-controls={`${prefix}-settings`} title={compact ? "Configurações" : undefined} onClick={() => { if (compact) setCollapsed(false); setSettingsPreference({ pathname, open: !settingsOpen }); }}>
            <Settings size={20} aria-hidden="true" /><span className={compact ? "sr-only" : styles.navLabel}>Configurações</span>{!compact ? <ChevronDown size={16} aria-hidden="true" className={settingsOpen ? styles.rotated : ""} /> : null}
          </button>
          <ul id={`${prefix}-settings`} hidden={!settingsOpen} className={styles.submenu}>
            {access.canManageEnterprise ? <li><Link href="/meu-plano" onClick={mobile ? closeDrawer : undefined} className={`${styles.subItem} ${pathname === "/meu-plano" || pathname === "/planos" ? styles.active : ""}`} aria-current={pathname === "/meu-plano" ? "page" : undefined} title={compact ? "Meu plano" : undefined}>Meu plano</Link></li> : null}
            <li><Link href="/conta" onClick={mobile ? closeDrawer : undefined} className={`${styles.subItem} ${pathname === "/conta" ? styles.active : ""}`} aria-current={pathname === "/conta" ? "page" : undefined} title={compact ? "Minha conta" : undefined}>{compact ? <CircleUserRound size={20} aria-label="Minha conta" /> : "Minha conta"}</Link></li>
          </ul>
        </li>
      </ul>
    </nav>;
  }

  function brand(compact: boolean) {
    return <Link href="/home" onClick={closeDrawer} className={styles.brand} aria-label="Modulus — Home"><Image src={compact ? "/logo.svg" : "/logo_Horizontal.svg"} alt="Modulus" width={compact ? 40 : 184} height={compact ? 40 : 38} priority /><span className={compact ? "sr-only" : styles.hub}>HUB</span></Link>;
  }

  return <div className={styles.shell} data-collapsed={collapsed}>
    <a href="#main-content" className={styles.skip}>Pular para o conteúdo</a>
    <aside className={styles.sidebar}>
      <div className={styles.sidebarBrand}>{brand(collapsed)}<button type="button" onClick={() => setCollapsed(!collapsed)} className={styles.iconButton} aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"} aria-expanded={!collapsed}>{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button></div>
      {navigation(false)}
      <div className={styles.sidebarFooter}><LogoutButton /></div>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.header}>
        <button ref={menuButton} type="button" onClick={openDrawer} className={`${styles.iconButton} ${styles.mobileToggle}`} aria-label="Abrir navegação" aria-haspopup="dialog" aria-controls="mobile-navigation"><Menu size={22} aria-hidden="true" /></button>
        <div className={styles.pageHeading}><p className={styles.eyebrow}>{page.section}</p><p className={styles.pageTitle}>{page.title}</p></div>
        {enterpriseName ? <span className={styles.enterprise} title={enterpriseName}><Building2 size={16} aria-hidden="true" /><span>{enterpriseName}</span></span> : null}
        <Link href="/conta" className={styles.iconButton} aria-label="Acessar Minha conta" title="Minha conta"><CircleUserRound size={22} aria-hidden="true" /></Link>
      </header>
      {page.related.length > 0 ? <nav aria-label={`Navegação de ${page.title}`} className={styles.related}>{page.related.map((entry) => <Link key={entry.href} href={entry.href} prefetch={entry.paid && access.paidModulesLocked ? false : undefined} aria-current={pathname === entry.href ? "page" : undefined} className={pathname === entry.href || (entry.href !== "/estoque/carreteis" && matchesRoute(pathname, entry.href)) ? styles.relatedActive : ""}>{entry.label}</Link>)}</nav> : null}
      <main id="main-content" tabIndex={-1} className={styles.main}>{children}</main>
    </div>
    <dialog ref={dialog} id="mobile-navigation" aria-labelledby="mobile-nav-title" className={styles.drawer} onClose={() => { restoreScroll(); menuButton.current?.focus(); }} onClick={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
      <div className={styles.drawerPanel}>
        <div className={styles.drawerHeader}>{brand(false)}<button ref={closeButton} type="button" onClick={closeDrawer} className={styles.iconButton} aria-label="Fechar navegação"><X size={22} aria-hidden="true" /></button></div>
        <h2 id="mobile-nav-title" className="sr-only">Navegação do Modulus Hub</h2>
        {navigation(true)}
        <div className={styles.sidebarFooter}><LogoutButton /></div>
      </div>
    </dialog>
  </div>;
}
