import { PrinterForm } from "@/components/printers/PrinterForm";
import { getPrinter } from "@/lib/printers/actions";
import { requireBusinessContext } from "@/lib/auth/context";

export default async function PrinterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getPrinter(id);
  if (!res.printer) return <p className="text-red-600">Impressora indisponível.</p>;

  const canWrite = await requireBusinessContext("printers.write").then(() => true).catch(() => false);
  const canArchive = await requireBusinessContext("printers.archive").then(() => true).catch(() => false);

  return (
    <div className="max-w-xl mx-auto">
      <PrinterForm printer={res.printer} canWrite={canWrite} canArchive={canArchive} />
    </div>
  );
}
