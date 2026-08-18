export interface Catalog {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  whatsapp: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  // Computed / aggregated
  product_count?: number;
}

export interface CatalogFormData {
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  banner_url?: string;
  whatsapp?: string;
  active?: boolean;
}
