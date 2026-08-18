"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logoutAction } from "@/lib/auth/actions";
import {
  LayoutDashboard,
  FolderKanban,
  Package,
  LogOut,
  ExternalLink,
  Calculator,
  Menu,
  X,
} from "lucide-react";
import { useState, memo } from "react";

interface SidebarProps {
  userEmail?: string;
}

const navItems = [
  { name: "Visão Geral", href: "/admin", icon: LayoutDashboard, exact: true },
  { name: "Catálogos", href: "/admin/catalogs", icon: FolderKanban, exact: false },
  { name: "Produtos", href: "/admin/products", icon: Package, exact: false },
];

interface SidebarContentProps {
  userEmail?: string;
  pathname: string;
  setMobileOpen: (open: boolean) => void;
  handleLogout: () => Promise<void>;
}

const SidebarContent = memo(function SidebarContent({
  userEmail,
  pathname,
  setMobileOpen,
  handleLogout,
}: SidebarContentProps) {
  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <div className="flex flex-col h-full justify-between bg-slate-900 text-slate-100 p-4">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 py-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center shadow-lg shadow-blue-500/20">
              M
            </div>
            <div>
              <h1 className="font-bold text-base text-white tracking-wide">MODULUS</h1>
              <span className="text-xs text-slate-400 font-medium">Admin Manager</span>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-slate-400 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer / User Profile & Extra Actions */}
      <div className="space-y-4 pt-4 border-t border-slate-800">
        <Link
          href="/"
          target="_blank"
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <Calculator className="w-4 h-4" />
          <span>Ir para Calculadora 3D</span>
          <ExternalLink className="w-3 h-3 ml-auto opacity-70" />
        </Link>

        {userEmail && (
          <div className="px-3.5 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50">
            <p className="text-xs text-slate-400 truncate">Conectado como</p>
            <p className="text-xs font-semibold text-slate-200 truncate mt-0.5">
              {userEmail}
            </p>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span>Sair da conta</span>
        </button>
      </div>
    </div>
  );
});

export function AdminSidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logoutAction();
    router.push("/admin/login");
    router.refresh();
  };

  return (
    <>
      {/* Mobile Header Bar */}
      <div className="md:hidden flex items-center justify-between p-4 bg-slate-900 text-white border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
            M
          </div>
          <span className="font-bold text-sm tracking-wide">MODULUS ADMIN</span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-slate-950/80 backdrop-blur-sm">
          <div className="fixed inset-y-0 left-0 w-72 bg-slate-900 shadow-2xl">
            <SidebarContent
              userEmail={userEmail}
              pathname={pathname}
              setMobileOpen={setMobileOpen}
              handleLogout={handleLogout}
            />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-slate-800">
        <SidebarContent
          userEmail={userEmail}
          pathname={pathname}
          setMobileOpen={setMobileOpen}
          handleLogout={handleLogout}
        />
      </aside>
    </>
  );
}