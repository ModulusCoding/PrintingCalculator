export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  image_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  // Relationships
  catalog_ids?: string[];
  catalog_count?: number;
}

export interface CatalogProduct {
  catalog_id: string;
  product_id: string;
  display_order: number;
  created_at: string;
  product?: Product;
}

export interface ProductFormData {
  name: string;
  slug: string;
  description?: string;
  price: number;
  image_url?: string;
  active?: boolean;
  catalog_ids?: string[];
}
