-- Migration: Incremental update for closed_sales to support order tracking
-- 1. Make preco_venda and custo nullable
-- 2. Add status column with constrained values and default 'em_conversao'
-- 3. Add persistent sequential display_id (order_number) starting at 1001
-- 4. Add index for status and display_id

-- 1. Make preco_venda nullable
ALTER TABLE public.closed_sales ALTER COLUMN preco_venda DROP NOT NULL;

-- 2. Make custo nullable
ALTER TABLE public.closed_sales ALTER COLUMN custo DROP NOT NULL;

-- 3. Add status column
ALTER TABLE public.closed_sales 
ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'em_conversao';

-- Add check constraint for status if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'closed_sales_status_check'
    ) THEN
        ALTER TABLE public.closed_sales
        ADD CONSTRAINT closed_sales_status_check
        CHECK (
            status IN (
                'em_conversao',
                'orcado',
                'pago',
                'modelando',
                'imprimindo',
                'entregue',
                'cancelado'
            )
        );
    END IF;
END $$;

-- 4. Add sequential display_id column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'closed_sales' 
          AND column_name = 'display_id'
    ) THEN
        ALTER TABLE public.closed_sales 
        ADD COLUMN display_id BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1001);
    END IF;
END $$;

-- 5. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_sales_display_id ON public.closed_sales(display_id);
CREATE INDEX IF NOT EXISTS idx_closed_sales_status ON public.closed_sales(status);
