# Mandatory Password Change

This project enforces a mandatory password change for users flagged by the `required_password_change` system.

## Workflow

1.  **Detection**: `resolveMinimalIdentity` flags sessions requiring password change.
2.  **Redirection**: Access to protected routes redirects unauthenticated or mandatory-change users.
3.  **Verification**: The `RequiredPasswordForm` performs a secure `signInWithPassword` check against the *old* password before triggering the update.
4.  **Update**: Uses `auth.updateUser` with `current_password` parameter.
5.  **Release**: A robust RPC `release_required_password_change` confirms the obligation is marked as completed.

## Technical Details

- **Security**: The current password verification does not affect the main session cookie (disposable client).
- **Concurrency**: Versioning prevents race conditions during the obligation release phase.
- **Validation**: Strict issuer matching ensures the system is not susceptible to arbitrary environment mismatches.
