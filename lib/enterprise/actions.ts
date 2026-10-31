"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { diagnoseCompany } from "./diagnostics";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { mutateMember, updateCompanyName as updateCompany, updateCompanyLoss, updateCompanyRate } from "./management";
export async function updateCompanyName(previous: unknown, form: FormData) {
  try {
    await requireBusinessContext("enterprise.manage");
    return await updateCompany(previous, form);
  } catch (err) {
    unstable_rethrow(err);
    diagnoseCompany("updateCompanyName", "context", err);
    if (err instanceof AuthContextError) return { status: err.code === "AUTH_UNAUTHENTICATED" ? "session_expired" as const : err.code === "AUTH_PERMISSION_DENIED" || err.code === "AUTH_ACCESS_BLOCKED" ? "permission_denied" as const : "technical" as const };
    return { status: "technical" as const };
  }
}
export async function updateCompanyLossAction(previous: unknown, form: FormData) {
  try {
    await requireBusinessContext("enterprise.pricing_loss.write");
    const result = await updateCompanyLoss(previous, form);
    if (result.status === "success") revalidatePath("/empresa");
    return result;
  } catch (err) {
    unstable_rethrow(err);
    diagnoseCompany("companyMutation", "context", err);
    if (err instanceof AuthContextError) return { status: err.code === "AUTH_UNAUTHENTICATED" ? "session_expired" as const : err.code === "AUTH_PERMISSION_DENIED" || err.code === "AUTH_ACCESS_BLOCKED" ? "permission_denied" as const : "technical" as const };
    return { status: "technical" as const };
  }
}
export async function updateCompanyRateAction(previous: unknown, form: FormData) {
  try {
    await requireBusinessContext("enterprise.manage");
    return await updateCompanyRate(previous, form);
  } catch (err) {
    unstable_rethrow(err);
    diagnoseCompany("companyMutation", "context", err);
    if (err instanceof AuthContextError) return { status: err.code === "AUTH_UNAUTHENTICATED" ? "session_expired" as const : err.code === "AUTH_PERMISSION_DENIED" || err.code === "AUTH_ACCESS_BLOCKED" ? "permission_denied" as const : "technical" as const };
    return { status: "technical" as const };
  }
}
export async function memberMutation(kind: "edit" | "status", _prev: unknown, form: FormData) {
  try {
    await requireBusinessContext("members.manage_operators");
    const result = await mutateMember(kind, form);
    if (result.status === "success") revalidatePath("/empresa/equipe");
    return result;
  } catch (err) {
    if (err instanceof AuthContextError) return { status: err.code === "AUTH_UNAUTHENTICATED" ? "session_expired" as const : "permission_denied" as const };
    return { status: "technical" as const };
  }
}
