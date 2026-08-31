-- Migration: Make product price nullable (optional)
-- This allows products to exist without a defined price ("Sob consulta")

-- Drop the NOT NULL constraint on price column
ALTER TABLE public.products ALTER COLUMN price DROP NOT NULL;

-- The CHECK constraint (price >= 0) is automatically handled for NULL values
-- (NULL passes CHECK constraints in PostgreSQL)