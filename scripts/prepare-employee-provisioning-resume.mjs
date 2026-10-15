#!/usr/bin/env node

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { Writable } from "node:stream";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), true);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

function validStartResponse(value) {
  if (!Array.isArray(value) || value.length !== 1) return false;

  const row = value[0];
  if (!row || typeof row !== "object") return false;

  return (
    isUuid(row.operation_id) &&
    isUuid(row.enterprise_id) &&
    typeof row.email_normalized === "string" &&
    ["admin", "operator"].includes(row.requested_role) &&
    ["pending", "completed", "failed"].includes(row.status)
  );
}

function fail(message) {
  console.error(`\nErro: ${message}`);
  process.exitCode = 1;
}

function ask(question, { secret = false } = {}) {
  return new Promise((resolve) => {
    const output = secret
      ? new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        })
      : process.stdout;

    const rl = readline.createInterface({
      input: process.stdin,
      output,
      terminal: true,
      historySize: 0,
    });

       if (secret) {
      process.stdout.write(question);
    }

    rl.question(secret ? "" : question, (answer) => {
      rl.close();

      if (secret) {
        output.end();
        process.stdout.write("\n");
      }

      resolve(answer);
    });

    rl.on("SIGINT", () => {
      rl.close();
      process.stdout.write("\n");
      process.exit(130);
    });
  });
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function validEmail(value) {
  return (
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function generatedTestEmail(requestedEmail) {
  const normalized = normalizeEmail(requestedEmail);

  if (!validEmail(normalized)) return null;

  const at = normalized.lastIndexOf("@");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  const localPart = `${normalized.slice(0, at)}+resume-${suffix}`;
  const generated = `${localPart}${normalized.slice(at)}`;

  if (localPart.length > 64 || !validEmail(generated)) return null;

  return generated;
}

function localResumeUrl(operationId) {
  const fallback = new URL(
    "/empresa/equipe/novo",
    "http://localhost:3000"
  );
  fallback.searchParams.set("operationId", operationId);

  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (!configured) return fallback.toString();

  try {
    const url = new URL(configured);

    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      return fallback.toString();
    }

    url.pathname = "/empresa/equipe/novo";
    url.search = new URLSearchParams({ operationId }).toString();
    url.hash = "";

    return url.toString();
  } catch {
    return fallback.toString();
  }
}

async function main() {
  if (process.env.NODE_ENV !== "development") {
    fail("Este script só pode ser executado com NODE_ENV=development.");
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail("Execute em um terminal interativo para digitar as senhas com segurança.");
    return;
  }

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const issuer = process.env.SUPABASE_AUTH_ISSUER;

  if (!projectUrl || !anonKey || !serviceKey || !issuer) {
    fail(
      "Faltam variáveis necessárias: NEXT_PUBLIC_SUPABASE_URL, " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY " +
        "ou SUPABASE_AUTH_ISSUER."
    );
    return;
  }

  if (issuer !== `${projectUrl.replace(/\/$/, "")}/auth/v1`) {
    fail(
      "SUPABASE_AUTH_ISSUER não corresponde ao projeto configurado."
    );
    return;
  }

  const actorEmail = normalizeEmail(
    await ask("E-mail do owner/admin: ")
  );
  const actorPassword = await ask("Senha do owner/admin: ", {
    secret: true,
  });

  const fullName = (
    await ask("Nome completo do funcionário de teste: ")
  ).trim();

  const requestedEmail = await ask(
    "E-mail-base do funcionário de teste: "
  );
  const employeeEmail = generatedTestEmail(requestedEmail);

  const temporaryPassword = await ask("Senha temporária: ", {
    secret: true,
  });
  const confirmation = await ask(
    "Confirmação da senha temporária: ",
    { secret: true }
  );

  if (
    !validEmail(actorEmail) ||
    !actorPassword ||
    !fullName ||
    fullName.length > 200 ||
    !employeeEmail ||
    temporaryPassword.length < 8 ||
    temporaryPassword !== confirmation
  ) {
    fail(
      "Confira os e-mails, o nome (máximo de 200 caracteres) " +
        "e as senhas. A senha temporária deve ter pelo menos " +
        "8 caracteres e coincidir com a confirmação."
    );
    return;
  }

  const clientOptions = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };

  const actorClient = createClient(
    projectUrl,
    anonKey,
    clientOptions
  );
  const adminClient = createClient(
    projectUrl,
    serviceKey,
    clientOptions
  );

  let actorSignedIn = false;
  let operationId = null;
  let stage = "authentication";

  try {
    const signedIn = await actorClient.auth.signInWithPassword({
      email: actorEmail,
      password: actorPassword,
    });

    actorSignedIn = Boolean(signedIn.data?.session);

    if (signedIn.error || !signedIn.data.user) {
      fail("Não foi possível autenticar o ator.");
      return;
    }

    const verified = await actorClient.auth.getUser();

    if (
      verified.error ||
      !verified.data.user ||
      verified.data.user.id !== signedIn.data.user.id
    ) {
      fail("Não foi possível confirmar a identidade do ator.");
      return;
    }

    stage = "start";

    const started = await adminClient.rpc(
      "start_employee_provisioning",
      {
        p_actor_auth_user_id: verified.data.user.id,
        p_actor_issuer: issuer,
        p_email: employeeEmail,
        p_full_name: fullName,
        p_role: "operator",
      }
    );

    if (started.error || !validStartResponse(started.data)) {
      fail(
        "O início da operação não foi confirmado. " +
          "O script não chamou a criação de conta Auth. " +
          "Uma operação privada pode ter sido criada."
      );
      return;
    }

    const operation = started.data[0];
    operationId = operation.operation_id;

    if (
      operation.email_normalized !== employeeEmail ||
      operation.requested_role !== "operator" ||
      operation.status !== "pending"
    ) {
      fail(
        "A operação retornada não é pending compatível. " +
          "Nenhuma criação de conta Auth foi iniciada."
      );
      return;
    }

    // O e-mail aleatório reduz o risco de reutilização.
    // O contrato da RPC não comprova que pending foi recém-criado.
    stage = "auth_creation";

    const created = await adminClient.auth.admin.createUser({
      email: employeeEmail,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: {
        modulus_employee_provisioning_operation_id: operationId,
      },
    });

    if (
      created.error ||
      !created.data.user ||
      !isUuid(created.data.user.id) ||
      normalizeEmail(created.data.user.email ?? "") !== employeeEmail ||
      created.data.user.app_metadata
        ?.modulus_employee_provisioning_operation_id !== operationId
    ) {
      fail(
        "A criação Auth não foi confirmada com os dados esperados. " +
          "Não execute o script novamente para esta tentativa. " +
          "Verifique a operação pela URL abaixo."
      );
      return;
    }

    stage = "prepared";

    console.log(
      "\nCenário de retomada preparado. A finalização não foi chamada."
    );
  } catch {
    if (stage === "authentication") {
      fail("Não foi possível concluir a autenticação do ator.");
    } else {
      fail(
        "O resultado da preparação não pôde ser confirmado. " +
          "Não repita o script para esta tentativa. " +
          "Nenhuma exclusão ou repetição automática foi realizada."
      );
    }
  } finally {
    if (operationId) {
      console.log(`operation_id: ${operationId}`);
      console.log(
        `Abra como o mesmo ator: ${localResumeUrl(operationId)}`
      );
    }

    if (actorSignedIn) {
      try {
        const { error } = await actorClient.auth.signOut({
          scope: "local",
        });

        if (error) {
          console.warn(
            "Não foi possível confirmar o encerramento da sessão temporária do script."
          );
        }
      } catch {
        console.warn(
          "Não foi possível confirmar o encerramento da sessão temporária do script."
        );
      }
    }
  }
}

await main();