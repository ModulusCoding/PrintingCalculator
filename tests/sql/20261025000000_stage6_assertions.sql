-- Assertions 6A: executar somente em PostgreSQL local isolado com fixtures controladas.
-- Não altera o relógio do banco e não expõe funções de fixture no produto.
DO $$
DECLARE e uuid; auth_id text := 'local-6a-'||gen_random_uuid()::text; until_at timestamptz := statement_timestamp()+interval '30 days'; v bigint; n bigint; s text;
BEGIN
 INSERT INTO public.enterprises(name) VALUES ('fixture-6a-'||gen_random_uuid()::text) RETURNING id INTO e;
 SELECT authorization_version INTO v FROM public.confirm_enterprise_paid_access(e,'intermediate',until_at,auth_id,0);
 IF v IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'confirm_failed'; END IF;
 SELECT count(*) INTO n FROM public.enterprise_plan_access_audit WHERE enterprise_id=e;
 SELECT status INTO s FROM public.confirm_enterprise_paid_access(e,'intermediate',until_at,auth_id,999);
 IF s IS DISTINCT FROM 'idempotent' OR (SELECT count(*) FROM public.enterprise_plan_access_audit WHERE enterprise_id=e) IS DISTINCT FROM n OR (SELECT authorization_version FROM public.enterprise_plan_access WHERE enterprise_id=e) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'equivalent_replay_changed_state'; END IF;
 BEGIN PERFORM public.confirm_enterprise_paid_access(e,'intermediate',until_at+interval '1 second',auth_id,1); RAISE EXCEPTION 'expected_payload_conflict'; EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 BEGIN PERFORM public.confirm_enterprise_paid_access(gen_random_uuid(),'intermediate',until_at,auth_id,0); RAISE EXCEPTION 'expected_cross_enterprise_conflict'; EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 SELECT authorization_version INTO v FROM public.cancel_enterprise_paid_access(e,1);
 SELECT status INTO s FROM public.confirm_enterprise_paid_access(e,'intermediate',until_at,auth_id,1);
 IF s IS DISTINCT FROM 'idempotent' OR (SELECT access_state FROM public.enterprise_plan_access WHERE enterprise_id=e) IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'cancel_replay_reactivated'; END IF;
 BEGIN PERFORM public.confirm_enterprise_paid_access(e,'intermediate',statement_timestamp()-interval '1 second','new-'||auth_id,2); RAISE EXCEPTION 'expected_expired_new_authorization'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 DELETE FROM public.enterprises WHERE id=e;
END $$;
DO $$ BEGIN
 IF (SELECT product_limit FROM public.modulus_plan_limits('free')) IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'limit_mismatch'; END IF;
 IF (SELECT shared_material_limit FROM public.modulus_plan_limits('intermediate')) IS DISTINCT FROM 15 THEN RAISE EXCEPTION 'limit_mismatch'; END IF;
 IF (SELECT printers_enabled FROM public.modulus_plan_limits('free')) IS NOT FALSE THEN RAISE EXCEPTION 'limit_mismatch'; END IF;
END $$;
-- selection_required: true quando ausência de linha ou (selected_plan IS NULL AND access_state='selection_required');
-- gratuito explícito, pago válido, vencido e cancelado: false. Conferir via sessão business_ready da fixture.
-- Replay vencido e replay após nova autorização devem retornar o recibo histórico sem alterar estado atual.
-- Concorrência de última vaga requer duas sessões distintas e permanece preparada para execução local.
