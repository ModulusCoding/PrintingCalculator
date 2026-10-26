import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { LogoutButton } from "@/app/conta/LogoutButton";
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

  return (
    <div className="min-h-screen bg-[#f3f4f5] text-[#152336]">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <Link href="/home" className="text-xl font-bold">Modulus</Link>
          <nav aria-label="Conta e planos" className="flex flex-wrap items-center gap-5 text-sm">
            <Link href="/home" className="hover:underline">Início</Link>
            <Link href="/planos" className="hover:underline">Planos</Link>
            <Link href="/meu-plano" className="hover:underline">Meu plano</Link>
            <Link href="/conta" className="hover:underline">Minha conta</Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">{children}</main>
    </div>
  );
}
