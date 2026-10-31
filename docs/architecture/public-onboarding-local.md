# Public Onboarding Architecture and Local Setup

This document outlines the public onboarding architecture and provides setup instructions for local development.

## Architecture

The onboarding flow uses a secure transactional and idempotent approach to register new users and their enterprises:

1.  **Signup (`signUpPublicAction`)**: Validates user and enterprise names, applies rate limiting, and registers the user in Supabase Auth with metadata (`user_name`, `enterprise_name`).
2.  **Confirmation**: A standard Supabase email confirmation link is used.
3.  **Completion (`completePublicOnboardingAction`)**: Called after email confirmation. It validates the user's identity, confirms their email status, and calls a `SECURITY DEFINER` Postgres function (`complete_public_onboarding`) to create the user, enterprise, and membership in one atomic transaction.

## Local Setup

### Configuration Variables
Ensure your `.env` (derived from `.env.example`) has these variables set correctly:

```env
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PUBLIC_ONBOARDING_ENABLED=true
SUPABASE_AUTH_ISSUER=https://your-project.supabase.co/auth/v1
```

### SMTP and Email Testing
*   The system currently relies on Supabase Auth's email provider. In local development, you may need to configure a local SMTP server or use Supabase's built-in testing capabilities.
*   **Do not use test emails for production.**

### Manual Onboarding Confirmation
You can simulate the signup confirmation link manually if needed:

`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`

*   `SiteURL`: `http://localhost:3000`
*   `TokenHash`: Available from the Supabase dashboard or logs.
*   `type`: `signup`

### Idempotency and Resumption
*   The `complete_public_onboarding` SQL function is designed to be idempotent. If a user tries to complete the onboarding multiple times, the function checks the state in `private.public_onboarding_completions` and will either return existing IDs or handle the state accordingly.
