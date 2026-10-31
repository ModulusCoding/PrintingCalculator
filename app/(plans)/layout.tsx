import { AuthenticatedShell } from "@/app/(authenticated)/AuthenticatedShell";
import { shellAccessForRole } from "@/components/layout/access";
import { redirect } from "next/navigation";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";

export default async function PlansLayout({ children }: { children: React.ReactNode }) {
  let identity;
  try {
    identity = await resolveMinimalIdentity();
  } catch (error) {
    return <main className="mx-auto my-16 max-w-lg p-8">{planAccessNotice(error)}</main>;
  }
  if (identity.state === "unauthenticated") redirect("/admin/login");
  if (identity.state !== "business_ready") redirect("/conta");

  // Reuse presentation only: do not introduce the operational plan guard here.
  return <AuthenticatedShell {...shellAccessForRole(identity.role)}><div className="mx-auto max-w-6xl space-y-8">{children}</div></AuthenticatedShell>;
}
