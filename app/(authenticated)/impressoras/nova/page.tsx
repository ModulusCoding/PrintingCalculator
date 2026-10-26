import { PrinterForm } from "@/components/printers/PrinterForm";

import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidNewPrinterPage() {
  return renderPaidModule("printers", "printers.write", () => NewPrinterPage());
}

async function NewPrinterPage() {
  const canWrite = true; // The page gate already requires printers.write.
  if (!canWrite) return <p className="text-red-600">Sem permissão.</p>;

  return (
    <div className="max-w-xl mx-auto">
      <PrinterForm canWrite={canWrite} canArchive={false} />
    </div>
  );
}
