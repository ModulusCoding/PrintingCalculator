-- Modulus SaaS/CRM: núcleo de usuários, identidades, empresas e membros.
-- Não depende das tabelas ou funções das migrations anteriores.
-- Não cria policies, usuários Auth, dados iniciais ou permissões de negócio.

BEGIN;

CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_normalized TEXT
        GENERATED ALWAYS AS (lower(btrim(email))) STORED NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    password_change_version BIGINT NOT NULL DEFAULT 0,
    password_changed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_full_name_not_blank
        CHECK (btrim(full_name) <> ''),

    CONSTRAINT users_email_not_blank
        CHECK (btrim(email) <> ''),

    CONSTRAINT users_email_normalized_not_blank
        CHECK (email_normalized <> ''),

    CONSTRAINT users_email_normalized_unique
        UNIQUE (email_normalized),

    CONSTRAINT users_status_check
        CHECK (status IN ('active', 'inactive')),

    CONSTRAINT users_password_change_version_check
        CHECK (password_change_version >= 0)
);

CREATE TABLE public.auth_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    provider TEXT NOT NULL,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT auth_identities_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE RESTRICT,

    CONSTRAINT auth_identities_provider_not_blank
        CHECK (btrim(provider) <> ''),

    CONSTRAINT auth_identities_issuer_not_blank
        CHECK (btrim(issuer) <> ''),

    CONSTRAINT auth_identities_subject_not_blank
        CHECK (btrim(subject) <> ''),

    CONSTRAINT auth_identities_status_check
        CHECK (status IN ('active', 'inactive')),

    CONSTRAINT auth_identities_issuer_subject_unique
        UNIQUE (issuer, subject),

    CONSTRAINT auth_identities_user_issuer_unique
        UNIQUE (user_id, issuer)
);

CREATE TABLE public.enterprises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT enterprises_name_not_blank
        CHECK (btrim(name) <> ''),

    CONSTRAINT enterprises_status_check
        CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE public.enterprise_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT enterprise_members_enterprise_id_fkey
        FOREIGN KEY (enterprise_id)
        REFERENCES public.enterprises(id)
        ON DELETE RESTRICT,

    CONSTRAINT enterprise_members_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE RESTRICT,

    CONSTRAINT enterprise_members_role_check
        CHECK (role IN ('owner', 'admin', 'operator')),

    CONSTRAINT enterprise_members_status_check
        CHECK (status IN ('active', 'inactive')),

    CONSTRAINT enterprise_members_enterprise_user_unique
        UNIQUE (enterprise_id, user_id)
);

-- O UNIQUE (user_id, issuer) já atende buscas por user_id
-- em auth_identities.
-- Em enterprise_members, o UNIQUE começa por enterprise_id;
-- este índice atende buscas dos vínculos de um usuário.
CREATE INDEX enterprise_members_user_id_idx
    ON public.enterprise_members (user_id);

-- Função específica deste núcleo, sem substituir a função legada.
CREATE FUNCTION public.modulus_auth_tenancy_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.modulus_auth_tenancy_set_updated_at();

CREATE TRIGGER auth_identities_set_updated_at
BEFORE UPDATE ON public.auth_identities
FOR EACH ROW
EXECUTE FUNCTION public.modulus_auth_tenancy_set_updated_at();

CREATE TRIGGER enterprises_set_updated_at
BEFORE UPDATE ON public.enterprises
FOR EACH ROW
EXECUTE FUNCTION public.modulus_auth_tenancy_set_updated_at();

CREATE TRIGGER enterprise_members_set_updated_at
BEFORE UPDATE ON public.enterprise_members
FOR EACH ROW
EXECUTE FUNCTION public.modulus_auth_tenancy_set_updated_at();

-- Estado inicial fechado: RLS habilitada, sem policies.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
    ON TABLE
        public.users,
        public.auth_identities,
        public.enterprises,
        public.enterprise_members
    FROM PUBLIC, anon, authenticated;

-- A função serve somente aos triggers, não como operação de cliente.
REVOKE ALL PRIVILEGES
    ON FUNCTION public.modulus_auth_tenancy_set_updated_at()
    FROM PUBLIC, anon, authenticated;

COMMIT;