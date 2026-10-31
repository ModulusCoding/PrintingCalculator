import { redirect } from "next/navigation";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { RequiredPasswordForm } from "./RequiredPasswordForm";
import { AuthShell } from "@/components/auth/AuthUI";
export default async function RequiredPasswordPage() {
  const context = await resolveMinimalIdentity();
  if (context.state === "unauthenticated") redirect("/admin/login");
  if (context.state !== "password_change_required") redirect("/conta");
  return <AuthShell><RequiredPasswordForm /></AuthShell>;
}
