"use server";
import { revalidatePath } from "next/cache";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { mutateMember, updateCompanyName as updateCompany, updateCompanyLoss, updateCompanyRate } from "./management";
export async function updateCompanyName(previous: unknown, form: FormData) { return updateCompany(previous, form); }
export async function updateCompanyLossAction(previous: unknown, form: FormData) {
  try {
    await requireBusinessContext("enterprise.pricing_loss.write");
    const result = await updateCompanyLoss(previous, form);
    if (result.status === "success") revalidatePath("/empresa");
    return result;
  } catch (err) {
    if (err instanceof AuthContextError) return { status: "session_expired" as const };
    return { status: "technical" as const };
  }
}
export async function updateCompanyRateAction(previous: unknown, form: FormData) {
  try {
    await requireBusinessContext("enterprise.manage");
    return updateCompanyRate(previous, form);
  } catch (err) {
    if (err instanceof AuthContextError) return { status: "session_expired" as const };
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
    if (err instanceof AuthContextError) return { status: "session_expired" as const };
    return { status: "technical" as const };
  }
}
