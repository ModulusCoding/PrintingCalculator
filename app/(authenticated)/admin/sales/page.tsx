import { getSales, SalesFilterOptions } from "@/lib/sales/actions";
import { SalesListClient } from "@/components/admin/SalesListClient";

export const dynamic = "force-dynamic";

interface SalesPageProps {
  searchParams: Promise<{
    search?: string;
    cliente?: string;
    tipo_produto?: string;
    canal_abordagem?: string;
    canal_fechamento?: string;
    status?: string;
    sort?: "recent" | "oldest" | "highest_value" | "lowest_value";
  }>;
}

export default async function SalesPage({ searchParams }: SalesPageProps) {
  const resolvedParams = await searchParams;

  const filters: SalesFilterOptions = {
    search: resolvedParams.search,
    cliente: resolvedParams.cliente,
    tipo_produto: resolvedParams.tipo_produto,
    canal_abordagem: resolvedParams.canal_abordagem,
    canal_fechamento: resolvedParams.canal_fechamento,
    status: resolvedParams.status ? resolvedParams.status.split(",") : undefined,
    sort: resolvedParams.sort,
  };

  const { sales, error } = await getSales(filters);

  return <SalesListClient initialSales={sales} initialError={error} />;
}