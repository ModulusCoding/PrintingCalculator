import { requirePlanBusinessAccess } from "@/lib/plans";
export default async function PaidMaterialsLayout({ children }: { children: React.ReactNode }) {
  await requirePlanBusinessAccess();
  return children;
}
