import type { Permission } from "@/lib/auth/context";

/** Capability is independent of role and creation quotas. Product registration,
 * pricing snapshots and legacy sales must not inherit the paid inventory gate.
 * Finished-stock operations are a distinct existing permission contract.
 */
export function permissionRequiresVisionario(permission: Permission): boolean {
  return /^(printers\.|materials\.|spools\.|stock\.materials\.|inventory\.)/.test(permission);
}
