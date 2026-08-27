import { getSales, SalesFilterOptions } from "@/lib/sales/actions";
import { SalesListClient } from "@/components/admin/SalesListClient";

export const dynamic = "force-dynamic";

interface SalesPageProps {
  searchParams: Promise<{
    search?: string;
    tipo_produto?: string;
    canal_abordagem?: string;
    canal_fechamento?: string;
    sort?: "recent" | "oldest" | "highest_value" | "lowest_value";
  }>;
}

export default async function SalesPage({ searchParams }: SalesPageProps) {
  const resolvedParams = await searchParams;

  const filters: SalesFilterOptions = {
    search: resolvedParams.search,
    tipo_produto: resolvedParams.tipo_produto,
    canal_abordagem: resolvedParams.canal_abordagem,
    canal_fechamento: resolvedParams.canal_fechamento,
    sort: resolvedParams.sort,
  };

  const { sales, error } = await getSales(filters);

  return <SalesListClient initialSales={sales} initialError={error} />;
}