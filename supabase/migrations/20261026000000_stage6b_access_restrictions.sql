-- Stage 6B: plan-aware access restrictions. Additive; no legacy RPC body is replaced.
BEGIN;

-- Public contract consumed by the application. It resolves only the current
-- authenticated context and never accepts tenant/user identifiers.
CREATE OR REPLACE FUNCTION public.get_my_plan_business_access()
RETURNS TABLE(status text, effective_plan public.modulus_plan_code, access_state public.modulus_access_state)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; r record; operators bigint; lim bigint;
BEGIN
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL THEN
    RETURN QUERY SELECT 'selection_required'::text,'free'::public.modulus_plan_code,'selection_required'::public.modulus_access_state; RETURN;
  END IF;
  SELECT * INTO r FROM private.resolve_enterprise_plan(c.enterprise_id);
  IF r.selection_required THEN
    RETURN QUERY SELECT 'selection_required'::text,'free'::public.modulus_plan_code,r.access_state; RETURN;
  END IF;
  SELECT operator_limit INTO lim FROM public.modulus_plan_limits(r.effective_plan);
  SELECT count(*) INTO operators FROM public.enterprise_members m WHERE m.enterprise_id=c.enterprise_id AND m.status='active' AND m.role='operator';
  IF c.role <> 'owner' AND operators > coalesce(lim,0) THEN
    RETURN QUERY SELECT 'member_plan_blocked'::text,r.effective_plan,r.access_state; RETURN;
  END IF;
  IF c.role='owner' AND operators > coalesce(lim,0) THEN
    RETURN QUERY SELECT 'team_regularization_required'::text,r.effective_plan,r.access_state; RETURN;
  END IF;
  RETURN QUERY SELECT 'allowed'::text,r.effective_plan,r.access_state;
END $$;
ALTER FUNCTION public.get_my_plan_business_access() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_plan_business_access() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_plan_business_access() TO authenticated;

CREATE OR REPLACE FUNCTION private.stage6b_product_visible(eid uuid,pid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM public.products p WHERE p.enterprise_id=eid AND p.id=pid AND p.deleted_at IS NULL AND
   (EXISTS (SELECT 1 FROM private.resolve_enterprise_plan(eid) r WHERE r.effective_plan IN ('intermediate','advanced') AND r.access_state='paid') OR
    (SELECT count(*) FROM public.products q WHERE q.enterprise_id=eid AND q.deleted_at IS NULL AND (q.created_at,q.id) >= (p.created_at,p.id)) <= 3));
$$;
ALTER FUNCTION private.stage6b_product_visible(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.stage6b_product_visible(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.stage6b_product_visible(uuid,uuid) TO authenticated;

-- Restrictive policies apply to Data API reads and direct table mutations.
DROP POLICY IF EXISTS stage6b_products_scope ON public.products;
CREATE POLICY stage6b_products_scope ON public.products AS RESTRICTIVE FOR ALL TO authenticated
USING (private.can_access_enterprise(enterprise_id,'products.read') AND private.stage6b_product_visible(enterprise_id,id))
WITH CHECK (private.can_access_enterprise(enterprise_id,'products.write') AND deleted_at IS NULL);
DROP POLICY IF EXISTS stage6b_product_images_scope ON public.product_images;
CREATE POLICY stage6b_product_images_scope ON public.product_images AS RESTRICTIVE FOR ALL TO authenticated
USING (private.can_access_enterprise(enterprise_id,'products.read') AND private.stage6b_product_visible(enterprise_id,product_id))
WITH CHECK (private.can_access_enterprise(enterprise_id,'products.write'));

-- Paid resources are blocked on Free by a restrictive policy. Existing tenant
-- policies remain in force; RPCs still perform their own context authorization.
DO $$ DECLARE t text; perm text; BEGIN
 FOR t,perm IN SELECT * FROM (VALUES
  ('printers','printers.read'),('filament_spools','spools.read'),('filament_spool_movements','spools.read'),
  ('materials','materials.read'),('general_materials','stock.materials.read'),('general_material_movements','stock.materials.read'),
  ('general_material_cost_history','stock.materials.read'),('pricing_calculations','pricing.read'),
  ('pricing_price_applications','pricing.read'),('product_inventory','inventory.read'),('product_inventory_movements','inventory.read')) v(name,permission) LOOP
  EXECUTE format('DROP POLICY IF EXISTS stage6b_%s_scope ON public.%I',t,t);
  EXECUTE format('CREATE POLICY stage6b_%s_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.can_access_enterprise(enterprise_id,%L))',t,t,perm);
 END LOOP;
END $$;

-- Do not replace start/finish/resume RPCs: their original signatures and bodies
-- remain authoritative. These triggers enforce team limits at both insertion
-- points, including concurrent provisioning, with a transaction advisory lock.
CREATE OR REPLACE FUNCTION private.stage6b_team_limit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eid uuid; requested text; lim bigint; n bigint; plan public.modulus_plan_code;
BEGIN
 IF TG_TABLE_NAME='employee_provisioning_operations' THEN eid:=NEW.enterprise_id; requested:=NEW.requested_role;
 ELSE eid:=NEW.enterprise_id; requested:=NEW.role; END IF;
 IF requested <> 'operator' THEN RETURN NEW; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:team-limit:'||eid::text,0));
 SELECT effective_plan INTO plan FROM private.resolve_enterprise_plan(eid);
 SELECT operator_limit INTO lim FROM public.modulus_plan_limits(coalesce(plan,'free'));
 SELECT count(*) INTO n FROM public.enterprise_members WHERE enterprise_id=eid AND status='active' AND role='operator';
 IF TG_TABLE_NAME='employee_provisioning_operations' THEN n:=n + (SELECT count(*) FROM private.employee_provisioning_operations o WHERE o.enterprise_id=eid AND o.status='pending' AND o.requested_role='operator'); END IF;
 IF n >= coalesce(lim,0) THEN RAISE EXCEPTION 'team_limit_reached' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stage6b_team_limit_operation ON private.employee_provisioning_operations;
CREATE TRIGGER stage6b_team_limit_operation BEFORE INSERT ON private.employee_provisioning_operations FOR EACH ROW EXECUTE FUNCTION private.stage6b_team_limit_guard();
DROP TRIGGER IF EXISTS stage6b_team_limit_member ON public.enterprise_members;
CREATE TRIGGER stage6b_team_limit_member BEFORE INSERT ON public.enterprise_members FOR EACH ROW EXECUTE FUNCTION private.stage6b_team_limit_guard();
ALTER FUNCTION private.stage6b_team_limit_guard() OWNER TO postgres;

-- No safe signature-preserving recreation exists for pricing RPCs here; their
-- existing RPC guards remain unchanged and direct table writes are not granted.
REVOKE INSERT,UPDATE,DELETE ON public.products,public.product_images,public.printers,public.filament_spools,public.general_materials,public.materials,public.product_inventory FROM authenticated,anon;
COMMIT;
