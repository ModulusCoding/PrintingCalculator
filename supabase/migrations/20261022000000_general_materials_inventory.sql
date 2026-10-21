BEGIN;

CREATE TYPE public.general_material_control_unit AS ENUM ('unidade','metro','centimetro','grama','quilograma');

CREATE TABLE public.general_materials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enterprise_id uuid NOT NULL REFERENCES public.enterprises(id),
 name text NOT NULL CHECK (btrim(name)=name AND length(name) BETWEEN 1 AND 120),
 control_unit public.general_material_control_unit NOT NULL,
 reference_quantity numeric(18,6) NOT NULL CHECK (reference_quantity>0), reference_price numeric(18,6) NOT NULL CHECK (reference_price>=0),
 current_balance numeric(18,6) NOT NULL DEFAULT 0 CHECK (current_balance>=0), active boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 create_actor_id uuid NOT NULL REFERENCES public.users(id), create_attempt_id uuid NOT NULL, create_payload jsonb NOT NULL,
 UNIQUE(enterprise_id,name), UNIQUE(enterprise_id,id), UNIQUE(enterprise_id,create_actor_id,create_attempt_id)
);
CREATE TABLE public.general_material_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enterprise_id uuid NOT NULL REFERENCES public.enterprises(id), material_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.users(id), movement_type text NOT NULL CHECK(movement_type IN('opening','entry','consumption','adjustment')),
 supplied_unit public.general_material_control_unit NOT NULL, supplied_quantity numeric(18,6) NOT NULL CHECK(supplied_quantity>=0),
 quantity_control numeric(18,6) NOT NULL, balance_before numeric(18,6) NOT NULL CHECK(balance_before>=0), balance_after numeric(18,6) NOT NULL CHECK(balance_after>=0),
 unit_cost numeric(36,12) NOT NULL CHECK(unit_cost>=0), reference_quantity_snapshot numeric(18,6) NOT NULL CHECK(reference_quantity_snapshot>0), reference_price_snapshot numeric(18,6) NOT NULL CHECK(reference_price_snapshot>=0), cost_signed numeric(42,6) NOT NULL,
 reason text, attempt_id uuid NOT NULL, request_expected_version bigint NOT NULL CHECK(request_expected_version>=0), request_payload jsonb NOT NULL, result_version bigint NOT NULL CHECK(result_version>=0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((movement_type='opening' AND balance_before=0 AND balance_after=supplied_quantity AND quantity_control=supplied_quantity AND cost_signed>=0) OR
 (movement_type='entry' AND supplied_quantity>0 AND quantity_control>0 AND balance_after=balance_before+quantity_control AND cost_signed>=0 AND reason IS NOT NULL) OR
 (movement_type='consumption' AND supplied_quantity>0 AND quantity_control<0 AND balance_after=balance_before+quantity_control AND cost_signed<=0 AND reason IS NOT NULL) OR
 (movement_type='adjustment' AND balance_after=balance_before+quantity_control AND cost_signed=round(quantity_control*reference_price_snapshot/reference_quantity_snapshot,6) AND reason IS NOT NULL)),
 UNIQUE(enterprise_id,actor_id,attempt_id), FOREIGN KEY(enterprise_id,material_id) REFERENCES public.general_materials(enterprise_id,id)
);
CREATE TABLE public.general_material_cost_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enterprise_id uuid NOT NULL REFERENCES public.enterprises(id), material_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES public.users(id), attempt_id uuid NOT NULL,
 old_quantity numeric(18,6) NOT NULL CHECK(old_quantity>0), old_price numeric(18,6) NOT NULL CHECK(old_price>=0), new_quantity numeric(18,6) NOT NULL CHECK(new_quantity>0), new_price numeric(18,6) NOT NULL CHECK(new_price>=0), expected_version bigint NOT NULL CHECK(expected_version>=0), result_version bigint NOT NULL CHECK(result_version>expected_version), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(enterprise_id,actor_id,attempt_id), FOREIGN KEY(enterprise_id,material_id) REFERENCES public.general_materials(enterprise_id,id)
);
CREATE TABLE private.general_material_receipts(enterprise_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.users(id),attempt_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(enterprise_id,actor_id,attempt_id));

CREATE OR REPLACE FUNCTION private.can_access_enterprise(p_enterprise_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT CASE WHEN p_enterprise_id IS NULL OR p_permission IS NULL THEN false ELSE
 (SELECT count(*)=1 FROM public.enterprise_members em JOIN public.enterprises e ON e.id=em.enterprise_id
  WHERE em.user_id=private.current_internal_user_id() AND em.status='active' AND e.status='active')
 AND EXISTS (SELECT 1 FROM public.enterprise_members em JOIN public.users u ON u.id=em.user_id
  JOIN public.enterprises e ON e.id=em.enterprise_id
  WHERE em.enterprise_id=p_enterprise_id AND em.user_id=private.current_internal_user_id()
    AND em.status='active' AND u.status='active' AND NOT u.must_change_password AND e.status='active'
    AND CASE p_permission
      WHEN 'products.read' THEN em.role IN ('owner','admin','operator') WHEN 'products.write' THEN em.role IN ('owner','admin','operator') WHEN 'products.delete' THEN em.role IN ('owner','admin')
      WHEN 'catalogs.read' THEN em.role IN ('owner','admin','operator') WHEN 'catalogs.write' THEN em.role IN ('owner','admin','operator') WHEN 'catalogs.delete' THEN em.role IN ('owner','admin')
      WHEN 'filters.read' THEN em.role IN ('owner','admin','operator') WHEN 'filters.write' THEN em.role IN ('owner','admin','operator') WHEN 'filters.delete' THEN em.role IN ('owner','admin')
      WHEN 'sales.read' THEN em.role IN ('owner','admin','operator') WHEN 'sales.write' THEN em.role IN ('owner','admin','operator') WHEN 'sales.delete' THEN em.role IN ('owner','admin')
      WHEN 'printers.read' THEN em.role IN ('owner','admin','operator') WHEN 'printers.write' THEN em.role IN ('owner','admin') WHEN 'printers.archive' THEN em.role IN ('owner','admin')
      WHEN 'materials.read' THEN em.role IN ('owner','admin','operator') WHEN 'materials.write' THEN em.role IN ('owner','admin') WHEN 'materials.archive' THEN em.role IN ('owner','admin')
      WHEN 'pricing.read' THEN em.role IN ('owner','admin','operator') WHEN 'pricing.write' THEN em.role IN ('owner','admin','operator') WHEN 'pricing.apply' THEN em.role IN ('owner','admin','operator')
      WHEN 'enterprise.manage' THEN em.role='owner' WHEN 'members.manage_admins' THEN em.role='owner' WHEN 'members.manage_operators' THEN em.role IN ('owner','admin')
      WHEN 'spools.read' THEN em.role IN ('owner','admin','operator') WHEN 'spools.write' THEN em.role IN ('owner','admin','operator') WHEN 'spools.archive' THEN em.role IN ('owner','admin')
      WHEN 'inventory.read' THEN em.role IN ('owner','admin','operator') WHEN 'inventory.write' THEN em.role IN ('owner','admin','operator')
      WHEN 'stock.materials.read' THEN em.role IN ('owner','admin','operator') WHEN 'stock.materials.write' THEN em.role IN ('owner','admin','operator') WHEN 'stock.materials.archive' THEN em.role IN ('owner','admin')
      ELSE false END)
END $$;
CREATE OR REPLACE FUNCTION private.lock_general_material_context(p_permission text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; a uuid:=auth.uid(); issuer text:=auth.jwt()->>'iss'; internal_id uuid;
BEGIN IF a IS NULL OR issuer IS NULL THEN RETURN NULL; END IF; PERFORM pg_advisory_xact_lock(hashtextextended('modulus:enterprise-management:all-members',0)); SELECT * INTO c FROM public.get_my_access_context(); IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR NOT private.can_access_enterprise(c.enterprise_id,p_permission) THEN RETURN NULL; END IF; PERFORM pg_advisory_xact_lock(hashtextextended('modulus:employee-provisioning:actor:'||issuer||':'||a::text,0)); SELECT ai.user_id INTO internal_id FROM public.auth_identities ai JOIN private.auth_issuer_config ac ON ac.issuer=ai.issuer AND ac.provider='supabase' AND ac.status='active' WHERE ai.provider='supabase' AND ai.issuer=issuer AND ai.subject=a::text AND ai.status='active' FOR UPDATE OF ai; IF NOT FOUND THEN RETURN NULL; END IF; PERFORM 1 FROM public.users WHERE id=internal_id AND status='active' AND NOT must_change_password FOR UPDATE; IF NOT FOUND THEN RETURN NULL; END IF; PERFORM 1 FROM public.enterprise_members WHERE enterprise_id=c.enterprise_id AND user_id=internal_id AND status='active' FOR UPDATE; IF NOT FOUND THEN RETURN NULL; END IF; PERFORM 1 FROM public.enterprises WHERE id=c.enterprise_id AND status='active' FOR UPDATE; IF NOT FOUND OR NOT private.can_access_enterprise(c.enterprise_id,p_permission) THEN RETURN NULL; END IF; RETURN c.enterprise_id; END $$;
CREATE OR REPLACE FUNCTION private.read_general_material_context() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE c record; BEGIN SELECT * INTO c FROM public.get_my_access_context(); IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR NOT private.can_access_enterprise(c.enterprise_id,'stock.materials.read') THEN RETURN NULL; END IF; RETURN c.enterprise_id; END $$;
CREATE OR REPLACE FUNCTION private.general_num(v numeric) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN IF v IS NULL OR v::text IN('NaN','Infinity','-Infinity') OR scale(v)>6 OR v<0 OR v>999999999999 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; RETURN v; END $$;
CREATE OR REPLACE FUNCTION private.general_convert(u public.general_material_control_unit,v public.general_material_control_unit,q numeric) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE x numeric; BEGIN IF q IS NULL OR q::text IN('NaN','Infinity','-Infinity') OR q<0 OR q>999999999999 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; IF u=v THEN x:=q; ELSIF u='metro' AND v='centimetro' THEN x:=q*100; ELSIF u='centimetro' AND v='metro' THEN x:=q/100; ELSIF u='quilograma' AND v='grama' THEN x:=q*1000; ELSIF u='grama' AND v='quilograma' THEN x:=q/1000; ELSE RAISE EXCEPTION 'incompatible_units' USING ERRCODE='22023'; END IF; IF x IS NULL OR x::text IN('NaN','Infinity','-Infinity') OR x<0 OR x>999999999999 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; IF x<>round(x,6) THEN RAISE EXCEPTION 'nonrepresentable_conversion' USING ERRCODE='22023'; END IF; x:=round(x,6); IF x<0 OR x>999999999999 OR (q>0 AND x=0) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; RETURN x; END $$;
CREATE OR REPLACE FUNCTION public.general_material_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id OR NEW.create_actor_id IS DISTINCT FROM OLD.create_actor_id OR NEW.create_attempt_id IS DISTINCT FROM OLD.create_attempt_id OR NEW.create_payload IS DISTINCT FROM OLD.create_payload OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.control_unit IS DISTINCT FROM OLD.control_unit THEN RAISE EXCEPTION 'immutable_fields' USING ERRCODE='42501'; END IF; NEW.updated_at:=now(); NEW.version:=OLD.version+1; RETURN NEW; END $$;
CREATE TRIGGER general_material_guard BEFORE UPDATE ON public.general_materials FOR EACH ROW EXECUTE FUNCTION public.general_material_guard();
CREATE OR REPLACE FUNCTION public.general_material_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'history_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER gmm_immutable BEFORE UPDATE OR DELETE ON public.general_material_movements FOR EACH ROW EXECUTE FUNCTION public.general_material_history_guard(); CREATE TRIGGER gmh_immutable BEFORE UPDATE OR DELETE ON public.general_material_cost_history FOR EACH ROW EXECUTE FUNCTION public.general_material_history_guard();

CREATE OR REPLACE FUNCTION public.create_general_material(p_attempt_id uuid,p_name text,p_unit public.general_material_control_unit,p_reference_quantity numeric,p_reference_price numeric,p_opening_quantity numeric DEFAULT 0) RETURNS TABLE(status text,material_id uuid,version bigint,balance numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid;a uuid;m public.general_materials%ROWTYPE;v_payload jsonb;q numeric; conflict_name text;
BEGIN IF p_attempt_id IS NULL OR p_name IS NULL OR btrim(p_name)<>p_name OR length(p_name) NOT BETWEEN 1 AND 120 OR p_unit IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; PERFORM private.general_num(p_reference_quantity); PERFORM private.general_num(p_reference_price); q:=private.general_num(p_opening_quantity); IF p_reference_quantity=0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; e:=private.lock_general_material_context('stock.materials.write'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; a:=private.current_internal_user_id(); v_payload:=jsonb_build_object('name',p_name,'unit',p_unit::text,'reference_quantity',p_reference_quantity,'reference_price',p_reference_price,'opening_quantity',q); SELECT * INTO m FROM public.general_materials WHERE enterprise_id=e AND create_actor_id=a AND create_attempt_id=p_attempt_id FOR UPDATE; IF FOUND THEN IF m.create_payload<>v_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; RETURN QUERY SELECT 'idempotent',m.id,m.version,m.current_balance; RETURN; END IF; SELECT name INTO conflict_name FROM public.general_materials WHERE enterprise_id=e AND name=p_name; IF FOUND THEN RAISE EXCEPTION 'name_conflict' USING ERRCODE='23505'; END IF; INSERT INTO public.general_materials(enterprise_id,name,control_unit,reference_quantity,reference_price,current_balance,create_actor_id,create_attempt_id,create_payload) VALUES(e,p_name,p_unit,p_reference_quantity,p_reference_price,q,a,p_attempt_id,v_payload) RETURNING * INTO m; IF q>0 THEN INSERT INTO public.general_material_movements(enterprise_id,material_id,actor_id,movement_type,supplied_unit,supplied_quantity,quantity_control,balance_before,balance_after,unit_cost,reference_quantity_snapshot,reference_price_snapshot,cost_signed,reason,attempt_id,request_expected_version,request_payload,result_version) VALUES(e,m.id,a,'opening',p_unit,q,q,0,q,round(p_reference_price/p_reference_quantity,12),p_reference_quantity,p_reference_price,round(q*p_reference_price/p_reference_quantity,6),'Abertura',p_attempt_id,0,v_payload,0); END IF; RETURN QUERY SELECT 'created',m.id,m.version,m.current_balance; END $$;

CREATE OR REPLACE FUNCTION public.move_general_material(p_attempt_id uuid,p_material_id uuid,p_expected_version bigint,p_type text,p_unit public.general_material_control_unit,p_quantity numeric,p_reason text DEFAULT NULL) RETURNS TABLE(status text,material_id uuid,movement_id uuid,version bigint,balance numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid;a uuid;m public.general_materials%ROWTYPE;q numeric;delta numeric;after_balance numeric;mv uuid;v_payload jsonb;v_result jsonb;v_stored_payload jsonb;
BEGIN IF p_attempt_id IS NULL OR p_material_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_type IS NULL OR p_type NOT IN('entry','consumption','adjustment') OR p_unit IS NULL OR (p_reason IS NULL OR btrim(p_reason)<>p_reason OR length(p_reason) NOT BETWEEN 1 AND 500) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; q:=private.general_num(p_quantity); IF p_type IN('entry','consumption') AND q=0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; e:=private.lock_general_material_context('stock.materials.write'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; a:=private.current_internal_user_id(); v_payload:=jsonb_build_object('material_id',p_material_id,'type',p_type,'unit',p_unit::text,'quantity',q,'expected_version',p_expected_version,'reason',p_reason); SELECT r.result,r.payload INTO v_result,v_stored_payload FROM private.general_material_receipts AS r WHERE r.enterprise_id=e AND r.actor_id=a AND r.attempt_id=p_attempt_id; IF FOUND THEN IF v_stored_payload<>v_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; RETURN QUERY SELECT (v_result->>'status'),(v_result->>'material_id')::uuid,(v_result->>'movement_id')::uuid,(v_result->>'version')::bigint,(v_result->>'balance')::numeric; RETURN; END IF; SELECT * INTO m FROM public.general_materials WHERE enterprise_id=e AND id=p_material_id FOR UPDATE; IF NOT FOUND OR NOT m.active THEN RAISE EXCEPTION 'material_unavailable' USING ERRCODE='P0002'; END IF; IF m.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF; IF p_type='adjustment' THEN delta:=private.general_convert(p_unit,m.control_unit,q)-m.current_balance; ELSE delta:=private.general_convert(p_unit,m.control_unit,q)*CASE WHEN p_type='consumption' THEN -1 ELSE 1 END; END IF; after_balance:=m.current_balance+delta; IF after_balance<0 THEN RAISE EXCEPTION 'insufficient_balance' USING ERRCODE='22023'; END IF; IF delta=0 THEN v_result:=jsonb_build_object('status','no_change','material_id',m.id,'movement_id',NULL,'version',m.version,'balance',m.current_balance); INSERT INTO private.general_material_receipts (enterprise_id, actor_id, attempt_id, payload, result, created_at) VALUES (e, a, p_attempt_id, v_payload, v_result, now()); RETURN QUERY SELECT 'no_change',m.id,NULL::uuid,m.version,m.current_balance; RETURN; END IF; UPDATE public.general_materials SET current_balance=after_balance WHERE id=m.id RETURNING * INTO m; INSERT INTO public.general_material_movements(enterprise_id,material_id,actor_id,movement_type,supplied_unit,supplied_quantity,quantity_control,balance_before,balance_after,unit_cost,reference_quantity_snapshot,reference_price_snapshot,cost_signed,reason,attempt_id,request_expected_version,request_payload,result_version) VALUES(e,m.id,a,p_type,p_unit,q,delta,after_balance-delta,after_balance,round(m.reference_price/m.reference_quantity,12),m.reference_quantity,m.reference_price,round(delta*m.reference_price/m.reference_quantity,6),p_reason,p_attempt_id,p_expected_version,v_payload,m.version) RETURNING id INTO mv; v_result:=jsonb_build_object('status','updated','material_id',m.id,'movement_id',mv,'version',m.version,'balance',m.current_balance); INSERT INTO private.general_material_receipts (enterprise_id, actor_id, attempt_id, payload, result, created_at) VALUES (e, a, p_attempt_id, v_payload, v_result, now()); RETURN QUERY SELECT 'updated',m.id,mv,m.version,m.current_balance; END $$;

CREATE OR REPLACE FUNCTION public.update_general_material_profile(p_attempt_id uuid,p_material_id uuid,p_expected_version bigint,p_name text) RETURNS TABLE(status text,material_id uuid,version bigint,balance numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE e uuid;a uuid;m public.general_materials%ROWTYPE;v_payload jsonb;v_result jsonb;v_stored_payload jsonb; BEGIN IF p_attempt_id IS NULL OR p_material_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_name IS NULL OR btrim(p_name)<>p_name OR length(p_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; e:=private.lock_general_material_context('stock.materials.archive'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; a:=private.current_internal_user_id(); v_payload:=jsonb_build_object('material_id',p_material_id,'expected_version',p_expected_version,'name',p_name); SELECT r.result,r.payload INTO v_result,v_stored_payload FROM private.general_material_receipts AS r WHERE r.enterprise_id=e AND r.actor_id=a AND r.attempt_id=p_attempt_id; IF FOUND THEN IF v_stored_payload<>v_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; RETURN QUERY SELECT v_result->>'status',(v_result->>'material_id')::uuid,(v_result->>'version')::bigint,(v_result->>'balance')::numeric; RETURN; END IF; SELECT * INTO m FROM public.general_materials WHERE enterprise_id=e AND id=p_material_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'material_unavailable' USING ERRCODE='P0002'; END IF; IF m.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF; IF m.name<>p_name THEN UPDATE public.general_materials SET name=p_name WHERE id=m.id RETURNING * INTO m; END IF; v_result:=jsonb_build_object('status',CASE WHEN m.version=p_expected_version THEN 'no_change' ELSE 'updated' END,'material_id',m.id,'version',m.version,'balance',m.current_balance); INSERT INTO private.general_material_receipts (enterprise_id, actor_id, attempt_id, payload, result, created_at) VALUES (e, a, p_attempt_id, v_payload, v_result, now()); RETURN QUERY SELECT v_result->>'status',m.id,m.version,m.current_balance; END $$;
CREATE OR REPLACE FUNCTION public.update_general_material_cost_reference(p_attempt_id uuid,p_material_id uuid,p_expected_version bigint,p_reference_quantity numeric,p_reference_price numeric) RETURNS TABLE(status text,material_id uuid,version bigint,balance numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE e uuid;a uuid;m public.general_materials%ROWTYPE;v_payload jsonb;v_result jsonb;v_stored_payload jsonb;BEGIN IF p_attempt_id IS NULL OR p_material_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; PERFORM private.general_num(p_reference_quantity);PERFORM private.general_num(p_reference_price);IF p_reference_quantity=0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';END IF;e:=private.lock_general_material_context('stock.materials.archive');IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';END IF;a:=private.current_internal_user_id();v_payload:=jsonb_build_object('material_id',p_material_id,'expected_version',p_expected_version,'quantity',p_reference_quantity,'price',p_reference_price);SELECT r.result,r.payload INTO v_result,v_stored_payload FROM private.general_material_receipts AS r WHERE r.enterprise_id=e AND r.actor_id=a AND r.attempt_id=p_attempt_id;IF FOUND THEN IF v_stored_payload<>v_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;RETURN QUERY SELECT v_result->>'status',(v_result->>'material_id')::uuid,(v_result->>'version')::bigint,(v_result->>'balance')::numeric;RETURN;END IF;SELECT * INTO m FROM public.general_materials WHERE enterprise_id=e AND id=p_material_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'material_unavailable' USING ERRCODE='P0002';END IF;IF m.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001';END IF;IF m.reference_quantity<>p_reference_quantity OR m.reference_price<>p_reference_price THEN 
  INSERT INTO public.general_material_cost_history(enterprise_id,material_id,actor_id,attempt_id,old_quantity,old_price,new_quantity,new_price,expected_version,result_version)
  VALUES(e,m.id,a,p_attempt_id,m.reference_quantity,m.reference_price,p_reference_quantity,p_reference_price,p_expected_version,m.version+1);
  UPDATE public.general_materials SET reference_quantity=p_reference_quantity,reference_price=p_reference_price WHERE id=m.id RETURNING * INTO m;
END IF;v_result:=jsonb_build_object('status',CASE WHEN m.version=p_expected_version THEN 'no_change' ELSE 'updated' END,'material_id',m.id,'version',m.version,'balance',m.current_balance);INSERT INTO private.general_material_receipts (enterprise_id, actor_id, attempt_id, payload, result, created_at) VALUES (e, a, p_attempt_id, v_payload, v_result, now());RETURN QUERY SELECT v_result->>'status',m.id,m.version,m.current_balance;END $$;
CREATE OR REPLACE FUNCTION public.set_general_material_active(p_attempt_id uuid,p_material_id uuid,p_expected_version bigint,p_active boolean) RETURNS TABLE(status text,material_id uuid,version bigint,balance numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE e uuid;a uuid;m public.general_materials%ROWTYPE;v_payload jsonb;v_result jsonb;v_stored_payload jsonb;BEGIN IF p_attempt_id IS NULL OR p_material_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_active IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';END IF;e:=private.lock_general_material_context('stock.materials.archive');IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';END IF;a:=private.current_internal_user_id();v_payload:=jsonb_build_object('material_id',p_material_id,'expected_version',p_expected_version,'active',p_active);SELECT r.result,r.payload INTO v_result,v_stored_payload FROM private.general_material_receipts AS r WHERE r.enterprise_id=e AND r.actor_id=a AND r.attempt_id=p_attempt_id;IF FOUND THEN IF v_stored_payload<>v_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;RETURN QUERY SELECT v_result->>'status',(v_result->>'material_id')::uuid,(v_result->>'version')::bigint,(v_result->>'balance')::numeric;RETURN;END IF;SELECT * INTO m FROM public.general_materials WHERE enterprise_id=e AND id=p_material_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'material_unavailable' USING ERRCODE='P0002';END IF;IF m.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001';END IF;IF m.active<>p_active THEN UPDATE public.general_materials SET active=p_active WHERE id=m.id RETURNING * INTO m;END IF;v_result:=jsonb_build_object('status',CASE WHEN m.version=p_expected_version THEN 'no_change' ELSE 'updated' END,'material_id',m.id,'version',m.version,'balance',m.current_balance);INSERT INTO private.general_material_receipts (enterprise_id, actor_id, attempt_id, payload, result, created_at) VALUES (e, a, p_attempt_id, v_payload, v_result, now());RETURN QUERY SELECT v_result->>'status',m.id,m.version,m.current_balance;END $$;

CREATE OR REPLACE FUNCTION public.list_general_materials(p_search text DEFAULT '',p_status text DEFAULT 'active',p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS SETOF public.general_materials LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT m.* FROM public.general_materials m WHERE private.read_general_material_context()=m.enterprise_id AND p_search IS NOT NULL AND p_status IN('all','active','archived') AND p_limit BETWEEN 1 AND 100 AND p_offset>=0 AND (p_search='' OR m.name ILIKE '%'||p_search||'%') AND (p_status='all' OR (p_status='active' AND m.active) OR (p_status='archived' AND NOT m.active)) ORDER BY m.created_at DESC,m.id LIMIT p_limit OFFSET p_offset $$;
CREATE OR REPLACE FUNCTION public.count_general_materials(p_search text DEFAULT '',p_status text DEFAULT 'active') RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT count(*) FROM public.general_materials m WHERE private.read_general_material_context()=m.enterprise_id AND p_search IS NOT NULL AND p_status IN('all','active','archived') AND (p_search='' OR m.name ILIKE '%'||p_search||'%') AND (p_status='all' OR (p_status='active' AND m.active) OR (p_status='archived' AND NOT m.active)) $$;
CREATE OR REPLACE FUNCTION public.get_general_material(p_material_id uuid) RETURNS SETOF public.general_materials LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT m.* FROM public.general_materials m WHERE private.read_general_material_context()=m.enterprise_id AND p_material_id IS NOT NULL AND m.id=p_material_id $$;
CREATE OR REPLACE FUNCTION public.list_general_material_movements(p_material_id uuid,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS SETOF public.general_material_movements LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT x.* FROM public.general_material_movements x WHERE private.read_general_material_context()=x.enterprise_id AND p_material_id IS NOT NULL AND p_limit BETWEEN 1 AND 100 AND p_offset>=0 AND x.material_id=p_material_id ORDER BY x.created_at DESC,x.id LIMIT p_limit OFFSET p_offset $$;
CREATE OR REPLACE FUNCTION public.list_general_material_cost_history(p_material_id uuid,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS SETOF public.general_material_cost_history LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT x.* FROM public.general_material_cost_history x WHERE private.read_general_material_context()=x.enterprise_id AND p_material_id IS NOT NULL AND p_limit BETWEEN 1 AND 100 AND p_offset>=0 AND x.material_id=p_material_id ORDER BY x.created_at DESC,x.id LIMIT p_limit OFFSET p_offset $$;

ALTER FUNCTION public.general_material_guard() OWNER TO postgres; ALTER FUNCTION public.general_material_history_guard() OWNER TO postgres;
ALTER FUNCTION private.can_access_enterprise(uuid,text) OWNER TO postgres; ALTER FUNCTION private.lock_general_material_context(text) OWNER TO postgres; ALTER FUNCTION private.read_general_material_context() OWNER TO postgres; ALTER FUNCTION private.general_num(numeric) OWNER TO postgres; ALTER FUNCTION private.general_convert(public.general_material_control_unit,public.general_material_control_unit,numeric) OWNER TO postgres;
ALTER FUNCTION public.create_general_material(uuid,text,public.general_material_control_unit,numeric,numeric,numeric) OWNER TO postgres; ALTER FUNCTION public.move_general_material(uuid,uuid,bigint,text,public.general_material_control_unit,numeric,text) OWNER TO postgres; ALTER FUNCTION public.update_general_material_profile(uuid,uuid,bigint,text) OWNER TO postgres; ALTER FUNCTION public.update_general_material_cost_reference(uuid,uuid,bigint,numeric,numeric) OWNER TO postgres; ALTER FUNCTION public.set_general_material_active(uuid,uuid,bigint,boolean) OWNER TO postgres; ALTER FUNCTION public.list_general_materials(text,text,integer,integer) OWNER TO postgres; ALTER FUNCTION public.count_general_materials(text,text) OWNER TO postgres; ALTER FUNCTION public.get_general_material(uuid) OWNER TO postgres; ALTER FUNCTION public.list_general_material_movements(uuid,integer,integer) OWNER TO postgres; ALTER FUNCTION public.list_general_material_cost_history(uuid,integer,integer) OWNER TO postgres;
ALTER TABLE public.general_materials OWNER TO postgres; ALTER TABLE public.general_material_movements OWNER TO postgres; ALTER TABLE public.general_material_cost_history OWNER TO postgres; ALTER TABLE private.general_material_receipts OWNER TO postgres; ALTER TYPE public.general_material_control_unit OWNER TO postgres;
ALTER TABLE private.general_material_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.general_materials ENABLE ROW LEVEL SECURITY; ALTER TABLE public.general_material_movements ENABLE ROW LEVEL SECURITY; ALTER TABLE public.general_material_cost_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.general_materials,public.general_material_movements,public.general_material_cost_history,private.general_material_receipts FROM PUBLIC,anon,authenticated; GRANT USAGE ON TYPE public.general_material_control_unit TO authenticated; GRANT SELECT ON public.general_materials,public.general_material_movements,public.general_material_cost_history TO authenticated;
CREATE POLICY general_materials_read ON public.general_materials FOR SELECT TO authenticated USING(private.can_access_enterprise(enterprise_id,'stock.materials.read')); CREATE POLICY general_material_movements_read ON public.general_material_movements FOR SELECT TO authenticated USING(private.can_access_enterprise(enterprise_id,'stock.materials.read')); CREATE POLICY general_material_history_read ON public.general_material_cost_history FOR SELECT TO authenticated USING(private.can_access_enterprise(enterprise_id,'stock.materials.read'));
REVOKE ALL ON FUNCTION private.can_access_enterprise(uuid,text),private.lock_general_material_context(text),private.read_general_material_context(),private.general_num(numeric),private.general_convert(public.general_material_control_unit,public.general_material_control_unit,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_general_material(uuid,text,public.general_material_control_unit,numeric,numeric,numeric),public.move_general_material(uuid,uuid,bigint,text,public.general_material_control_unit,numeric,text),public.update_general_material_profile(uuid,uuid,bigint,text),public.update_general_material_cost_reference(uuid,uuid,bigint,numeric,numeric),public.set_general_material_active(uuid,uuid,bigint,boolean),public.list_general_materials(text,text,integer,integer),public.count_general_materials(text,text),public.get_general_material(uuid),public.list_general_material_movements(uuid,integer,integer),public.list_general_material_cost_history(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_enterprise(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_general_material(uuid,text,public.general_material_control_unit,numeric,numeric,numeric),public.move_general_material(uuid,uuid,bigint,text,public.general_material_control_unit,numeric,text),public.update_general_material_profile(uuid,uuid,bigint,text),public.update_general_material_cost_reference(uuid,uuid,bigint,numeric,numeric),public.set_general_material_active(uuid,uuid,bigint,boolean),public.list_general_materials(text,text,integer,integer),public.count_general_materials(text,text),public.get_general_material(uuid),public.list_general_material_movements(uuid,integer,integer),public.list_general_material_cost_history(uuid,integer,integer) TO authenticated;
COMMIT;


BEGIN;

CREATE OR REPLACE FUNCTION private.lock_general_material_context(
    p_permission text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_context record;
    v_subject uuid := auth.uid();
    v_issuer text := auth.jwt() ->> 'iss';
    v_internal_user_id uuid;
BEGIN
    IF v_subject IS NULL OR v_issuer IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'modulus:enterprise-management:all-members',
            0
        )
    );

    SELECT ctx.*
    INTO v_context
    FROM public.get_my_access_context() AS ctx;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_context.state IS DISTINCT FROM 'business_ready'
       OR NOT private.can_access_enterprise(
           v_context.enterprise_id,
           p_permission
       )
    THEN
        RETURN NULL;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'modulus:employee-provisioning:actor:'
            || v_issuer || ':' || v_subject::text,
            0
        )
    );

    SELECT ai.user_id
    INTO v_internal_user_id
    FROM public.auth_identities AS ai
    JOIN private.auth_issuer_config AS ac
      ON ac.issuer = ai.issuer
     AND ac.provider = 'supabase'
     AND ac.status = 'active'
    WHERE ai.provider = 'supabase'
      AND ai.issuer = v_issuer
      AND ai.subject = v_subject::text
      AND ai.status = 'active'
    FOR UPDATE OF ai;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    PERFORM 1
    FROM public.users AS u
    WHERE u.id = v_internal_user_id
      AND u.status = 'active'
      AND NOT u.must_change_password
    FOR UPDATE OF u;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    PERFORM 1
    FROM public.enterprise_members AS em
    WHERE em.enterprise_id = v_context.enterprise_id
      AND em.user_id = v_internal_user_id
      AND em.status = 'active'
    FOR UPDATE OF em;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    PERFORM 1
    FROM public.enterprises AS e
    WHERE e.id = v_context.enterprise_id
      AND e.status = 'active'
    FOR UPDATE OF e;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF NOT private.can_access_enterprise(
        v_context.enterprise_id,
        p_permission
    ) THEN
        RETURN NULL;
    END IF;

    RETURN v_context.enterprise_id;
END;
$$;

ALTER FUNCTION private.lock_general_material_context(text)
    OWNER TO postgres;

REVOKE ALL
ON FUNCTION private.lock_general_material_context(text)
FROM PUBLIC, anon, authenticated;

COMMIT;