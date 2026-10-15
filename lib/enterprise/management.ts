import "server-only";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const companySchema=z.object({name:z.string(),created_at:z.string(),version:z.number().int()}).strict();
const memberSchema=z.object({membership_id:z.uuid(),full_name:z.string(),email:z.string(),role:z.enum(["owner","admin","operator"]),membership_status:z.enum(["active","inactive"]),membership_created_at:z.string(),must_change_password:z.boolean(),version:z.number().int(),is_self:z.boolean(),is_protected:z.boolean(),name_editable:z.boolean(),total_count:z.coerce.number(),unfiltered_visible_total:z.coerce.number()}).strict();
export type Company=z.infer<typeof companySchema>;
export type Member=z.infer<typeof memberSchema>;
export type MutationResult={status:"success"|"conflict"|"protected"|"name_not_editable"|"target_unavailable"|"permission_denied"|"invalid_input"|"unknown"|"technical"|"session_expired";fieldErrors?:Record<string,string[]>};
const idSchema=z.uuid();
const versionSchema=z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const editSchema=z.object({membership_id:idSchema,version:versionSchema,full_name:z.string().trim().min(1).max(200),role:z.enum(["admin","operator"]),expected_full_name:z.string().min(1).max(200)});
const statusSchema=z.object({membership_id:idSchema,version:versionSchema,status:z.enum(["active","inactive"])});
function fail(e:{code?:string}):never{throw new Error(e.code==='42501'?'permission_denied':'technical');}
export async function getCompany():Promise<Company>{const {data,error}=await(await createClient()).rpc('get_my_enterprise');if(error)fail(error);const p=companySchema.safeParse(data?.[0]);if(!p.success)throw new Error('technical');return p.data;}
export async function listMembers(search:string,status:'active'|'inactive'|'all',page:number){const {data,error}=await(await createClient()).rpc('list_my_enterprise_members',{p_search:search,p_status:status,p_page:page,p_page_size:20});if(error)fail(error);const p=z.array(memberSchema).safeParse(data);if(!p.success)throw new Error('technical');return {members:p.data,total:p.data[0]?.total_count??0,unfiltered_visible_total:p.data[0]?.unfiltered_visible_total??0};}
export async function mutateMember(kind:'edit'|'status',form:FormData):Promise<MutationResult>{
 const raw=Object.fromEntries(form);const parsed=kind==='edit'?editSchema.safeParse(raw):statusSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid_input',fieldErrors:(parsed.error as z.ZodError).flatten().fieldErrors as Record<string,string[]>};
 const input=parsed.data;
 const args=kind==='edit'?{p_membership_id:input.membership_id,p_expected_version:input.version,p_full_name:(input as z.infer<typeof editSchema>).full_name,p_role:(input as z.infer<typeof editSchema>).role,p_expected_full_name:(input as z.infer<typeof editSchema>).expected_full_name}:{p_membership_id:input.membership_id,p_expected_version:input.version,p_status:(input as z.infer<typeof statusSchema>).status};
 let response;
 try{response=await(await createClient()).rpc(kind==='edit'?'update_my_enterprise_member':'set_my_enterprise_member_status',args);}catch{return {status:'unknown'};}
 if(response.error)return {status:response.error.code==='42501'?'permission_denied':'technical'};
 const result=z.object({status:z.enum(['success','conflict','protected','name_not_editable','target_unavailable','permission_denied','invalid_input']),version:z.number().nullable()}).safeParse(response.data?.[0]);
 return result.success?{status:result.data.status}:{status:'unknown'};
}
export async function updateCompanyName(_:unknown,form:FormData){const name=String(form.get('name')??'').trim(),parsedVersion=versionSchema.safeParse(form.get('version'));if(!name||name.length>200||!parsedVersion.success)return {status:'invalid_input' as const};const version=parsedVersion.data;const {data,error}=await(await createClient()).rpc('update_my_enterprise_name',{p_name:name,p_expected_version:version});if(error)return {status:error.code==='42501'?'permission_denied':'technical'} as const;const r=data?.[0];return r?.status==='updated'?{status:'success' as const,name:r.name,version:r.version}:r?.status==='version_conflict'?{status:'conflict' as const}:{status:'unknown' as const};}
