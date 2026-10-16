import { CatalogForm } from "@/components/admin/CatalogForm";
import { isLegacyEnabled } from "@/lib/legacy-gate";

export default async function NewCatalogPage() {
  if (!(await isLegacyEnabled())) return <p className="p-8 text-center">Unavailable</p>;
  return (
    <div className="max-w-5xl mx-auto">
      <CatalogForm />
    </div>
  );
}