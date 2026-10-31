import "server-only";

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const COOKIE = "recovery_marker";
const TTL = 10 * 60;
const payloadSchema = z.object({ v: z.literal(1), uid: z.string().uuid(), session_id: z.string().uuid(), iat: z.number().int(), exp: z.number().int() });

function secret() {
  const value = process.env.RECOVERY_COOKIE_SECRET;
  if (!value) throw new Error("RECOVERY_COOKIE_SECRET is required");
  return value;
}
function sign(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
function encode(payload: z.infer<typeof payloadSchema>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}
export async function issueRecoveryMarker(uid: string, sessionId: string) {
  const now = Math.floor(Date.now() / 1000);
  (await cookies()).set(COOKIE, encode({ v: 1, uid, session_id: sessionId, iat: now, exp: now + TTL }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: TTL });
}
export async function requireRecoveryMarker(
  uid: string,
  sessionId: string
): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || raw.length > 2048) return false;

  const parts = raw.split(".");
  if (parts.length !== 2) return false;

  const [body, mac] = parts;

  if (
    !body ||
    !/^[A-Za-z0-9_-]+$/.test(body) ||
    !/^[A-Za-z0-9_-]{43}$/.test(mac)
  ) {
    return false;
  }

  const expected = sign(body);
  const receivedBytes = Buffer.from(mac, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    return false;
  }

  try {
    const payload = payloadSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    );

    const now = Math.floor(Date.now() / 1000);

    return (
      payload.uid === uid &&
      payload.session_id === sessionId &&
      payload.iat <= now &&
      payload.exp > now &&
      payload.exp > payload.iat &&
      payload.exp - payload.iat <= TTL
    );
  } catch {
    return false;
  }
}
export async function clearRecoveryMarker() { (await cookies()).delete(COOKIE); }
export const recoveryMarkerTtlSeconds = TTL;
