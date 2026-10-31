import { PrinterForm } from "@/components/printers/PrinterForm";
import { getPrinter } from "@/lib/printers/actions";
import { unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";

import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidPrinterDetailPage(props: Parameters<typeof PrinterDetailPage>[0]) {
  return renderPaidModule("printers", "printers.read", () => PrinterDetailPage(props));
}

async function PrinterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getPrinter(id);
  if (!res.printer) return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-[#152336]"><h1 className="text-2xl font-bold">Não foi possível abrir a impressora</h1><p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{res.error === "printer_unavailable" ? "Impressora indisponível." : res.error === "permission_denied" ? "Você não tem permissão para consultar esta impressora." : res.error === "session_expired" ? "Sua sessão expirou. Entre novamente." : "Não foi possível carregar os dados. Tente novamente."}</p><Link href="/impressoras" className="inline-flex min-h-11 items-center text-[#2B00FF] underline">Voltar às impressoras</Link></section>;

  const canWrite = await requireBusinessContext("printers.write").then(() => true).catch((error: unknown) => {
    unstable_rethrow(error);
    if (error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED") return false;
    throw error;
  });
  const canArchive = await requireBusinessContext("printers.archive").then(() => true).catch((error: unknown) => {
    unstable_rethrow(error);
    if (error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED") return false;
    throw error;
  });

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl">
      <PrinterForm key={`${res.printer.id}:${res.printer.version}`} printer={res.printer} canWrite={canWrite} canArchive={canArchive} />
    </div>
  );
}
