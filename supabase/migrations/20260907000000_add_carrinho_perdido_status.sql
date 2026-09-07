DO $$
BEGIN
    ALTER TABLE public.closed_sales DROP CONSTRAINT IF EXISTS closed_sales_status_check;
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
                'cancelado',
                'carrinho_perdido'
            )
        );
END $$;
