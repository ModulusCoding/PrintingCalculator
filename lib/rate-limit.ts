/**
 * In-memory rate limiter.
 *
 * LIMITATIONS:
 * - This is a per-process in-memory rate limiter (best-effort).
 * - On serverless deployments, each cold start / isolated instance has its own memory.
 * - This means limits are approximate and are NOT a true distributed rate limiter.
 * - For robust production protection, add Cloudflare WAF / Rate Limiting rules as a second layer.
 * - This is intended to mitigate casual abuse, not to guarantee strict global limits.
 */

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

interface RateLimitConfig {
  key: string;
  max: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit({
  key,
  max,
  windowMs,
}: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  // If the bucket doesn't exist yet, create one and allow this request.
  if (!bucket) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }

  // Bucket exists, but is expired -> reset
  if (now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }

  // Bucket exists and is active
  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  // If it hasn't reached max, count this request
  bucket.count += 1;
  return { allowed: true, remaining: max - bucket.count, resetAt: bucket.resetAt };
}

/**
 * Convenience helpers for specific rate-limited actions.
 */
export function rateLimitLogin(ip: string) {
  return rateLimit({ key: `login:${ip}`, max: 8, windowMs: 5 * 60 * 1000 });
}

export function rateLimitCatalogCreate(ip: string, userId?: string) {
  const k = `catalog:create:${userId ?? ""}:${ip}`;
  return rateLimit({ key: k, max: 30, windowMs: 5 * 60 * 1000 });
}

export function rateLimitCatalogUpdate(ip: string, userId?: string) {
  const k = `catalog:update:${userId ?? ""}:${ip}`;
  return rateLimit({ key: k, max: 60, windowMs: 5 * 60 * 1000 });
}

export function rateLimitCatalogDelete(ip: string, userId?: string) {
  const k = `catalog:delete:${userId ?? ""}:${ip}`;
  return rateLimit({ key: k, max: 15, windowMs: 5 * 60 * 1000 });
}

export function rateLimitProductCreate(ip: string, userId?: string) {
  const k = `product:create:${userId ?? ""}:${ip}`;
  return rateLimit({ key: k, max: 60, windowMs: 5 * 60 * 1000 });
}

export function rateLimitProductUpdate(ip: string, userId?: string) {
  const k = `product:update:${userId ?? ""}:${ip}`;
  return rateLimit({ key: k, max: 60, windowMs: 5 * 60 * 1000 });
}

export function rateLimitProductDelete(ip: string, userId?: string) {
  const k = `product:delete:${userId ?? ""}:${ip}`;
  return rateLimit({ key: k, max: 30, windowMs: 5 * 60 * 1000 });
}

export function rateLimitImageUpload(ip: string, userId?: string) {
  const k = `upload:${userId ?? ""}:${ip}`;
  return rateLimit({ key: k, max: 30, windowMs: 5 * 60 * 1000 });
}
