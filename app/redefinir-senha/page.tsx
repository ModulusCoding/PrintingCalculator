import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRecoveryMarker } from "@/lib/auth/recovery-cookie";
import ResetForm from "./reset-form";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const { data: claims } = await supabase.auth.getClaims();
  const sessionId = claims?.claims?.session_id;
  const allowed = !error && !!data.user && typeof sessionId === "string" && await requireRecoveryMarker(data.user.id, sessionId);
  if (!allowed) return <main className="mx-auto mt-20 max-w-md rounded-xl border bg-white p-8 text-center"><h1 className="text-xl font-bold">Link inválido ou expirado</h1><p className="mt-3 text-gray-600">Solicite um novo link de recuperação.</p><Link className="mt-5 inline-block text-indigo-600 hover:underline" href="/esqueci-senha">Recuperar senha</Link></main>;
  return <ResetForm />;
}
