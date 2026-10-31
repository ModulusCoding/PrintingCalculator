import { unstable_rethrow } from "next/navigation";
import { requirePlanBusinessAccess } from "@/lib/plans";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { loadHomeDashboard } from "@/lib/dashboard/reader";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let plan;
  let dashboard;
  try {
    plan = await requirePlanBusinessAccess();
    dashboard = await loadHomeDashboard(plan);
  } catch (error) {
    unstable_rethrow(error);
    return planAccessNotice(error);
  }
  return <HomeDashboard {...dashboard} downgraded={plan.access_state === "expired" || plan.access_state === "cancelled"} />;
}
