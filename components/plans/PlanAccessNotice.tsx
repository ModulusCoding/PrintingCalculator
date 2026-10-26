import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { AuthContextError } from "@/lib/auth/context";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";
import { PlanAccessError, PlanTechnicalError, type PlanErrorCode } from "@/lib/plans";
import { createLogger } from "@/lib/general-materials/logger";

const messages: Partial<Record<PlanErrorCode, string>> = {
  selection_required: "O responsável precisa concluir a escolha inicial do plano.",
  team_regularization_required: "A equipe excede o limite do plano atual. O proprietário deve revisar os vínculos antes de continuar esta operação.",
  member_plan_blocked: "Seu vínculo não permite operar com o plano atual. Procure o responsável pela empresa.",
  plan_feature_unavailable: "Este recurso não está disponível no plano atual. A precificadora manual continua disponível ao proprietário no Aprendiz.",
};

/** Shared page/layout boundary. Never turns a failed authorization into children. */
export function planAccessNotice(error: unknown) {
  unstable_rethrow(error);
  if (error instanceof AuthContextError && error.code === "AUTH_UNAUTHENTICATED") redirect("/admin/login");
  if (error instanceof PlanAccessError && error.code === "selection_required") redirect("/planos");
  if (error instanceof AuthContextError && (error.code === "AUTH_PERMISSION_DENIED" || error.code === "AUTH_ACCESS_BLOCKED")) return <section role="status" className="space-y-4 rounded-xl border bg-white p-6"><h1 className="text-2xl font-bold">Acesso restrito</h1><p>Seu perfil não permite acessar este recurso. Procure o responsável pela empresa.</p><Link href="/conta" className="underline">Minha conta e saída</Link></section>;
  if (error instanceof PlanAccessError) return <section role="status" className="space-y-4 rounded-xl border bg-white p-6">
    <h1 className="text-2xl font-bold">Acesso ao recurso</h1>
    <p>{messages[error.code] ?? "Esta operação não está disponível no estado atual do plano."}</p>
    <nav className="flex flex-wrap gap-4 underline">
      {error.code === "selection_required" && <Link href="/planos">Escolher plano</Link>}
      {error.code === "team_regularization_required" && <><Link href="/empresa/equipe">Regularizar equipe</Link><Link href="/meu-plano">Meu plano</Link></>}
      {error.code === "plan_feature_unavailable" && <Link href="/precificadora">Precificadora</Link>}
      <Link href="/conta">Minha conta e saída</Link>
    </nav>
  </section>;
  const correlationId = error instanceof PlanTechnicalError ? error.correlationId : createLogger("plans", "page-boundary").error({ stage: "context", ...safeErrorDiagnostic(error) });
  return <section role="alert" className="space-y-4 rounded-xl border bg-white p-6"><h1 className="text-xl font-bold">Não foi possível validar o acesso</h1><p>Tente novamente. Referência: {correlationId}.</p><Link href="/conta" className="underline">Minha conta e saída</Link></section>;
}
