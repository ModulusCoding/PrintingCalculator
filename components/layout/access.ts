import { ROLE_PERMISSIONS, type Permission } from "@/lib/auth/context";
import type { ShellAccess } from "./navigation";

// Presentation only: all route/action authorization remains on the server.
export function shellAccessForRole(role: keyof typeof ROLE_PERMISSIONS): ShellAccess {
  const permissions: readonly Permission[] = ROLE_PERMISSIONS[role];
  return {
    canManageEnterprise: permissions.includes("enterprise.manage"),
    canManageMembers: permissions.includes("members.manage_operators"),
    canReadPrinters: permissions.includes("printers.read"),
    canReadMaterials: permissions.includes("materials.read"),
    canReadGeneralMaterials: permissions.includes("stock.materials.read"),
    canReadSpools: permissions.includes("spools.read"),
    canReadInventory: permissions.includes("inventory.read"),
    canReadPricing: permissions.includes("pricing.read"),
    paidModulesLocked: false,
  };
}
