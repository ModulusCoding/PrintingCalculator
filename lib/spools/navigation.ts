export const spoolListPath = "/estoque/carreteis";
export function safePage(value: unknown): number {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 5001 ? Number(value) : 1;
}
export function normalizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !/^\/estoque\/carreteis(?:\?|$)/.test(value) || value.includes("#") || value.includes("\\")) return spoolListPath;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== spoolListPath) return spoolListPath;
    for (const key of url.searchParams.keys()) {
      if (!["search", "status", "page"].includes(key) || url.searchParams.getAll(key).length !== 1) return spoolListPath;
    }
    const search = url.searchParams.get("search");
    const status = url.searchParams.get("status");
    const page = url.searchParams.get("page");
    if (search !== null && search.length > 120) return spoolListPath;
    if (status !== null && !["active", "low", "empty", "archived", "all"].includes(status)) return spoolListPath;
    if (page !== null && (safePage(page) !== Number(page) || !/^[1-9]\d*$/.test(page))) return spoolListPath;
    const q = new URLSearchParams();
    if (search?.trim()) q.set("search", search.trim());
    if (status) q.set("status", status);
    if (page) q.set("page", page);
    return q.size ? `${spoolListPath}?${q}` : spoolListPath;
  } catch { return spoolListPath; }
}
export function spoolDetailHref(id: string, returnTo?: unknown) {
  return `${spoolListPath}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: normalizeReturnTo(returnTo) })}`;
}
