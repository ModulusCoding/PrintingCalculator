export const inventoryListPath = "/estoque/produtos";
export function safePage(value: unknown): number {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 5001 ? Number(value) : 1;
}
export function parseInventoryListUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !/^\/estoque\/produtos(?:\?|$)/.test(value) || value.includes("#") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== inventoryListPath) return null;
    for (const key of url.searchParams.keys()) {
      if (!["search", "balanceFilter", "productStatus", "page"].includes(key) || url.searchParams.getAll(key).length !== 1) return null;
    }
    return url;
  } catch { return null; }
}
export function parseListQuery(value: unknown): { search: string; balanceFilter: "all" | "with_balance" | "without_balance"; productStatus: "active" | "archived" | "all"; page: number } {
  const url = parseInventoryListUrl(value);
  if (!url) return { search: "", balanceFilter: "all", productStatus: "active", page: 1 };
  const search = url.searchParams.get("search") ?? "";
  const balanceFilter = url.searchParams.get("balanceFilter");
  const productStatus = url.searchParams.get("productStatus");
  const page = url.searchParams.get("page");
  if (search.length > 120 || (balanceFilter && !["all", "with_balance", "without_balance"].includes(balanceFilter)) || (productStatus && !["active", "archived", "all"].includes(productStatus)) || (page && safePage(page) !== Number(page))) return { search: "", balanceFilter: "all", productStatus: "active", page: 1 };
  return { search: search.trim(), balanceFilter: (balanceFilter ?? "all") as "all" | "with_balance" | "without_balance", productStatus: (productStatus ?? "active") as "active" | "archived" | "all", page: page ? safePage(page) : 1 };
}
export function normalizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !/^\/estoque\/produtos(?:\?|$)/.test(value) || value.includes("#") || value.includes("\\")) return inventoryListPath;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== inventoryListPath) return inventoryListPath;
    for (const key of url.searchParams.keys()) {
      if (!["search", "balanceFilter", "productStatus", "page"].includes(key) || url.searchParams.getAll(key).length !== 1) return inventoryListPath;
    }
    const search = url.searchParams.get("search");
    const balanceFilter = url.searchParams.get("balanceFilter");
    const productStatus = url.searchParams.get("productStatus");
    const page = url.searchParams.get("page");
    if (search !== null && search.length > 120) return inventoryListPath;
    if (balanceFilter !== null && !["all", "with_balance", "without_balance"].includes(balanceFilter)) return inventoryListPath;
    if (productStatus !== null && !["active", "archived", "all"].includes(productStatus)) return inventoryListPath;
    if (page !== null && (safePage(page) !== Number(page) || !/^[1-9]\d*$/.test(page))) return inventoryListPath;
    const q = new URLSearchParams();
    if (search?.trim()) q.set("search", search.trim());
    if (balanceFilter) q.set("balanceFilter", balanceFilter);
    if (productStatus) q.set("productStatus", productStatus);
    if (page) q.set("page", page);
    return q.size ? `${inventoryListPath}?${q}` : inventoryListPath;
  } catch { return inventoryListPath; }
}
export function productInventoryDetailHref(id: string, returnTo?: unknown) {
  return `${inventoryListPath}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: normalizeReturnTo(returnTo) })}`;
}
