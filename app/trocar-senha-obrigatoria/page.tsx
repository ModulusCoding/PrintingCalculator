import { redirect } from "next/navigation";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { RequiredPasswordForm } from "./RequiredPasswordForm";
export default async function RequiredPasswordPage() {
  const context = await resolveMinimalIdentity();
  if (context.state === "unauthenticated") redirect("/admin/login");
  if (context.state !== "password_change_required") redirect("/conta");
  return <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4"><RequiredPasswordForm /></main>;
}
