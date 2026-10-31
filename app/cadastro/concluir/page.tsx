import { AuthContextError, resolveMinimalIdentity } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { CompletionForm } from "./CompletionForm";
import { LogoutButton } from "@/app/conta/LogoutButton";
import { AuthShell, AuthStatus } from "@/components/auth/AuthUI";

function AccessValidationFailure() {
  return <AuthShell><AuthStatus error title="Não foi possível validar seu acesso" description="Tente novamente em instantes. Se o problema persistir, saia e entre novamente."><LogoutButton /></AuthStatus></AuthShell>;
}

export default async function ConcluirCadastroPage() {
  let failed = false;
  let context: Awaited<ReturnType<typeof resolveMinimalIdentity>> | undefined;
  try {
    context = await resolveMinimalIdentity();
  } catch (error) {
    if (!(error instanceof AuthContextError)) throw error;
    failed = true;
  }

  if (failed) return <AccessValidationFailure />;
  if (context?.state === "unauthenticated") redirect("/admin/login");
  if (context?.state === "business_ready") redirect("/home");
  if (context?.state !== "no_active_internal_identity") redirect("/conta");
  return <CompletionForm />;
}
