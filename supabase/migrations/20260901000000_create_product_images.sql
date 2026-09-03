CREATE TABLE public.product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    display_order SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT product_images_display_order_check CHECK (display_order BETWEEN 1 AND 3),
    CONSTRAINT product_images_product_order_key UNIQUE (product_id, display_order)
);

CREATE INDEX idx_product_images_product_id ON public.product_images(product_id);

INSERT INTO public.product_images (product_id, url, display_order)
SELECT id, image_url, 1
FROM public.products
WHERE image_url IS NOT NULL
  AND btrim(image_url) <> ''
ON CONFLICT (product_id, display_order) DO NOTHING;

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public users can view images of active products"
    ON public.product_images FOR SELECT
    TO public
    USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_images.product_id
              AND p.active = true
        )
    );

CREATE POLICY "Authenticated users can do all on product_images"
    ON public.product_images FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
