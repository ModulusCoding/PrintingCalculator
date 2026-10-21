import { AuthContextError, ROLE_PERMISSIONS, resolveMinimalIdentity, type Permission } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { AuthenticatedShell } from "./AuthenticatedShell";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  let context;
  try {
    context = await resolveMinimalIdentity();
  } catch (error) {
    if (error instanceof AuthContextError) {
      return (
        <main className="min-h-screen bg-[#f3f4f5] p-6">
          <section className="mx-auto mt-24 max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm" role="alert">
            <h1 className="text-xl font-bold text-[#152336]">Erro técnico</h1>
            <p className="mt-3 text-sm text-[#464556]">Não foi possível validar seu acesso neste momento. Tente novamente em instantes.</p>
          </section>
        </main>
      );
    }
    throw error;
  }

  if (context.state === "unauthenticated") {
    redirect("/admin/login");
  }

  if (context.state !== "business_ready") {
    redirect("/conta");
  }

  const permissions: readonly Permission[] = ROLE_PERMISSIONS[context.role];
  const canManageEnterprise = permissions.includes("enterprise.manage");
  const canManageMembers = permissions.includes("members.manage_operators");
  const canReadPrinters = permissions.includes("printers.read");
  const canReadMaterials = permissions.includes("materials.read");
  const canReadGeneralMaterials = permissions.includes("stock.materials.read");
  const canReadSpools = permissions.includes("spools.read");
  const canReadInventory = permissions.includes("inventory.read");

  return (
    <AuthenticatedShell
      canManageEnterprise={canManageEnterprise}
      canManageMembers={canManageMembers}
      canReadPrinters={canReadPrinters}
      canReadMaterials={canReadMaterials}
      canReadGeneralMaterials={canReadGeneralMaterials}
      canReadSpools={canReadSpools}
      canReadInventory={canReadInventory}
    >
      {children}
    </AuthenticatedShell>
  );
}
