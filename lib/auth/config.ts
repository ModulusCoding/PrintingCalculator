import "server-only";

export function isPublicOnboardingEnabled() {
  return process.env.NODE_ENV === "development" && process.env.PUBLIC_ONBOARDING_ENABLED === "true";
}
