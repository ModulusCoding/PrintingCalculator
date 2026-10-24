-- Assertions 6B: executar somente em PostgreSQL local isolado após 6A e 6B.
-- Requer fixtures autenticadas separadas de owner/operator e empresas free/intermediate.
BEGIN;

DO $$ BEGIN
ASSERT has_function_privilege('authenticated','public.get_my_plan_business_access()','EXECUTE'), 'contrato de acesso deve ser consultável';
ASSERT NOT has_function_privilege('anon','public.get_my_plan_business_access()','EXECUTE'), 'anon não consulta plano empresarial';
ASSERT (SELECT product_limit FROM public.modulus_plan_limits('free')) = 3, 'limite 6A preservado';
ASSERT (SELECT shared_material_limit FROM public.modulus_plan_limits('intermediate')) = 15, 'limite compartilhado 6A preservado';
END $$;

-- Validação estrutural: policies restritivas devem existir nos caminhos de Data API.
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT unnest(ARRAY['products','product_images','printers','filament_spools','filament_spool_movements','materials','general_materials','general_material_movements','general_material_cost_history','pricing_calculations','pricing_price_applications','product_inventory','product_inventory_movements']) LOOP
   IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t AND p.policyname LIKE 'stage6b_%_scope' AND p.permissive='RESTRICTIVE') THEN
     RAISE EXCEPTION 'missing_restrictive_policy:%',t;
   END IF;
 END LOOP;
END $$;

-- Fixture requerida (executar com JWT de cada ator):
-- 1. free com 5 produtos: SELECT expõe exatamente os IDs de ORDER BY created_at DESC,id DESC LIMIT 3.
-- 2. filtro pelo nome antigo retorna 0; updated_at não promove; arquivado participa; exclusão promove o quarto.
-- 3. UPDATE/DELETE/imagem/estoque por ID oculto deve retornar 0 ou product_unavailable.
-- 4. intermediate lê os 5.
-- 5. free: SELECT e mutações em printers/spools/materials/general_materials retornam 0/plan_feature_unavailable.
-- 6. downgrade não altera count/saldos/ledgers; regularização restaura os mesmos IDs.
-- 7. owner free retorna allowed; operator free retorna member_plan_blocked e mantém membership.
-- 8. intermediate aceita primeiro operator; segunda operação simultânea falha exatamente team_limit_reached.
-- 9. legados excedentes: owner retorna team_regularization_required; não-owner retorna member_plan_blocked.
-- 10. snapshot de pricing autorizado renderiza sem consultas aos catálogos; apply integrado sem plano deve falhar.

ROLLBACK;
