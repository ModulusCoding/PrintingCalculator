"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { createSpoolSchema, createMovementSchema, updateProfileSchema, updateIdentitySchema, setActiveSchema, updateThresholdSchema, fieldErrors, pt, uuid, version } from "./validation";
import { spoolSchema, spoolListSchema, materialSchema, configSchema, movementSchema, spoolColumns, movementColumns, countSchema, nonnegative } from "./schemas";
export type MutationResult = {status:string;spool_id?:string;movement_id?:string|null;balance_grams?:number;version?:number;fieldErrors?:Record<string,string[]>};
function failure(e:unknown):string { if(e instanceof AuthContextError)return e.code==="AUTH_UNAUTHENTICATED"?"session_expired":e.code==="AUTH_TECHNICAL_FAILURE"||e.code==="AUTH_CONTEXT_INVALID_RESPONSE"?"technical":"permission_denied"; return "technical"; }
const known = new Set(["unauthorized","material_unavailable","spool_unavailable","version_conflict","insufficient_balance","capacity_exceeded","identifier_conflict","idempotency_conflict","invalid_input"]);
const createResult=z.object({status:z.enum(["created","idempotent"]),spool_id:uuid,version:z.literal(0)}).strict();
const movementResult=z.object({status:z.enum(["created","idempotent","no_change"]),movement_id:uuid.nullable(),spool_id:uuid,version, balance_grams:nonnegative}).strict().refine(r=>(r.status==="no_change")===(r.movement_id===null));
const updateResult=z.object({status:z.enum(["updated","no_change"]),spool_id:uuid,version}).strict();
const thresholdResult=z.object({status:z.enum(["updated","no_change","version_conflict"]),version}).strict();
const consumptionSummarySchema=z.object({total_consumed_grams:nonnegative,total_consumption_cost:nonnegative}).strict();
async function mutate(name:string,args:Record<string,unknown>,permission:"spools.write"|"spools.archive"|"enterprise.manage",schema:z.ZodType):Promise<MutationResult>{
 let dispatched=false;
 try {
  await requireBusinessContext(permission); const client=await createClient(); dispatched=true;
  const {data,error}=await client.rpc(name,args);
  if(error){const code=error.message.replace(/^(?:ERROR: |[A-Z0-9]{5}: )/, "");if(known.has(code))return {status:code==="unauthorized"?"permission_denied":code};return {status:"uncertain"};}
  const parsed=z.array(schema).length(1).safeParse(data);if(!parsed.success)return {status:"uncertain"};
  const r=parsed.data[0] as {status:string;spool_id?:string;version:number;balance_grams?:number};
  if(args.p_spool_id && r.spool_id!==args.p_spool_id)return {status:"uncertain"};
  if(r.status!=="idempotent" && typeof args.p_expected_version==="number" && r.status!=="version_conflict" && r.version!==args.p_expected_version+(r.status==="no_change"?0:1))return {status:"uncertain"};
  // Cache invalidation failure must never turn a committed write into a retryable failure.
  try{revalidatePath("/estoque/carreteis","layout");}catch{}
  return {status:r.status,...(r.spool_id?{spool_id:r.spool_id}:{}),...("movement_id" in r?{movement_id:(r as {movement_id:string|null}).movement_id}:{}),...(typeof r.version==="number"?{version:r.version}:{}),...(typeof r.balance_grams==="number"?{balance_grams:r.balance_grams}:{})};
 }catch(e){return {status:dispatched?"uncertain":failure(e)};}
}
export async function listSpools(params:Record<string,string|undefined>={}){
 const page=Math.min(5001,Math.max(1,Math.floor(Number(params.page)||1))); const search=(params.search||"").trim().slice(0,120);const status=z.enum(["active","archived","all","low","empty"]).catch("active").parse(params.status);
 try{await requireBusinessContext("spools.read");const s=await createClient();const [list,count]=await Promise.all([s.rpc("list_filament_spools",{p_search:search,p_status:status,p_limit:20,p_offset:(page-1)*20}),s.rpc("count_filament_spools",{p_search:search,p_status:status})]);if(list.error||count.error)throw Error();return {spools:z.array(spoolListSchema).max(20).parse(list.data),total:countSchema.parse(count.data),page,error:null};}catch(e){return {spools:[],total:0,page,error:failure(e)};}
}
export async function searchMaterials(params:{search?:string;page?:number}){
 try{await requireBusinessContext("spools.read");const s=await createClient(),search=(params.search||"").trim().slice(0,120),page=Math.min(5001,Math.max(1,Math.floor(params.page||1)));const [items,count]=await Promise.all([s.rpc("search_materials_for_spools",{p_search:search,p_limit:20,p_offset:(page-1)*20}),s.rpc("count_materials_for_spools",{p_search:search})]);if(items.error||count.error)throw Error();return {items:z.array(materialSchema).max(20).parse(items.data),total:countSchema.parse(count.data),error:null};}catch(e){return {items:[],total:0,error:failure(e)};}
}
export async function createSpool(payload:unknown):Promise<MutationResult>{const v=createSpoolSchema.safeParse(payload);if(!v.success)return {status:"invalid_input",fieldErrors:fieldErrors(v.error)};const d=v.data;return mutate("create_filament_spool",{p_attempt_id:d.attempt_id,p_type:d.material_type,p_brand:d.brand,p_color:d.color,p_internal_identifier:d.internal_identifier,p_original_grams:pt(d.original_grams),p_initial_balance_grams:pt(d.initial_balance_grams),p_purchase_price:pt(d.purchase_price)},"spools.write",createResult);}
export async function createMovement(payload:unknown):Promise<MutationResult>{const v=createMovementSchema.safeParse(payload);if(!v.success)return {status:"invalid_input",fieldErrors:fieldErrors(v.error)};const d=v.data;return mutate("create_filament_spool_movement",{p_attempt_id:d.attempt_id,p_spool_id:d.spool_id,p_expected_version:d.expected_version,p_movement_type:d.movement_type,p_quantity_grams:"quantity_grams" in d?pt(d.quantity_grams):null,p_counted_balance_grams:"counted_balance_grams" in d?pt(d.counted_balance_grams):null,p_reason:d.reason},"spools.write",movementResult);}
export async function updateSpoolIdentity(payload:unknown):Promise<MutationResult>{const v=updateIdentitySchema.safeParse(payload);if(!v.success)return {status:"invalid_input",fieldErrors:fieldErrors(v.error)};return mutate("update_filament_spool_identity",{p_spool_id:v.data.spool_id,p_expected_version:v.data.expected_version,p_internal_identifier:v.data.internal_identifier},"spools.archive",updateResult);}
export async function updateSpoolProfile(payload:unknown):Promise<MutationResult>{const v=updateProfileSchema.safeParse(payload);if(!v.success)return {status:"invalid_input",fieldErrors:fieldErrors(v.error)};const d=v.data;return mutate("update_filament_spool_profile",{p_spool_id:d.spool_id,p_expected_version:d.expected_version,p_internal_identifier:d.internal_identifier,p_type:d.material_type,p_brand:d.brand,p_color:d.color},"spools.archive",updateResult);}
export async function setSpoolActive(payload:unknown):Promise<MutationResult>{const v=setActiveSchema.safeParse(payload);if(!v.success)return {status:"invalid_input",fieldErrors:fieldErrors(v.error)};return mutate("set_filament_spool_active",{p_spool_id:v.data.spool_id,p_expected_version:v.data.expected_version,p_active:v.data.active},"spools.archive",updateResult);}
export async function updateSpoolThreshold(payload:unknown):Promise<MutationResult>{const v=updateThresholdSchema.safeParse(payload);if(!v.success)return {status:"invalid_input",fieldErrors:fieldErrors(v.error)};return mutate("update_my_spool_threshold",{p_threshold:pt(v.data.threshold),p_expected_version:v.data.expected_version},"enterprise.manage",thresholdResult);}
export async function getSpool(id:string,page=1){
 if(!uuid.safeParse(id).success)return {spool:null,error:"spool_unavailable"};
 try{const context=await requireBusinessContext("spools.read"),s=await createClient();const {data,error}=await s.from("filament_spools").select(spoolColumns).eq("enterprise_id",context.enterpriseId).eq("id",id).maybeSingle();if(error)throw Error();if(!data)return {spool:null,error:"spool_unavailable"};const spool=spoolSchema.parse(data);const offset=(Math.min(5001,Math.max(1,Math.floor(page)))-1)*20;
 const [history,total]=await Promise.all([s.from("filament_spool_movements").select(movementColumns,{count:"exact"}).eq("enterprise_id",context.enterpriseId).eq("spool_id",id).order("created_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+19),s.rpc("get_filament_spool_consumption_summary",{p_spool_id:id})]);
 if(history.error||total.error)throw Error();const consumption=z.array(consumptionSummarySchema).length(1).parse(total.data)[0];return {spool,movements:z.array(movementSchema).max(20).parse(history.data),total:countSchema.parse(history.count),consumption,context,error:null};
 }catch(e){return {spool:null,error:failure(e)};}
}
export async function getSpoolConfig(){try{const context=await requireBusinessContext("spools.read");const {data,error}=await(await createClient()).rpc("get_my_spool_config");if(error)throw Error();return {config:z.array(configSchema).length(1).parse(data)[0],canManage:context.role==="owner",error:null};}catch(e){return {config:null,canManage:false,error:failure(e)};}}
