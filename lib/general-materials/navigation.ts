export const generalMaterialsPath = "/estoque/materiais-gerais";

export function safePage(value: unknown): number {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 5001 ? Number(value) : 1;
}

export function normalizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !/^\/estoque\/materiais-gerais(?:\?|$)/.test(value) || value.includes("#") || value.includes("\\")) return generalMaterialsPath;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== generalMaterialsPath) return generalMaterialsPath;
    for (const key of url.searchParams.keys()) if (!["search", "status", "page"].includes(key) || url.searchParams.getAll(key).length !== 1) return generalMaterialsPath;
    const search = url.searchParams.get("search"), status = url.searchParams.get("status"), page = url.searchParams.get("page");
    if (search !== null && search.length > 120) return generalMaterialsPath;
    if (status !== null && !["active", "archived", "all"].includes(status)) return generalMaterialsPath;
    if (page !== null && (!/^[1-9]\d*$/.test(page) || safePage(page) !== Number(page))) return generalMaterialsPath;
    const q = new URLSearchParams();
    if (search?.trim()) q.set("search", search.trim());
    if (status) q.set("status", status);
    if (page) q.set("page", page);
    return q.size ? `${generalMaterialsPath}?${q}` : generalMaterialsPath;
  } catch { return generalMaterialsPath; }
}

export function materialDetailHref(id: string, returnTo?: unknown) {
  return `${generalMaterialsPath}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: normalizeReturnTo(returnTo) })}`;
}