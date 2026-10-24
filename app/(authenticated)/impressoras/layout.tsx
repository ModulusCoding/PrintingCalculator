import { requirePlanBusinessAccess } from "@/lib/plans";
export default async function PaidPrintersLayout({ children }: { children: React.ReactNode }) {
  await requirePlanBusinessAccess();
  return children;
}
