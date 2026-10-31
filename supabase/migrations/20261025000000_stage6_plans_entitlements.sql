-- Etapa 6A: planos autoritativos e cotas transacionais.
-- Esta migration substitui somente funções por assinatura; migrations aplicadas não são reescritas.
BEGIN;

CREATE TYPE public.modulus_plan_code AS ENUM ('free','intermediate','advanced');
CREATE TYPE public.modulus_access_state AS ENUM ('selection_required','free','paid','expired','cancelled');

CREATE TABLE public.enterprise_plan_access (
  enterprise_id uuid PRIMARY KEY REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  selected_plan public.modulus_plan_code,
  effective_plan public.modulus_plan_code NOT NULL DEFAULT 'free',
  access_state public.modulus_access_state NOT NULL DEFAULT 'selection_required',
  paid_until timestamptz,
  cancelled_at timestamptz,
  authorization_id text,
  authorization_version bigint NOT NULL DEFAULT 0 CHECK (authorization_version >= 0),
  changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT enterprise_plan_state_check CHECK ((
    (selected_plan IS NULL AND effective_plan='free' AND access_state='selection_required' AND paid_until IS NULL AND cancelled_at IS NULL AND authorization_id IS NULL)
    OR (selected_plan='free' AND effective_plan='free' AND access_state='free' AND paid_until IS NULL AND cancelled_at IS NULL AND authorization_id IS NULL)
    OR (selected_plan='intermediate' AND effective_plan='intermediate' AND access_state='paid' AND paid_until IS NOT NULL AND cancelled_at IS NULL AND authorization_id IS NOT NULL AND btrim(authorization_id)<>'')
    OR (selected_plan='intermediate' AND effective_plan='free' AND access_state IN ('expired','cancelled') AND paid_until IS NOT NULL AND authorization_id IS NOT NULL AND btrim(authorization_id)<>'' AND ((access_state='expired' AND cancelled_at IS NULL) OR (access_state='cancelled' AND cancelled_at IS NOT NULL)))
  ) IS TRUE),
  CONSTRAINT enterprise_plan_paid_until_finite_check CHECK ((paid_until IS NULL OR isfinite(paid_until)) IS TRUE),
  CONSTRAINT enterprise_plan_cancelled_at_finite_check CHECK ((cancelled_at IS NULL OR isfinite(cancelled_at)) IS TRUE)
);
CREATE UNIQUE INDEX enterprise_plan_authorization_uidx ON public.enterprise_plan_access(authorization_id) WHERE authorization_id IS NOT NULL;

-- Histórico global de autorizações para suportar replay sem regrant e rastreabilidade cross-enterprise rigorosa.
CREATE TABLE private.enterprise_authorization_receipts (
  authorization_id text PRIMARY KEY CHECK (btrim(authorization_id) <> '' AND length(authorization_id) <= 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  authorization_version bigint NOT NULL CHECK (authorization_version >= 1),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.enterprise_plan_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('selection_fixture','paid_confirmed','cancelled')),
  selected_plan public.modulus_plan_code,
  effective_plan public.modulus_plan_code NOT NULL,
  access_state public.modulus_access_state NOT NULL,
  paid_until timestamptz,
  cancelled_at timestamptz,
  authorization_id text,
  authorization_version bigint NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  integration_actor text,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((changed_by IS NULL) <> (integration_actor IS NULL)),
  CHECK (authorization_version >= 0)
);

CREATE OR REPLACE FUNCTION public.enterprise_plan_access_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'plan_access_audit_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER enterprise_plan_access_audit_immutable
BEFORE UPDATE OR DELETE ON public.enterprise_plan_access_audit
FOR EACH ROW EXECUTE FUNCTION public.enterprise_plan_access_audit_immutable();

CREATE TABLE private.product_create_receipts (
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (enterprise_id,actor_id,attempt_id)
);

CREATE OR REPLACE FUNCTION public.modulus_plan_limits(p_plan public.modulus_plan_code)
RETURNS TABLE(plan public.modulus_plan_code,product_limit bigint,products_unlimited boolean,shared_material_limit bigint,shared_materials_unlimited boolean,order_limit bigint,orders_unlimited boolean,customer_limit bigint,customers_unlimited boolean,operator_limit bigint,integrated_pricing boolean,printers_enabled boolean,materials_enabled boolean)
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_plan,
   CASE p_plan WHEN 'free' THEN 3::bigint ELSE NULL::bigint END, p_plan IN ('intermediate','advanced'),
   CASE p_plan WHEN 'free' THEN 0::bigint WHEN 'intermediate' THEN 15::bigint ELSE NULL::bigint END, p_plan='advanced',
   CASE p_plan WHEN 'free' THEN 3::bigint ELSE NULL::bigint END, p_plan IN ('intermediate','advanced'),
   CASE p_plan WHEN 'free' THEN 3::bigint WHEN 'intermediate' THEN 15::bigint ELSE NULL::bigint END, p_plan='advanced',
   CASE p_plan WHEN 'free' THEN 0::bigint WHEN 'intermediate' THEN 1::bigint WHEN 'advanced' THEN 3::bigint END,
   p_plan IN ('intermediate','advanced'),p_plan IN ('intermediate','advanced'),p_plan IN ('intermediate','advanced')
 WHERE p_plan IS NOT NULL;
$$;

-- Resolve sempre pelo relógio do banco; effective_plan persistido não concede acesso após paid_until.
CREATE OR REPLACE FUNCTION private.resolve_enterprise_plan(p_enterprise_id uuid)
RETURNS TABLE(selected_plan public.modulus_plan_code,effective_plan public.modulus_plan_code,access_state public.modulus_access_state,paid_until timestamptz,cancelled_at timestamptz,authorization_version bigint,selection_required boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.selected_plan,
   CASE WHEN a.selected_plan='intermediate' AND a.access_state='paid' AND a.cancelled_at IS NULL AND a.paid_until>statement_timestamp() THEN 'intermediate'::public.modulus_plan_code ELSE 'free'::public.modulus_plan_code END,
   CASE WHEN a.selected_plan='intermediate' AND a.access_state='paid' AND a.cancelled_at IS NULL AND a.paid_until<=statement_timestamp() THEN 'expired'::public.modulus_access_state ELSE a.access_state END,
   a.paid_until,a.cancelled_at,a.authorization_version,
   (a.selected_plan IS NULL AND a.access_state='selection_required')
 FROM public.enterprise_plan_access AS a WHERE a.enterprise_id=p_enterprise_id
 UNION ALL
 SELECT NULL::public.modulus_plan_code,'free'::public.modulus_plan_code,'selection_required'::public.modulus_access_state,NULL::timestamptz,NULL::timestamptz,0::bigint,true
 WHERE p_enterprise_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.enterprise_plan_access AS missing WHERE missing.enterprise_id=p_enterprise_id)
 LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_plan_access()
RETURNS TABLE(enterprise_id uuid,selected_plan public.modulus_plan_code,effective_plan public.modulus_plan_code,access_state public.modulus_access_state,paid_until timestamptz,cancelled_at timestamptz,authorization_version bigint,selection_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context record;
BEGIN
 SELECT context_row.* INTO v_context FROM public.get_my_access_context() AS context_row;
 IF NOT FOUND OR v_context.state IS DISTINCT FROM 'business_ready' OR v_context.enterprise_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT v_context.enterprise_id,resolved.selected_plan,resolved.effective_plan,resolved.access_state,resolved.paid_until,resolved.cancelled_at,resolved.authorization_version,resolved.selection_required FROM private.resolve_enterprise_plan(v_context.enterprise_id) AS resolved;
END $$;

CREATE OR REPLACE FUNCTION private.lock_plan_quota(p_enterprise_id uuid,p_feature text)
RETURNS public.modulus_plan_code LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_plan public.modulus_plan_code; v_state public.modulus_access_state;
BEGIN
 IF p_enterprise_id IS NULL OR p_feature NOT IN ('products.create','shared_materials.create','printers.create') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 -- Os context helpers já retêm o lock global de gestão; não adquirir lock de cota redundante.
 PERFORM 1 FROM public.enterprise_plan_access AS access_row WHERE access_row.enterprise_id=p_enterprise_id FOR UPDATE;
 SELECT resolved.effective_plan,resolved.access_state INTO v_plan,v_state FROM private.resolve_enterprise_plan(p_enterprise_id) AS resolved;
 IF v_state='selection_required' THEN RAISE EXCEPTION 'selection_required' USING ERRCODE='42501'; END IF;
 IF p_feature IN ('shared_materials.create','printers.create') AND v_plan='free' THEN RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501'; END IF;
 IF v_plan IS NULL THEN RAISE EXCEPTION 'plan_not_found' USING ERRCODE='P0002'; END IF;
 RETURN v_plan;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_enterprise_paid_access(p_enterprise_id uuid,p_plan public.modulus_plan_code,p_paid_until timestamptz,p_authorization_id text,p_expected_version bigint)
RETURNS TABLE(status text,authorization_version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_access public.enterprise_plan_access%ROWTYPE; v_other_enterprise uuid; v_receipt private.enterprise_authorization_receipts%ROWTYPE; v_stmt_time timestamptz := statement_timestamp(); v_payload jsonb;
BEGIN
 -- Validação estrutural permite recuperar recibos históricos vencidos.
 IF p_enterprise_id IS NULL OR p_plan IS DISTINCT FROM 'intermediate' OR p_paid_until IS NULL OR NOT isfinite(p_paid_until) OR p_authorization_id IS NULL OR btrim(p_authorization_id)='' OR length(p_authorization_id)>200 OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_authorization' USING ERRCODE='22023'; END IF;
 -- Epoch numérico preserva o instante/microssegundos e independe do TimeZone da sessão.
 v_payload:=jsonb_build_object('plan',p_plan::text,'paid_until_epoch',extract(epoch FROM p_paid_until));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 PERFORM 1 FROM public.enterprises AS enterprise_row WHERE enterprise_row.id=p_enterprise_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='40001'; END IF;
 SELECT receipt.* INTO v_receipt FROM private.enterprise_authorization_receipts AS receipt WHERE receipt.authorization_id=p_authorization_id FOR UPDATE;
 IF FOUND THEN
   IF v_receipt.enterprise_id IS DISTINCT FROM p_enterprise_id OR v_receipt.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='40001'; END IF;
   -- Recuperação histórica: não toca acesso, validade, versão ou auditoria atuais.
   RETURN QUERY SELECT 'idempotent',v_receipt.authorization_version;
   RETURN;
 END IF;
 -- Somente uma autorização NOVA exige validade futura.
 IF p_paid_until<=v_stmt_time THEN RAISE EXCEPTION 'invalid_authorization' USING ERRCODE='22023'; END IF;
 SELECT access_row.enterprise_id INTO v_other_enterprise FROM public.enterprise_plan_access AS access_row WHERE access_row.authorization_id=p_authorization_id AND access_row.enterprise_id<>p_enterprise_id;
 IF FOUND THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='40001'; END IF;
 SELECT access_row.* INTO v_access FROM public.enterprise_plan_access AS access_row WHERE access_row.enterprise_id=p_enterprise_id FOR UPDATE;
 IF NOT FOUND THEN
   IF p_expected_version<>0 THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='40001'; END IF;
   INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,paid_until,cancelled_at,authorization_id,authorization_version,changed_by,changed_at)
   VALUES(p_enterprise_id,'intermediate','intermediate','paid',p_paid_until,NULL,p_authorization_id,1,NULL,v_stmt_time)
   RETURNING * INTO v_access;
 ELSE
   IF v_access.authorization_version<>p_expected_version THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='40001'; END IF;
   UPDATE public.enterprise_plan_access AS access_row
   SET selected_plan='intermediate',effective_plan='intermediate',access_state='paid',paid_until=p_paid_until,cancelled_at=NULL,authorization_id=p_authorization_id,authorization_version=access_row.authorization_version+1,changed_by=NULL,changed_at=v_stmt_time
   WHERE access_row.enterprise_id=p_enterprise_id
   RETURNING * INTO v_access;
 END IF;
 INSERT INTO private.enterprise_authorization_receipts(authorization_id,payload,authorization_version,enterprise_id)
 VALUES(p_authorization_id,v_payload,v_access.authorization_version,p_enterprise_id);
 INSERT INTO public.enterprise_plan_access_audit(enterprise_id,operation,selected_plan,effective_plan,access_state,paid_until,cancelled_at,authorization_id,authorization_version,changed_by,integration_actor)
 VALUES(v_access.enterprise_id,'paid_confirmed',v_access.selected_plan,v_access.effective_plan,v_access.access_state,v_access.paid_until,v_access.cancelled_at,v_access.authorization_id,v_access.authorization_version,NULL,'billing-integration');
 RETURN QUERY SELECT 'confirmed',v_access.authorization_version;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_enterprise_paid_access(p_enterprise_id uuid,p_expected_version bigint)
RETURNS TABLE(status text,authorization_version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_access public.enterprise_plan_access%ROWTYPE; v_stmt_time timestamptz := statement_timestamp();
BEGIN
 IF p_enterprise_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 PERFORM 1 FROM public.enterprises AS enterprise_row WHERE enterprise_row.id=p_enterprise_id FOR UPDATE;
 SELECT access_row.* INTO v_access FROM public.enterprise_plan_access AS access_row WHERE access_row.enterprise_id=p_enterprise_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='40001'; END IF;
 IF v_access.access_state='cancelled' THEN RETURN QUERY SELECT 'idempotent',v_access.authorization_version; RETURN; END IF;
 IF v_access.authorization_version<>p_expected_version OR v_access.selected_plan IS DISTINCT FROM 'intermediate' OR v_access.authorization_id IS NULL THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='40001'; END IF;
 UPDATE public.enterprise_plan_access AS access_row SET effective_plan='free',access_state='cancelled',cancelled_at=v_stmt_time,authorization_version=access_row.authorization_version+1,changed_by=NULL,changed_at=v_stmt_time WHERE access_row.enterprise_id=p_enterprise_id RETURNING * INTO v_access;
 INSERT INTO public.enterprise_plan_access_audit(enterprise_id,operation,selected_plan,effective_plan,access_state,paid_until,cancelled_at,authorization_id,authorization_version,changed_by,integration_actor) VALUES(v_access.enterprise_id,'cancelled',v_access.selected_plan,v_access.effective_plan,v_access.access_state,v_access.paid_until,v_access.cancelled_at,v_access.authorization_id,v_access.authorization_version,NULL,'billing-integration');
 RETURN QUERY SELECT 'cancelled',v_access.authorization_version;
END $$;

-- Produto interno: suporte à assinatura antiga (revogada de anon/authenticated para impedir bypass) e à nova uuid idempotente.
CREATE OR REPLACE FUNCTION public.create_internal_product(p_name text,p_description text DEFAULT NULL,p_price numeric DEFAULT NULL,p_images jsonb DEFAULT '[]')
RETURNS TABLE(status text,product_id uuid,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.create_internal_product(text,text,numeric,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_internal_product(p_attempt_id uuid,p_name text,p_description text DEFAULT NULL,p_price numeric DEFAULT NULL,p_images jsonb DEFAULT '[]')
RETURNS TABLE(status text,product_id uuid,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_enterprise uuid; v_actor uuid; v_product public.products%ROWTYPE; v_name text; v_payload jsonb; v_stored jsonb; v_result jsonb; v_plan public.modulus_plan_code;
BEGIN
 v_name:=btrim(p_name); IF p_attempt_id IS NULL OR v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 255 OR (p_description IS NOT NULL AND length(p_description)>3000) OR (p_price IS NOT NULL AND (p_price<0 OR p_price>1000000)) OR p_images IS DISTINCT FROM '[]'::jsonb THEN RETURN QUERY SELECT 'invalid_input',NULL::uuid,NULL::bigint; RETURN; END IF;
 v_enterprise:=private.lock_internal_product_context('products.write'); IF v_enterprise IS NULL THEN RETURN QUERY SELECT 'permission_denied',NULL::uuid,NULL::bigint; RETURN; END IF; v_actor:=private.current_internal_user_id();
 v_payload:=jsonb_build_object('name',v_name,'description',p_description,'price',p_price,'images',p_images);
 SELECT receipt.payload,receipt.result INTO v_stored,v_result FROM private.product_create_receipts AS receipt WHERE receipt.enterprise_id=v_enterprise AND receipt.actor_id=v_actor AND receipt.attempt_id=p_attempt_id FOR UPDATE;
 IF FOUND THEN IF v_stored<>v_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; PERFORM private.lock_plan_quota(v_enterprise,'products.create'); RETURN QUERY SELECT v_result->>'status',(v_result->>'product_id')::uuid,(v_result->>'version')::bigint; RETURN; END IF;
 v_plan:=private.lock_plan_quota(v_enterprise,'products.create');
 IF v_plan='free' AND (SELECT count(*) FROM public.products AS product_row WHERE product_row.enterprise_id=v_enterprise AND product_row.deleted_at IS NULL)>=3 THEN RAISE EXCEPTION 'plan_limit_reached' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.products(enterprise_id,name,description,price) VALUES(v_enterprise,v_name,p_description,p_price) RETURNING * INTO v_product;
 v_result:=jsonb_build_object('status','success','product_id',v_product.id,'version',v_product.version); INSERT INTO private.product_create_receipts(enterprise_id,actor_id,attempt_id,payload,result) VALUES(v_enterprise,v_actor,p_attempt_id,v_payload,v_result);
 RETURN QUERY SELECT 'success',v_product.id,v_product.version;
END $$;

CREATE OR REPLACE FUNCTION public.create_filament_spool(p_attempt_id uuid,p_type text,p_brand text,p_color text,p_internal_identifier text,p_original_grams numeric,p_initial_balance_grams numeric,p_purchase_price numeric)
RETURNS TABLE(status text,spool_id uuid,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid;a uuid;s public.filament_spools%ROWTYPE;ty text;br text;co text;ident text;payload jsonb;u numeric(21,9);c numeric(21,6);v_plan public.modulus_plan_code;
BEGIN
 IF p_attempt_id IS NULL OR p_type IS NULL OR p_internal_identifier IS NULL OR p_original_grams IS NULL OR p_initial_balance_grams IS NULL OR p_purchase_price IS NULL OR p_type=btrim(p_type) IS NOT TRUE OR p_brand IS DISTINCT FROM btrim(p_brand) OR p_color IS DISTINCT FROM btrim(p_color) OR p_internal_identifier=btrim(p_internal_identifier) IS NOT TRUE OR p_original_grams::text IN('NaN','Infinity','-Infinity') OR p_initial_balance_grams::text IN('NaN','Infinity','-Infinity') OR p_purchase_price::text IN('NaN','Infinity','-Infinity') OR p_original_grams NOT BETWEEN .001 AND 100000 OR p_initial_balance_grams NOT BETWEEN 0 AND p_original_grams OR p_purchase_price NOT BETWEEN 0 AND 1000000 OR scale(p_original_grams)>3 OR scale(p_initial_balance_grams)>3 OR scale(p_purchase_price)>2 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 ty:=btrim(p_type);br:=nullif(btrim(p_brand),'');co:=nullif(btrim(p_color),'');ident:=btrim(p_internal_identifier); IF length(ty) NOT BETWEEN 1 AND 80 OR ident='' OR length(ident)>120 OR (br IS NOT NULL AND length(br) NOT BETWEEN 1 AND 120) OR (co IS NOT NULL AND length(co) NOT BETWEEN 1 AND 80) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 e:=private.lock_filament_spool_context('spools.write');IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';END IF;a:=private.current_internal_user_id();payload:=jsonb_build_object('type',ty,'brand',br,'color',co,'internal_identifier',ident,'original_filament_grams',p_original_grams,'initial_balance_grams',p_initial_balance_grams,'purchase_price',p_purchase_price);
 SELECT fs.* INTO s FROM public.filament_spools AS fs WHERE fs.enterprise_id=e AND fs.create_actor_id=a AND fs.create_attempt_id=p_attempt_id FOR UPDATE;
 IF FOUND THEN IF s.create_profile<>payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; PERFORM private.lock_plan_quota(e,'shared_materials.create'); RETURN QUERY SELECT 'idempotent',s.id,0::bigint;RETURN;END IF;
 v_plan:=private.lock_plan_quota(e,'shared_materials.create'); IF (SELECT count(*) FROM public.filament_spools fs WHERE fs.enterprise_id=e AND fs.deleted_at IS NULL)+(SELECT count(*) FROM public.general_materials gm WHERE gm.enterprise_id=e AND gm.deleted_at IS NULL)>=15 THEN RAISE EXCEPTION 'plan_limit_reached' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public.filament_spools fs WHERE fs.enterprise_id=e AND fs.internal_identifier=ident) THEN RAISE EXCEPTION 'identifier_conflict' USING ERRCODE='23505';END IF;
 INSERT INTO public.filament_spools(enterprise_id,material_id,material_type,brand,color,internal_identifier,original_filament_grams,current_balance_grams,purchase_price,create_attempt_id,create_actor_id,create_internal_identifier,create_initial_balance_grams,create_purchase_price,create_profile) VALUES(e,NULL,ty,br,co,ident,p_original_grams,p_initial_balance_grams,p_purchase_price,p_attempt_id,a,ident,p_initial_balance_grams,p_purchase_price,payload) RETURNING * INTO s;
 u:=round(p_purchase_price/p_original_grams,9);c:=round(p_initial_balance_grams*p_purchase_price/p_original_grams,6); INSERT INTO public.filament_spool_movements(enterprise_id,spool_id,actor_id,movement_type,quantity_grams,balance_before_grams,balance_after_grams,unit_cost_per_gram,movement_cost,reason,attempt_id,request_expected_version,request_quantity_grams,result_version) VALUES(e,s.id,a,'opening',p_initial_balance_grams,0,p_initial_balance_grams,u,c,NULL,p_attempt_id,0,p_initial_balance_grams,0);
 RETURN QUERY SELECT 'created',s.id,s.version;
END $$;

CREATE OR REPLACE FUNCTION public.create_general_material(p_attempt_id uuid,p_name text,p_unit public.general_material_control_unit,p_reference_quantity numeric,p_reference_price numeric,p_opening_quantity numeric DEFAULT 0)
RETURNS TABLE(status text,material_id uuid,version bigint,balance numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid;a uuid;m public.general_materials%ROWTYPE;v_payload jsonb;q numeric;conflict_name text;v_plan public.modulus_plan_code;
BEGIN
 IF p_attempt_id IS NULL OR p_name IS NULL OR btrim(p_name)<>p_name OR length(p_name) NOT BETWEEN 1 AND 120 OR p_unit IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';END IF;PERFORM private.general_num(p_reference_quantity);PERFORM private.general_num(p_reference_price);q:=private.general_num(p_opening_quantity);IF p_reference_quantity=0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';END IF;
 e:=private.lock_general_material_context('stock.materials.write');IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';END IF;a:=private.current_internal_user_id();v_payload:=jsonb_build_object('name',p_name,'unit',p_unit::text,'reference_quantity',p_reference_quantity,'reference_price',p_reference_price,'opening_quantity',q);
 SELECT gm.* INTO m FROM public.general_materials gm WHERE gm.enterprise_id=e AND gm.create_actor_id=a AND gm.create_attempt_id=p_attempt_id FOR UPDATE;
 IF FOUND THEN IF m.create_payload<>v_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;PERFORM private.lock_plan_quota(e,'shared_materials.create');RETURN QUERY SELECT 'idempotent',m.id,m.version,m.current_balance;RETURN;END IF;
 v_plan:=private.lock_plan_quota(e,'shared_materials.create');IF (SELECT count(*) FROM public.filament_spools fs WHERE fs.enterprise_id=e AND fs.deleted_at IS NULL)+(SELECT count(*) FROM public.general_materials gm WHERE gm.enterprise_id=e AND gm.deleted_at IS NULL)>=15 THEN RAISE EXCEPTION 'plan_limit_reached' USING ERRCODE='P0001';END IF;
 SELECT gm.name INTO conflict_name FROM public.general_materials gm WHERE gm.enterprise_id=e AND gm.name=p_name;IF FOUND THEN RAISE EXCEPTION 'name_conflict' USING ERRCODE='23505';END IF;
 INSERT INTO public.general_materials(enterprise_id,name,control_unit,reference_quantity,reference_price,current_balance,create_actor_id,create_attempt_id,create_payload) VALUES(e,p_name,p_unit,p_reference_quantity,p_reference_price,q,a,p_attempt_id,v_payload) RETURNING * INTO m;
 IF q>0 THEN INSERT INTO public.general_material_movements(enterprise_id,material_id,actor_id,movement_type,supplied_unit,supplied_quantity,quantity_control,balance_before,balance_after,unit_cost,reference_quantity_snapshot,reference_price_snapshot,cost_signed,reason,attempt_id,request_expected_version,request_payload,result_version) VALUES(e,m.id,a,'opening',p_unit,q,q,0,q,round(p_reference_price/p_reference_quantity,12),p_reference_quantity,p_reference_price,round(q*p_reference_price/p_reference_quantity,6),NULL,p_attempt_id,0,v_payload,0);END IF;
 RETURN QUERY SELECT 'created',m.id,m.version,m.current_balance;
END $$;

-- Bloqueio rigoroso de impressora no plano Free
CREATE OR REPLACE FUNCTION public.create_my_printer(
    p_name TEXT,
    p_brand TEXT,
    p_model TEXT,
    p_purchase_price NUMERIC,
    p_estimated_life_hours NUMERIC,
    p_average_power_watts NUMERIC,
    p_maintenance_cost_per_hour NUMERIC
) RETURNS TABLE(status TEXT, printer_id UUID, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_enterprise_id UUID;
    v_plan public.modulus_plan_code;
    v_printer public.printers%ROWTYPE;
BEGIN
    v_enterprise_id := private.lock_internal_printer_context('printers.write');
    IF v_enterprise_id IS NULL THEN
        RETURN QUERY SELECT 'unauthorized'::TEXT, NULL::UUID, NULL::BIGINT;
        RETURN;
    END IF;

    v_plan := private.lock_plan_quota(v_enterprise_id, 'printers.create');

    IF NOT private.printer_args_ok(p_name, p_brand, p_model, p_purchase_price,
                                   p_estimated_life_hours, p_average_power_watts,
                                   p_maintenance_cost_per_hour) THEN
        RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::UUID, NULL::BIGINT;
        RETURN;
    END IF;

    INSERT INTO public.printers (enterprise_id, name, brand, model, purchase_price,
                                 estimated_life_hours, average_power_watts,
                                 maintenance_cost_per_hour)
    VALUES (v_enterprise_id, p_name, p_brand, p_model, p_purchase_price,
            p_estimated_life_hours, p_average_power_watts,
            p_maintenance_cost_per_hour)
    RETURNING * INTO v_printer;

    RETURN QUERY SELECT 'success'::TEXT, v_printer.id, v_printer.version;
END $$;

ALTER TABLE public.enterprise_plan_access OWNER TO postgres; ALTER TABLE private.enterprise_authorization_receipts OWNER TO postgres; ALTER TABLE public.enterprise_plan_access_audit OWNER TO postgres; ALTER TABLE private.product_create_receipts OWNER TO postgres;
ALTER TABLE public.enterprise_plan_access ENABLE ROW LEVEL SECURITY; ALTER TABLE private.enterprise_authorization_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.enterprise_plan_access_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE private.product_create_receipts ENABLE ROW LEVEL SECURITY;
ALTER FUNCTION public.modulus_plan_limits(public.modulus_plan_code) OWNER TO postgres; ALTER FUNCTION private.resolve_enterprise_plan(uuid) OWNER TO postgres; ALTER FUNCTION public.get_my_plan_access() OWNER TO postgres; ALTER FUNCTION private.lock_plan_quota(uuid,text) OWNER TO postgres; ALTER FUNCTION public.confirm_enterprise_paid_access(uuid,public.modulus_plan_code,timestamptz,text,bigint) OWNER TO postgres; ALTER FUNCTION public.cancel_enterprise_paid_access(uuid,bigint) OWNER TO postgres; ALTER FUNCTION public.create_internal_product(uuid,text,text,numeric,jsonb) OWNER TO postgres; ALTER FUNCTION public.create_my_printer(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) OWNER TO postgres;
REVOKE ALL ON public.enterprise_plan_access,private.enterprise_authorization_receipts,public.enterprise_plan_access_audit,private.product_create_receipts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.resolve_enterprise_plan(uuid),private.lock_plan_quota(uuid,text),public.confirm_enterprise_paid_access(uuid,public.modulus_plan_code,timestamptz,text,bigint),public.cancel_enterprise_paid_access(uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.modulus_plan_limits(public.modulus_plan_code),public.get_my_plan_access(),public.create_internal_product(uuid,text,text,numeric,jsonb),public.create_my_printer(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.modulus_plan_limits(public.modulus_plan_code),public.get_my_plan_access(),public.create_internal_product(uuid,text,text,numeric,jsonb),public.create_filament_spool(uuid,text,text,text,text,numeric,numeric,numeric),public.create_general_material(uuid,text,public.general_material_control_unit,numeric,numeric,numeric),public.create_my_printer(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
-- Integração futura: as funções abaixo permanecem sem grant a anon/authenticated. O deploy deve conceder apenas ao papel técnico dedicado.
REVOKE ALL ON FUNCTION public.confirm_enterprise_paid_access(uuid,public.modulus_plan_code,timestamptz,text,bigint),public.cancel_enterprise_paid_access(uuid,bigint) FROM service_role;
COMMIT;
