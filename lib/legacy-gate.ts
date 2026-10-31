import "server-only";
import { headers } from "next/headers";

export async function isLegacyEnabled(): Promise<boolean> {
  // Keep the gate request-time so a cached public catalog never bypasses it.
  await headers();
  return process.env.MODULUS_LEGACY_FEATURES_ENABLED === "true";
}
