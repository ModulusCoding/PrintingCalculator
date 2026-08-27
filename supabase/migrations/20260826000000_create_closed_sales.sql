-- Migration: Create closed_sales table, indexes, updated_at trigger, and RLS policies
-- Created for Modulus Admin Sales Registration System

-- 1. TABLE
CREATE TABLE IF NOT EXISTS public.closed_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_nome VARCHAR(255) NOT NULL,
    cliente_telefone VARCHAR(50),
    produto VARCHAR(255) NOT NULL,
    tipo_produto VARCHAR(100) NOT NULL CHECK (
        tipo_produto IN (
            'Produto padrão',
            'Produto personalizado',
            'Produto personalizado esotérico',
            'Encomenda'
        )
    ),
    preco_venda NUMERIC(10, 2) NOT NULL CHECK (preco_venda >= 0),
    custo NUMERIC(10, 2) NOT NULL CHECK (custo >= 0),
    data_fechamento DATE NOT NULL DEFAULT CURRENT_DATE,
    canal_abordagem VARCHAR(100) NOT NULL CHECK (
        canal_abordagem IN (
            'Instagram',
            'WhatsApp',
            'Boca a boca',
            'Site',
            'Evento',
            'Outro'
        )
    ),
    canal_fechamento VARCHAR(100) NOT NULL CHECK (
        canal_fechamento IN (
            'WhatsApp',
            'Instagram',
            'Presencial',
            'Site',
            'Outro'
        )
    ),
    forma_pagamento VARCHAR(100) NOT NULL CHECK (
        forma_pagamento IN (
            'PIX',
            'Cartão',
            'Dinheiro',
            'Transferência',
            'Outro'
        )
    ),
    detalhes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. INDEXES
CREATE INDEX IF NOT EXISTS idx_closed_sales_data_fechamento ON public.closed_sales(data_fechamento);
CREATE INDEX IF NOT EXISTS idx_closed_sales_cliente_nome ON public.closed_sales(cliente_nome);
CREATE INDEX IF NOT EXISTS idx_closed_sales_produto ON public.closed_sales(produto);
CREATE INDEX IF NOT EXISTS idx_closed_sales_canal_abordagem ON public.closed_sales(canal_abordagem);
CREATE INDEX IF NOT EXISTS idx_closed_sales_canal_fechamento ON public.closed_sales(canal_fechamento);
CREATE INDEX IF NOT EXISTS idx_closed_sales_tipo_produto ON public.closed_sales(tipo_produto);

-- 3. AUTOMATIC UPDATED_AT TRIGGER
DROP TRIGGER IF EXISTS set_closed_sales_updated_at ON public.closed_sales;
CREATE TRIGGER set_closed_sales_updated_at
BEFORE UPDATE ON public.closed_sales
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE public.closed_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can do all on closed_sales" ON public.closed_sales;

-- Closed Sales RLS Policies (PRIVATE TABLE - ONLY AUTHENTICATED ADMIN USERS)
CREATE POLICY "Authenticated users can do all on closed_sales"
    ON public.closed_sales FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
