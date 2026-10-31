import { redirect } from "next/navigation";
import { AuthContextError, resolveMinimalIdentity } from "@/lib/auth/context";
import { LoginForm } from "./LoginForm";
import { isPublicOnboardingEnabled } from "@/lib/auth/config";
import { AuthShell, AuthStatus } from "@/components/auth/AuthUI";

export default async function LoginPage() {
  let context;
  try {
    context = await resolveMinimalIdentity();
  } catch (error) {
    if (!(error instanceof AuthContextError)) throw error;
    return <AuthShell><div role="alert"><AuthStatus title="Erro técnico" description="Não foi possível validar seu acesso. Tente novamente em instantes." error /></div></AuthShell>;
  }
  if (context.state === "business_ready") redirect("/home");
  if (context.state !== "unauthenticated") redirect("/conta");
  return <LoginForm signupEnabled={isPublicOnboardingEnabled()} />;
}
