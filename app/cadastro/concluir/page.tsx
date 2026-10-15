import { AuthContextError, resolveMinimalIdentity } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { CompletionForm } from "./CompletionForm";
import { LogoutButton } from "@/app/conta/LogoutButton";

function AccessValidationFailure() {
  return <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4"><main className="w-full max-w-md rounded-xl border bg-white p-8 shadow-sm"><h1 className="text-2xl font-bold text-black">Não foi possível validar seu acesso</h1><p className="mt-3 text-gray-600">Tente novamente em instantes. Se o problema persistir, saia e entre novamente.</p><div className="mt-6"><LogoutButton /></div></main></div>;
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
  if (context?.state !== "no_active_internal_identity") redirect("/conta");
  return <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4"><CompletionForm /></div>;
}
