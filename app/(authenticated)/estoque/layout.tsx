import { requirePlanBusinessAccess } from "@/lib/plans";
export default async function PaidInventoryLayout({ children }: { children: React.ReactNode }) {
  await requirePlanBusinessAccess();
  return children;
}
