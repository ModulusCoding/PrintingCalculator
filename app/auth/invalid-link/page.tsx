import Link from "next/link";
import { AuthShell, AuthStatus, authStyles } from "@/components/auth/AuthUI";

export default async function InvalidLinkPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const reason = (await searchParams).reason;
  const isRecovery = reason === "recovery";
  const isSignup = ["signup_invalid", "signup_unavailable", "signup_session"].includes(reason ?? "");
  return (
    <AuthShell>
      <AuthStatus
        title={isRecovery || isSignup ? "Link de acesso inválido" : "Link inválido"}
        description={(isSignup || isRecovery) ? (isRecovery ? "Este link de recuperação não é mais válido." : (reason === "signup_session" ? "Sua sessão de cadastro não pôde ser validada." : "Este link de confirmação não é mais válido ou ocorreu um erro técnico.")) : "O link solicitado não é válido."}
        error
      >
        <div className="flex flex-col items-center gap-4">
          {isSignup ? <>
            <Link className={authStyles.primary} href="/cadastro">Ir para o cadastro</Link>
            <Link className={authStyles.link} href="/admin/login">Entrar em uma conta existente</Link>
          </> : <Link className={authStyles.primary} href={isRecovery ? "/esqueci-senha" : "/admin/login"}>{isRecovery ? "Solicitar novo link" : "Ir para o login"}</Link>}
        </div>
      </AuthStatus>
    </AuthShell>
  );
}
