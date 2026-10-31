import "server-only";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { createLogger } from "@/lib/general-materials/logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";

// PostgreSQL numeric/bigint may arrive as strings, but null, booleans and blanks
// must never be interpreted as zero.
const databaseNumberSchema = z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).pipe(z.number().finite());
const companyVersionSchema = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const companySchema = z.object({
  electricity_rate_per_kwh: databaseNumberSchema.pipe(z.number().min(0).max(100)).nullable(),
  default_filament_loss_percent: databaseNumberSchema.pipe(z.number().min(0).max(100)),
  version: companyVersionSchema,
}).strip();
const enterpriseSchema = z.object({ name: z.string(), created_at: z.string(), version: companyVersionSchema });
const configMutationSchema = z.object({ status: z.enum(['updated', 'no_change', 'version_conflict']), version: companyVersionSchema });
const lossMutationSchema = z.object({ status: z.enum(['updated', 'no_change', 'version_conflict']), version: companyVersionSchema });
const nameMutationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('updated'), name: z.string().min(1).max(200), version: companyVersionSchema }),
  z.object({ status: z.literal('version_conflict'), name: z.string(), version: companyVersionSchema }),
  z.object({ status: z.literal('invalid_input'), name: z.null(), version: z.null() }),
]);

function singleton<T extends z.ZodType>(schema: T) {
  return z.array(schema).length(1).transform(rows => rows[0]);
}

// Only diagnostics, never RPC arguments, returned rows, or submitted values.
async function companyMutationRpc(rpcName: string, args: Record<string, unknown>) {
  const logger = createLogger('enterprise', rpcName);
  try {
    const { data, error } = await (await createClient()).rpc(rpcName, args);
    if (error) {
      logger.error({ stage: 'rpc', rpc_name: rpcName, ...safeErrorDiagnostic(error) });
      return { ok: false as const, status: error.code === '42501' ? 'permission_denied' as const : error.code === '22023' ? 'invalid_input' as const : 'technical' as const };
    }
    return { ok: true as const, data };
  } catch (error) {
    unstable_rethrow(error);
    logger.error({ stage: 'rpc', rpc_name: rpcName, ...safeErrorDiagnostic(error) });
    return { ok: false as const, status: 'technical' as const };
  }
}

function invalidCompanyResponse(rpcName: string, error: unknown = new Error('Invalid company mutation response')): { status: 'technical' | 'unknown' } {
  createLogger('enterprise', rpcName).error({ stage: 'interpretation', rpc_name: rpcName, ...safeErrorDiagnostic(error) });
  return { status: 'technical' as const };
}

function decimalInput(value: FormDataEntryValue | null, precision: number) {
  return z.string().trim().regex(new RegExp(`^\\d+(?:[.,]\\d{1,${precision}})?$`))
    .transform(value => Number(value.replace(',', '.'))).pipe(z.number().finite().min(0).max(100)).safeParse(value);
}
const memberSchema=z.object({membership_id:z.uuid(),full_name:z.string(),email:z.string(),role:z.enum(["owner","admin","operator"]),membership_status:z.enum(["active","inactive"]),membership_created_at:z.string(),must_change_password:z.boolean(),version:z.number().int(),is_self:z.boolean(),is_protected:z.boolean(),name_editable:z.boolean(),total_count:z.coerce.number(),unfiltered_visible_total:z.coerce.number()}).strict();
export type CompanyConfig=z.infer<typeof companySchema>;
export type Company= { name: string, created_at: string, version: number, electricity_rate_per_kwh: number | null, default_filament_loss_percent: number };
export type Member=z.infer<typeof memberSchema>;
export type MutationResult={status:"success"|"conflict"|"protected"|"name_not_editable"|"target_unavailable"|"permission_denied"|"invalid_input"|"unknown"|"technical"|"session_expired";fieldErrors?:Record<string,string[]>};
const idSchema=z.uuid();
const versionSchema=z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const editSchema=z.object({membership_id:idSchema,version:versionSchema,full_name:z.string().trim().min(1).max(200),role:z.enum(["admin","operator"]),expected_full_name:z.string().min(1).max(200)});
const statusSchema=z.object({membership_id:idSchema,version:versionSchema,status:z.enum(["active","inactive"])});
function fail(e:{code?:string}):never{throw new Error(e.code==='42501'?'permission_denied':e.code==='22023'?'invalid_input':'technical');}
export async function getCompany():Promise<Company>{
  const logger = createLogger('enterprise', 'getCompany');
  let rpcName = 'get_my_enterprise_config';
  let stage: 'rpc' | 'interpretation' = 'rpc';
  let failure = 'technical';
  try {
    const client = await createClient();
    const { data: configData, error: configError } = await client.rpc(rpcName);
    if (configError) {
      failure = configError.code === '42501' ? 'permission_denied' : configError.code === '22023' ? 'invalid_input' : 'technical';
      throw configError;
    }
    stage = 'interpretation';
    const config = singleton(companySchema).parse(configData);
    rpcName = 'get_my_enterprise';
    stage = 'rpc';
    const { data: enterpriseData, error: enterpriseError } = await client.rpc(rpcName);
    if (enterpriseError) {
      failure = enterpriseError.code === '42501' ? 'permission_denied' : enterpriseError.code === '22023' ? 'invalid_input' : 'technical';
      throw enterpriseError;
    }
    stage = 'interpretation';
    const enterprise = singleton(enterpriseSchema).parse(enterpriseData);
    // Separate reads are not an atomic snapshot; retain the enterprise version
    // without inventing a cross-RPC equality requirement.
    return { ...enterprise, electricity_rate_per_kwh: config.electricity_rate_per_kwh, default_filament_loss_percent: config.default_filament_loss_percent };
  } catch (error) {
    unstable_rethrow(error);
    logger.error({ stage, rpc_name: rpcName, ...safeErrorDiagnostic(error) });
    throw new Error(failure);
  }
}
export async function listMembers(search:string,status:'active'|'inactive'|'all',page:number){const {data,error}=await(await createClient()).rpc('list_my_enterprise_members',{p_search:search,p_status:status,p_page:page,p_page_size:20});if(error)fail(error);const p=z.array(memberSchema).safeParse(data);if(!p.success)throw new Error('technical');return {members:p.data,total:p.data[0]?.total_count??0,unfiltered_visible_total:p.data[0]?.unfiltered_visible_total??0};}
export async function mutateMember(kind:'edit'|'status',form:FormData):Promise<MutationResult>{
 const raw=Object.fromEntries(form);const parsed=kind==='edit'?editSchema.safeParse(raw):statusSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid_input',fieldErrors:(parsed.error as z.ZodError).flatten().fieldErrors as Record<string,string[]>};
 const input=parsed.data;
 const args=kind==='edit'?{p_membership_id:input.membership_id,p_expected_version:input.version,p_full_name:(input as z.infer<typeof editSchema>).full_name,p_role:(input as z.infer<typeof editSchema>).role,p_expected_full_name:(input as z.infer<typeof editSchema>).expected_full_name}:{p_membership_id:input.membership_id,p_expected_version:input.version,p_status:(input as z.infer<typeof statusSchema>).status};
 let response;
 try{response=await(await createClient()).rpc(kind==='edit'?'update_my_enterprise_member':'set_my_enterprise_member_status',args);}catch{return {status:'unknown'};}
 if(response.error)return {status:response.error.code==='42501'?'permission_denied':response.error.code==='22023'?'invalid_input':'technical'};
 const result=z.object({status:z.enum(['success','conflict','protected','name_not_editable','target_unavailable','permission_denied','invalid_input']),version:z.number().nullable()}).safeParse(response.data?.[0]);
 return result.success?{status:result.data.status}:{status:'unknown'};
}
export async function updateCompanyName(_:unknown,form:FormData){
  const name = z.string().trim().min(1).max(200).safeParse(form.get('name'));
  const version = versionSchema.safeParse(form.get('version'));
  if (!name.success || !version.success) return { status: 'invalid_input' as const };
  const rpcName = 'update_my_enterprise_name';
  const response = await companyMutationRpc(rpcName, { p_name: name.data, p_expected_version: version.data });
  if (!response.ok) return { status: response.status };
  const parsed = singleton(nameMutationSchema).safeParse(response.data);
  if (!parsed.success) return invalidCompanyResponse(rpcName, parsed.error);
  const result = parsed.data;
  if (result.status === 'invalid_input') return { status: 'invalid_input' as const };
  if (result.status === 'version_conflict') return { status: 'conflict' as const };
  if (result.name !== name.data) return invalidCompanyResponse(rpcName);
  return { status: 'success' as const, name: result.name, version: result.version };
}

export async function updateCompanyLoss(_:unknown,form:FormData){
  const loss = decimalInput(form.get('default_filament_loss_percent'), 2);
  const version = versionSchema.safeParse(form.get('version'));
  if (!loss.success || !version.success) return { status: 'invalid_input' as const };
  const rpcName = 'update_my_pricing_loss';
  const response = await companyMutationRpc(rpcName, { p_loss: loss.data, p_expected_version: version.data });
  if (!response.ok) return { status: response.status };
  const parsed = singleton(lossMutationSchema).safeParse(response.data);
  if (!parsed.success) return invalidCompanyResponse(rpcName, parsed.error);
  if (parsed.data.status === 'version_conflict') return { status: 'conflict' as const };
  if (parsed.data.status === 'no_change' && parsed.data.version !== version.data) return invalidCompanyResponse(rpcName);
  return { status: 'success' as const, default_filament_loss_percent: loss.data, version: parsed.data.version };
}

export async function updateCompanyRate(_:unknown,form:FormData){
  const rawRate = form.get('electricity_rate_per_kwh');
  const blank = rawRate === null || (typeof rawRate === 'string' && rawRate.trim() === '');
  const rateParsed = blank ? null : decimalInput(rawRate, 6);
  if (rateParsed !== null && !rateParsed.success) return { status: 'invalid_input' as const };
  const version = versionSchema.safeParse(form.get('version'));
  if (!version.success) return { status: 'invalid_input' as const };
  const rate = rateParsed === null ? null : rateParsed.data;
  const rpcName = 'update_my_enterprise_config';
  const response = await companyMutationRpc(rpcName, { p_rate: rate, p_expected_version: version.data });
  if (!response.ok) return { status: response.status };
  const parsed = singleton(configMutationSchema).safeParse(response.data);
  if (!parsed.success) return invalidCompanyResponse(rpcName, parsed.error);
  if (parsed.data.status === 'version_conflict') return { status: 'conflict' as const };
  if (parsed.data.status === 'no_change' && parsed.data.version !== version.data) return invalidCompanyResponse(rpcName);
  return { status: 'success' as const, electricity_rate_per_kwh: rate, version: parsed.data.version };
}
