import "server-only";

import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { loadTrace } from "@/lib/diagnostics/load-trace";

export const PERMISSIONS = [
  "printers.read",
  "printers.write",
  "printers.archive",
  "pricing.read",
  "pricing.write",
  "spools.read",
  "spools.write",
  "spools.archive",
  "inventory.read",
  "inventory.write",
  "materials.read",
  "materials.write",
  "materials.archive",
  "products.read",
  "products.write",
  "products.delete",
  "catalogs.read",
  "catalogs.write",
  "catalogs.delete",
  "filters.read",
  "filters.write",
  "filters.delete",
  "sales.read",
  "sales.write",
  "sales.delete",
  "enterprise.manage",
  "members.manage_admins",
  "members.manage_operators",
  "stock.materials.read",
  "stock.materials.write",
  "stock.materials.archive",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type EnterpriseRole = "owner" | "admin" | "operator";

const permissionSchema = z.enum(PERMISSIONS);
const roleSchema = z.enum(["owner", "admin", "operator"]);
const uuidSchema = z.uuid();

export const ROLE_PERMISSIONS = {
  owner: PERMISSIONS,
  admin: [
    "printers.read",
    "printers.write",
    "printers.archive",
    "pricing.read",
    "pricing.write",
    "spools.read",
    "spools.write",
    "spools.archive",
    "inventory.read",
    "inventory.write",
    "materials.read",
    "materials.write",
    "materials.archive",
    "stock.materials.read",
    "stock.materials.write",
    "stock.materials.archive",
    "products.read",
    "products.write",
    "products.delete",
    "catalogs.read",
    "catalogs.write",
    "catalogs.delete",
    "filters.read",
    "filters.write",
    "filters.delete",
    "sales.read",
    "sales.write",
    "sales.delete",
    "members.manage_operators",
  ],
  operator: [
    "printers.read",
    "pricing.read",
    "pricing.write",
    "spools.read",
    "spools.write",
    "inventory.read",
    "inventory.write",
    "materials.read",
    "stock.materials.read",
    "stock.materials.write",
    "products.read",
    "products.write",
    "catalogs.read",
    "catalogs.write",
    "filters.read",
    "filters.write",
    "sales.read",
    "sales.write",
  ],
} as const satisfies Record<EnterpriseRole, readonly Permission[]>;

const accessStateSchema = z.enum([
  "unauthenticated",
  "no_active_internal_identity",
  "user_inactive",
  "password_change_required",
  "ambiguous_active_enterprise",
  "business_ready",
  "enterprise_inactive",
  "membership_inactive",
  "no_enterprise_membership",
]);

const rpcRowSchema = z
  .object({
    state: accessStateSchema,
    user_id: uuidSchema.nullable(),
    user_status: z.enum(["active", "inactive"]).nullable(),
    must_change_password: z.boolean().nullable(),
    enterprise_id: uuidSchema.nullable(),
    membership_id: uuidSchema.nullable(),
    role: roleSchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    const hasEnterpriseContext =
      row.enterprise_id !== null ||
      row.membership_id !== null ||
      row.role !== null;

    if (row.state === "business_ready") {
      if (
        row.user_id === null ||
        row.enterprise_id === null ||
        row.membership_id === null ||
        row.role === null ||
        row.user_status !== "active" ||
        row.must_change_password !== false
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid business-ready context.",
        });
      }
      return;
    }

    if (hasEnterpriseContext) {
      context.addIssue({
        code: "custom",
        message: "Blocked states cannot include enterprise context.",
      });
    }

    if (row.state === "unauthenticated") {
      if (
        row.user_id !== null ||
        row.user_status !== null ||
        row.must_change_password !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid unauthenticated context.",
        });
      }
      return;
    }

    if (row.state === "no_active_internal_identity") {
      if (
        row.user_id !== null ||
        row.user_status !== null ||
        row.must_change_password !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid missing-identity context.",
        });
      }
      return;
    }

    if (
      row.user_id === null ||
      row.user_status === null ||
      row.must_change_password === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid blocked user context.",
      });
      return;
    }

    if (row.state === "user_inactive" && row.user_status !== "inactive") {
      context.addIssue({
        code: "custom",
        message: "Invalid inactive-user context.",
      });
    }

    if (
      [
        "enterprise_inactive",
        "membership_inactive",
        "ambiguous_active_enterprise",
        "no_enterprise_membership",
      ].includes(row.state) &&
      (row.user_status !== "active" || row.must_change_password !== false)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid blocked enterprise context.",
      });
    }

    if (
      row.state === "password_change_required" &&
      (row.user_status !== "active" || row.must_change_password !== true)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid password-change context.",
      });
    }
  });

export type BlockedAccessState = Exclude<
  z.infer<typeof accessStateSchema>,
  "unauthenticated" | "business_ready" | "no_active_internal_identity"
>;

export type MinimalIdentityContext =
  | {
      state: "unauthenticated";
      userId: null;
      userStatus: null;
      mustChangePassword: null;
      enterpriseId: null;
      membershipId: null;
      role: null;
    }
  | {
      state: "no_active_internal_identity";
      userId: null;
      userStatus: null;
      mustChangePassword: null;
      enterpriseId: null;
      membershipId: null;
      role: null;
    }
  | {
      state: BlockedAccessState;
      userId: string;
      userStatus: "active" | "inactive";
      mustChangePassword: boolean;
      enterpriseId: null;
      membershipId: null;
      role: null;
    }
  | {
      state: "business_ready";
      userId: string;
      userStatus: "active";
      mustChangePassword: false;
      enterpriseId: string;
      membershipId: string;
      role: EnterpriseRole;
    };

export type BusinessContext = Pick<
  Extract<MinimalIdentityContext, { state: "business_ready" }>,
  "userId" | "enterpriseId" | "membershipId" | "role"
>;

export type AuthContextErrorCode =
  | "AUTH_TECHNICAL_FAILURE"
  | "AUTH_CONTEXT_INVALID_RESPONSE"
  | "AUTH_UNAUTHENTICATED"
  | "AUTH_ACCESS_BLOCKED"
  | "AUTH_PERMISSION_DENIED";

const ERROR_MESSAGES: Record<AuthContextErrorCode, string> = {
  AUTH_TECHNICAL_FAILURE: "Não foi possível validar a autenticação.",
  AUTH_CONTEXT_INVALID_RESPONSE: "O contexto de acesso recebido é inválido.",
  AUTH_UNAUTHENTICATED: "Autenticação necessária.",
  AUTH_ACCESS_BLOCKED: "O estado atual da conta não permite acesso aos módulos.",
  AUTH_PERMISSION_DENIED: "Permissão insuficiente para esta operação.",
};

export class AuthContextError extends Error {
  readonly code: AuthContextErrorCode;
  readonly state?: MinimalIdentityContext["state"];

  constructor(
    code: AuthContextErrorCode,
    options?: { cause?: unknown; state?: MinimalIdentityContext["state"] }
  ) {
    super(ERROR_MESSAGES[code], { cause: options?.cause });
    this.name = "AuthContextError";
    this.code = code;
    this.state = options?.state;
  }
}

function isMissingSessionError(error: { name?: string; code?: string }): boolean {
  return (
    error.name === "AuthSessionMissingError" ||
    error.code === "session_not_found"
  );
}

function unauthenticatedContext(): MinimalIdentityContext {
  return {
    state: "unauthenticated",
    userId: null,
    userStatus: null,
    mustChangePassword: null,
    enterpriseId: null,
    membershipId: null,
    role: null,
  };
}

function toInternalContext(row: z.infer<typeof rpcRowSchema>): MinimalIdentityContext {
  const base = {
    state: row.state,
    userId: row.user_id,
    userStatus: row.user_status,
    mustChangePassword: row.must_change_password,
    enterpriseId: row.enterprise_id,
    membershipId: row.membership_id,
    role: row.role,
  };

  return base as MinimalIdentityContext;
}

export async function resolveMinimalIdentity(): Promise<MinimalIdentityContext> {
  const trace = loadTrace("identity");
  trace.mark("start");
  try {
  const supabase = await createClient();
  trace.mark("session:start");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  trace.mark("session:end");

  if (authError) {
    if (isMissingSessionError(authError)) {
      return unauthenticatedContext();
    }

    throw new AuthContextError("AUTH_TECHNICAL_FAILURE", {
      cause: authError,
    });
  }

  if (!authData.user) {
    return unauthenticatedContext();
  }

  trace.mark("context:start");
  const { data, error } = await supabase.rpc("get_my_access_context");
  trace.mark("context:end");

  if (error) {
    throw new AuthContextError("AUTH_TECHNICAL_FAILURE", { cause: error });
  }

  if (!Array.isArray(data) || data.length !== 1) {
    throw new AuthContextError("AUTH_CONTEXT_INVALID_RESPONSE");
  }

  const parsed = rpcRowSchema.safeParse(data[0]);
  if (!parsed.success) {
    throw new AuthContextError("AUTH_CONTEXT_INVALID_RESPONSE", {
      cause: parsed.error,
    });
  }

  const result = toInternalContext(parsed.data);
  trace.mark(`done:${result.state}`);
  return result;
  } catch (error) {
    trace.mark("error");
    throw error;
  }
}

export async function requireBusinessContext(
  permission: Permission
): Promise<BusinessContext> {
  const context = await resolveMinimalIdentity();

  if (context.state === "unauthenticated") {
    throw new AuthContextError("AUTH_UNAUTHENTICATED", {
      state: context.state,
    });
  }

  if (context.state !== "business_ready") {
    throw new AuthContextError("AUTH_ACCESS_BLOCKED", {
      state: context.state,
    });
  }

  const parsedPermission = permissionSchema.safeParse(permission);
  if (!parsedPermission.success) {
    throw new AuthContextError("AUTH_PERMISSION_DENIED");
  }

  const allowedPermissions: readonly Permission[] = ROLE_PERMISSIONS[context.role];
  if (!allowedPermissions.includes(parsedPermission.data)) {
    throw new AuthContextError("AUTH_PERMISSION_DENIED");
  }

  return {
    userId: context.userId,
    enterpriseId: context.enterpriseId,
    membershipId: context.membershipId,
    role: context.role,
  };
}
