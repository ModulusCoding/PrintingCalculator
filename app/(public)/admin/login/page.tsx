import { redirect } from "next/navigation";
import { AuthContextError, resolveMinimalIdentity } from "@/lib/auth/context";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  let context;
  try {
    context = await resolveMinimalIdentity();
  } catch (error) {
    if (!(error instanceof AuthContextError)) throw error;
    return <main className="min-h-screen bg-[#f8f9fa] p-8"><section role="alert" className="mx-auto max-w-md rounded-xl border bg-white p-8"><h1 className="text-xl font-bold">Erro técnico</h1><p>Não foi possível validar seu acesso. Tente novamente em instantes.</p></section></main>;
  }
  if (context.state === "business_ready") redirect("/home");
  if (context.state !== "unauthenticated") redirect("/conta");
  return <LoginForm />;
}
