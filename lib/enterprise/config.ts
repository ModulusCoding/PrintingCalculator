"use server";

import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const rateSchema = z.preprocess((val) => {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    return Number(trimmed.replace(',', '.'));
  }
  return val;
}, z.number().finite().min(0).max(100).nullable());

const configSchema = z.object({
  electricity_rate_per_kwh: z.number().nullable(),
  version: z.number().int()
}).strict();

export type Config = z.infer<typeof configSchema>;

function fail(e: { code?: string }): never {
  const code = e.code;
  throw new Error(code === '42501' ? 'permission_denied' : code === '22023' ? 'invalid_input' : 'technical');
}

export async function getConfig(): Promise<Config> {
  const { data, error } = await (await createClient()).rpc('get_my_enterprise_config');
  if (error) fail(error);
  const p = configSchema.safeParse(data?.[0]);
  if (!p.success) throw new Error('technical');
  return p.data;
}

export async function updateConfig(_: unknown, form: FormData) {
  const rawRate = form.get('electricity_rate_per_kwh');
  const rateResult = rateSchema.safeParse(rawRate);
  const version = z.coerce.number().int().safeParse(form.get('version'));

  if (!version.success || !rateResult.success) {
    return { status: 'invalid_input' as const };
  }

  const rate = rateResult.data;
  
  // Extra client-side scale validation to avoid DB roundtrip for simple cases
  if (rate !== null) {
    const s = rate.toString();
    const dec = s.split('.')[1];
    if (dec && dec.length > 6) return { status: 'invalid_input' as const };
  }

  const { data, error } = await (await createClient()).rpc('update_my_enterprise_config', {
    p_rate: rate,
    p_expected_version: version.data
  });

  if (error) {
    if (error.code === '22023') return { status: 'invalid_input' as const };
    return { status: error.code === '42501' ? 'permission_denied' : 'technical' } as const;
  }

  const r = data?.[0];
  if (r?.status === 'updated') {
    return { status: 'success' as const, electricity_rate_per_kwh: rate, version: r.version };
  } else if (r?.status === 'version_conflict') {
    return { status: 'conflict' as const };
  }
  return { status: 'unknown' as const };
}