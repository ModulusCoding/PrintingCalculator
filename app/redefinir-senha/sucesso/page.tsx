import Link from "next/link";
import { AuthShell, AuthStatus, authStyles } from "@/components/auth/AuthUI";

export default async function ResetSuccessPage({ searchParams }: { searchParams: Promise<{ logout?: string }> }) {
  const { logout } = await searchParams;
  const logoutFailed = logout === "failed";

  return (
    <AuthShell>
      <AuthStatus
        title="Senha alterada com sucesso!"
        description={logoutFailed ? "Senha alterada com sucesso, mas não foi possível encerrar a sessão." : "Sua nova senha já está ativa. Use-a para entrar."}
      >
        <Link className={authStyles.primary} href="/admin/login">Ir para o login</Link>
      </AuthStatus>
    </AuthShell>
  );
}
