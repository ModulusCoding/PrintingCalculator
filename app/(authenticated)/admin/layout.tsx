import { requirePlanBusinessAccess } from "@/lib/plans";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";

export default async function OperationalAdminLayout({ children }: { children: React.ReactNode }) {
  try { await requirePlanBusinessAccess(); }
  catch (error) { return planAccessNotice(error); }
  return children;
}
