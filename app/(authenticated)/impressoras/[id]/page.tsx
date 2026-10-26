import { PrinterForm } from "@/components/printers/PrinterForm";
import { getPrinter } from "@/lib/printers/actions";
import { unstable_rethrow } from "next/navigation";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";

import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidPrinterDetailPage(props: Parameters<typeof PrinterDetailPage>[0]) {
  return renderPaidModule("printers", "printers.read", () => PrinterDetailPage(props));
}

async function PrinterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getPrinter(id);
  if (!res.printer) return <p className="text-red-600">Impressora indisponível.</p>;

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
    <div className="max-w-xl mx-auto">
      <PrinterForm printer={res.printer} canWrite={canWrite} canArchive={canArchive} />
    </div>
  );
}
