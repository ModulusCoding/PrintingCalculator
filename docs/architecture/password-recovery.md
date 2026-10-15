# Password Recovery Architecture and Local Setup

This document outlines the password recovery flow and setup instructions for local development.

## Architecture

The password recovery flow uses Supabase Auth's official secure recovery mechanism:

1.  **Request (`requestPasswordResetAction`)**: Validates the email address with Zod, applies IP-based rate limiting, and calls Supabase Auth's `resetPasswordForEmail` with a dedicated redirect URL (`/auth/recovery`). It returns a generic message to prevent account enumeration.
2.  **Confirmation (`/auth/recovery/route.ts`)**: Validates the `token_hash` and `type=recovery` parameters strictly (rejecting signup tokens, extra parameters, or invalid hashes), calls `verifyOtp`, and redirects the user to the reset page.
3. **Recovery marker**: Only after `verifyOtp` and a successful `getUser()`, the server issues a 10-minute HMAC-signed HttpOnly cookie containing the verified user ID, validated Supabase `session_id`, and timestamps. No access or refresh tokens are stored. The marker is bound to that same verified session and is cleared by subsequent recovery callbacks/logout.
4. **Update (`updatePasswordAction`)**: Validates the new password and confirmation matching (minimum 8 characters, no trimming), checks `getUser()` and verified `getClaims()` session ID against the signed marker, then updates with `updateUser()` and signs out locally. Missing, expired, invalid, or mismatched markers are rejected.

The signed cookie is replayable for its short lifetime while the corresponding Supabase session remains active; it is not a one-use token. Configure the private `RECOVERY_COOKIE_SECRET` with a long random secret. Recovery fails closed if it is unset. The `.env.example` value is only a placeholder.

## Local Setup

### Configuration Variables
Ensure your environment has:
```env
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
RECOVERY_COOKIE_SECRET=replace-with-a-long-random-secret
```

### Supabase Dashboard Configuration
1.  **Redirect URLs**: Add `http://localhost:3000/auth/recovery` to your Supabase project's allowed Redirect URLs.
2.  **Email Templates**: Configure your **Reset Password** template in Supabase Auth to point to:
    ```text
    {{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&type=recovery
    ```

### SMTP Limitations
*   The project uses Supabase Auth's built-in SMTP or Resend in development.
*   The sender address `onboarding@resend.dev` restricts testing to the verified account owner's email. Comprehensive inbox testing for arbitrary external recipients remains pending domain verification.

## Testing Procedure (Manual)
1.  **Existing Account**: Go to `/admin/login`, click "Esqueci minha senha", enter a registered email, and verify that the generic confirmation message appears.
2.  **Non-existent Account**: Enter an unregistered email; verify that the identical generic confirmation message appears (preventing account enumeration).
3.  **Invalid Link**: Access `/auth/recovery?token_hash=invalid&type=recovery` and verify redirection to `/auth/invalid-link`.
4.  **Password Mismatch**: On `/redefinir-senha`, enter mismatched passwords and check the error message.
5.  **Successful Recovery**: Follow a valid recovery link, submit a valid 8+ character password, and verify success and session termination.
