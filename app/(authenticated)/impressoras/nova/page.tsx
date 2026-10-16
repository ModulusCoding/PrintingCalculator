import { PrinterForm } from "@/components/printers/PrinterForm";
import { requireBusinessContext } from "@/lib/auth/context";

export default async function NewPrinterPage() {
  const canWrite = await requireBusinessContext("printers.write").then(() => true).catch(() => false);
  if (!canWrite) return <p className="text-red-600">Sem permissão.</p>;

  return (
    <div className="max-w-xl mx-auto">
      <PrinterForm canWrite={canWrite} canArchive={false} />
    </div>
  );
}
