export type ShellAccess = {
  canManageEnterprise: boolean;
  canManageMembers: boolean;
  canReadPrinters: boolean;
  canReadMaterials: boolean;
  canReadGeneralMaterials: boolean;
  canReadSpools: boolean;
  canReadInventory: boolean;
  canReadPricing: boolean;
  paidModulesLocked: boolean;
};

export type NavigationItem = { label: string; href: string; icon: "home" | "pricing" | "products" | "orders" | "printers" | "materials" | "spools" | "enterprise" | "team"; visible: boolean; paid?: boolean };
export const matchesRoute = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function getNavigation(access: ShellAccess): NavigationItem[] {
  return [
    { label: "Home", href: "/home", icon: "home", visible: true },
    { label: "Precificadora", href: "/precificadora", icon: "pricing", visible: access.canReadPricing },
    { label: "Produtos", href: "/admin/products", icon: "products", visible: true },
    { label: "Pedidos", href: "/admin/orders", icon: "orders", visible: true },
    { label: "Impressoras", href: "/impressoras", icon: "printers", visible: access.canReadPrinters, paid: true },
    { label: "Materiais gerais", href: "/estoque/materiais-gerais", icon: "materials", visible: access.canReadGeneralMaterials, paid: true },
    { label: "Carretéis", href: "/estoque/carreteis", icon: "spools", visible: access.canReadSpools, paid: true },
    { label: "Dados empresa", href: "/empresa", icon: "enterprise", visible: access.canManageEnterprise },
    { label: "Equipe", href: "/empresa/equipe", icon: "team", visible: access.canManageMembers },
  ];
}

export function isItemActive(pathname: string, item: NavigationItem) {
  if (item.icon === "enterprise") return pathname === "/empresa";
  if (item.icon === "products") return matchesRoute(pathname, item.href) || matchesRoute(pathname, "/estoque/produtos") || matchesRoute(pathname, "/admin/catalogs");
  if (item.icon === "materials") return matchesRoute(pathname, item.href) || matchesRoute(pathname, "/materiais");
  if (item.icon === "team") return matchesRoute(pathname, item.href) || matchesRoute(pathname, "/conta/equipe");
  return matchesRoute(pathname, item.href);
}

export function getPageNavigation(pathname: string, access: ShellAccess) {
  const items = getNavigation(access);
  const item = items.find((entry) => isItemActive(pathname, entry));
  let title = item?.label ?? "Modulus Hub";
  let section = "Operação";
  if (pathname === "/conta") { title = "Minha conta"; section = "Configurações"; }
  else if (pathname === "/meu-plano" || pathname === "/planos") { title = pathname === "/planos" ? "Planos" : "Meu plano"; section = "Configurações"; }
  else if (item?.icon === "enterprise" || item?.icon === "team") section = "Empresa";
  else if (item?.icon === "home") section = "Visão geral";
  if (matchesRoute(pathname, "/estoque/produtos")) title = "Produtos prontos";
  if (matchesRoute(pathname, "/admin/catalogs")) title = "Catálogos";
  if (matchesRoute(pathname, "/materiais")) title = "Materiais";
  if (pathname === "/estoque/carreteis/configuracao") title = "Alerta de estoque";
  const related: { label: string; href: string; paid?: boolean }[] = [];
  if (item?.icon === "products") {
    related.push({ label: "Produtos", href: "/admin/products" });
    if (access.canReadInventory) related.push({ label: "Produtos prontos", href: "/estoque/produtos", paid: true });
  }
  if (item?.icon === "materials") {
    if (access.canReadGeneralMaterials) related.push({ label: "Materiais gerais", href: "/estoque/materiais-gerais", paid: true });
    if (access.canReadMaterials) related.push({ label: "Materiais", href: "/materiais", paid: true });
  }
  if (item?.icon === "spools" && access.canReadSpools) related.push({ label: "Carretéis", href: "/estoque/carreteis", paid: true }, { label: "Alerta de estoque", href: "/estoque/carreteis/configuracao", paid: true });
  return { title, section, related };
}
