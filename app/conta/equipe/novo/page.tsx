import { redirect } from "next/navigation";
import { z } from "zod";

export default async function RedirectPage(props: { searchParams?: Promise<{ operationId?: string }> }) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const rawOperationId = searchParams?.operationId;
  const initialOperationId = rawOperationId && z.uuid().safeParse(rawOperationId).success ? rawOperationId : undefined;
  const url = new URL("/empresa/equipe/novo", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  if (initialOperationId) url.searchParams.set("operationId", initialOperationId);
  redirect(url.pathname + url.search);
}
