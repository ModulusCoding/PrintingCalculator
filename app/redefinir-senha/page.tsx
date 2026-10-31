import Link from "next/link";
import { AuthShell, AuthStatus, authStyles } from "@/components/auth/AuthUI";
import { createClient } from "@/lib/supabase/server";
import { requireRecoveryMarker } from "@/lib/auth/recovery-cookie";
import ResetForm from "./reset-form";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const { data: claims } = await supabase.auth.getClaims();
  const sessionId = claims?.claims?.session_id;
  const allowed = !error && !!data.user && typeof sessionId === "string" && await requireRecoveryMarker(data.user.id, sessionId);
  if (!allowed) return (
    <AuthShell>
      <AuthStatus title="Link inválido ou expirado" description="Solicite um novo link de recuperação." error>
        <Link className={authStyles.primary} href="/esqueci-senha">Recuperar senha</Link>
      </AuthStatus>
    </AuthShell>
  );
  return <ResetForm />;
}
