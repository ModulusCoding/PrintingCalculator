# Onboarding error contracts

Public onboarding actions return `OnboardingResult`, a discriminated, secret-free contract: `idle`, `error`, `outcome_unknown`, `confirmation_pending`, or `success`. Validation field keys are stable: `name`, `enterpriseName`, `email`, `password`, and `confirmation`.

Signup never exposes whether an address exists or whether mail was delivered. Accepted, existing, and non-enumerating Auth outcomes return `confirmation_pending`. Transport failures return `outcome_unknown`; configured provider failures return a safe processing error. Metadata is only a signup convenience and must be revalidated during completion.

Confirmation and recovery links redirect only to `/auth/invalid-link?reason=signup` or `?reason=recovery`; the page allowlists those values and never renders arbitrary query text. Invalid, expired, consumed, malformed, and technical verification failures share that screen.

Completion maps the onboarding RPC SQL codes `P0001`, `P0002`, `P0003`, `P0004`, `23505`, `22023`, and `28000` to controlled messages. It checks session, confirmed email, and issuer configuration before invoking the RPC. A pre-existing linked context is a successful idempotent result (`createdNew: false`).

Manual checks: submit empty and over-200-character names, invalid email, short/mismatched passwords; submit the same email repeatedly; open malformed and consumed signup/recovery links; and retry completion after a successful completion.
