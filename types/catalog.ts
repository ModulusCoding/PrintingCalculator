export interface CatalogProductView {
  id: string;
  index: string;
  name: string;
  category: string;
  format: string;
  detail?: string | null;
  description?: string | null;
  photo: string;
  photoSecondary?: string | null;
  photoAlt?: string | null;
  photoSecondaryAlt?: string | null;
  photoNote?: string | null;
  price?: number | null;
  displayOrder?: number;
}

export interface CatalogView {
  id: string;
  slug: string;
  title: string;
  eyebrow?: string | null;
  heroCopy?: string | null;
  heroStrongText?: string | null;
  manifestoLabel?: string | null;
  manifestoTitle?: string | null;
  manifestoFormula?: string | null;
  manifestoDescription?: string | null;
  products: CatalogProductView[];
}

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
