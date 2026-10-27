"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Home, Building2, Users, Menu, X, Package, Printer, Layers, Calculator, LockKeyhole, type LucideIcon } from "lucide-react";
import { LogoutButton } from "@/app/conta/LogoutButton";
export function AuthenticatedShell({ children, canManageEnterprise, canManageMembers, canReadPrinters, canReadMaterials, canReadGeneralMaterials, canReadSpools, canReadInventory, canReadPricing, paidModulesLocked }:  { children: React.ReactNode; canManageEnterprise: boolean; canManageMembers: boolean; canReadPrinters: boolean; canReadMaterials: boolean; canReadGeneralMaterials: boolean; canReadSpools: boolean; canReadInventory: boolean; canReadPricing: boolean; paidModulesLocked: boolean }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navClass = (active: boolean) => `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3d32e6] ${active ? "bg-[#5852ff] text-[#f2eeff]" : "text-[#464556] hover:bg-[#e7e8e9]"}`;
  const paidModuleLink = (href: string, label: string, Icon: LucideIcon) => {
    const active = pathname.startsWith(href);
    return <Link href={href} prefetch={paidModulesLocked ? false : undefined} onClick={() => setMobileOpen(false)} className={navClass(active)} aria-current={active ? "page" : undefined}>
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{label}</span>
      {paidModulesLocked && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-1.5 py-1 text-[10px] font-semibold text-amber-950"><LockKeyhole className="size-3" aria-hidden="true" />Visionário<span className="sr-only"> — requer Visionário; conhecer este recurso</span></span>}
    </Link>;
  };
  const nav = (
    <>
      <Link href="/home" onClick={() => setMobileOpen(false)} className={navClass(pathname === "/home")} aria-current={pathname === "/home" ? "page" : undefined}><Home className="size-5" aria-hidden="true" />Home</Link>
      <Link href="/conta" className={navClass(false)}>Minha conta</Link>
      {canManageEnterprise && <Link href="/meu-plano" className={navClass(false)}>Meu plano</Link>}
      
      <div className="mt-7"><p className="mb-2 px-4 text-xs font-semibold uppercase tracking-widest text-[#464556]/60">Operação</p><div className="space-y-1">
        <Link href="/admin/products" onClick={() => setMobileOpen(false)} className={navClass(pathname.startsWith("/admin/products"))} aria-current={pathname.startsWith("/admin/products") ? "page" : undefined}><Package className="size-5" aria-hidden="true" />Produtos</Link>
        <Link href="/admin/orders" onClick={() => setMobileOpen(false)} className={navClass(pathname.startsWith("/admin/orders"))} aria-current={pathname.startsWith("/admin/orders") ? "page" : undefined}><Package className="size-5" aria-hidden="true" />Pedidos</Link>
        {canReadPrinters && paidModuleLink("/impressoras", "Impressoras", Printer)}
        {canReadMaterials && paidModuleLink("/materiais", "Materiais", Layers)}
        {canReadGeneralMaterials && paidModuleLink("/estoque/materiais-gerais", "Materiais gerais", Layers)}
        {canReadInventory && paidModuleLink("/estoque/produtos", "Produtos prontos", Package)}
        {canReadSpools && <>{paidModuleLink("/estoque/carreteis", "Carretéis", Package)}{paidModuleLink("/estoque/carreteis/configuracao", "Alerta de estoque", Package)}</>}
        {canReadPricing && <Link href="/precificadora" onClick={() => setMobileOpen(false)} className={navClass(pathname.startsWith("/precificadora"))} aria-current={pathname.startsWith("/precificadora") ? "page" : undefined}><Calculator className="size-5" aria-hidden="true" />Precificadora</Link>}
      </div></div>

      {(canManageEnterprise || canManageMembers) && <div className="mt-7"><p className="mb-2 px-4 text-xs font-semibold uppercase tracking-widest text-[#464556]/60">Empresa</p><div className="space-y-1">
        {canManageEnterprise && <Link href="/empresa" onClick={() => setMobileOpen(false)} className={navClass(pathname === "/empresa")} aria-current={pathname === "/empresa" ? "page" : undefined}><Building2 className="size-5" aria-hidden="true" />Dados da empresa</Link>}
        {canManageMembers && <Link href="/empresa/equipe" onClick={() => setMobileOpen(false)} className={navClass(pathname.startsWith("/empresa/equipe"))} aria-current={pathname.startsWith("/empresa/equipe") ? "page" : undefined}><Users className="size-5" aria-hidden="true" />Equipe</Link>}
      </div></div>}
    </>
  );
  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#152336]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3 focus:ring-2 focus:ring-[#5852ff]">Pular para o conteúdo</a>
      <header className="flex items-center justify-between border-b border-[#c7c4d9] bg-[#f3f4f5] px-4 py-4 md:hidden"><Link href="/home" className="text-xl font-bold tracking-tight text-[#3d32e6]">Modulus</Link><button type="button" onClick={() => setMobileOpen(v => !v)} aria-expanded={mobileOpen} aria-controls="mobile-navigation" aria-label={mobileOpen ? "Fechar navegação" : "Abrir navegação"} className="rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-[#3d32e6]">{mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button></header>
      {mobileOpen && <nav id="mobile-navigation" aria-label="Navegação principal móvel" className="border-b border-[#c7c4d9] bg-[#f3f4f5] p-4 md:hidden">{nav}<div className="mt-6"><LogoutButton /></div></nav>}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-[#c7c4d9] bg-[#f3f4f5] p-4 md:flex"><Link href="/home" className="px-4 py-5 text-2xl font-bold tracking-tight text-[#3d32e6] focus:outline-none focus:ring-2 focus:ring-[#5852ff]">Modulus</Link><nav aria-label="Navegação principal" className="mt-5 flex-1 overflow-y-auto">{nav}</nav><div className="border-t border-[#c7c4d9] pt-4"><LogoutButton /></div></aside>
      <main id="main-content" tabIndex={-1} className="min-w-0 p-5 md:ml-64 md:p-10">{children}</main>
    </div>
  );
}
