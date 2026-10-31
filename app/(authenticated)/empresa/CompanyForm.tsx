"use client";

import Image from "next/image";
import { useActionState, useRef, useState, type FormEvent } from "react";
import { updateCompanyName, updateCompanyRateAction, updateCompanyLossAction } from "@/lib/enterprise/actions";
import type { Company } from "@/lib/enterprise/management";
import styles from "./CompanyProfile.module.css";

type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "permission_denied" | "technical" | "conflict" | "unknown" | "invalid_input" | "session_expired"; message: string };

const initialState: ActionState = { status: "idle" };
const decimal = (value: number) => value.toString().replace(".", ",");

function Feedback({ state, id }: { state: ActionState; id: string }) {
  if (state.status === "idle") return null;
  const success = state.status === "success";
  return <p id={id} role={success ? "status" : "alert"} className={success ? styles.success : styles.error}>{state.message}</p>;
}

function failure(status: Exclude<ActionState["status"], "idle" | "success">, invalidMessage: string): ActionState {
  const messages = {
    permission_denied: "Você não tem permissão para fazer esta alteração.",
    technical: "Não foi possível salvar agora. Tente novamente em instantes.",
    conflict: "Os dados foram alterados por outra pessoa ou processo. Atualize a página antes de continuar.",
    unknown: "Não foi possível confirmar a atualização. Verifique os dados antes de tentar novamente.",
    invalid_input: invalidMessage,
    session_expired: "Sua sessão expirou. Faça login novamente para continuar.",
  };
  return { status, message: messages[status] };
}

export function CompanyForm({ company, canManageEnterprise = true }: { company: Company; canManageEnterprise?: boolean }) {
  const [currentVersion, setCurrentVersion] = useState(company.version);
  const [currentName, setCurrentName] = useState(company.name);
  const [currentRate, setCurrentRate] = useState(company.electricity_rate_per_kwh);
  const [currentLoss, setCurrentLoss] = useState(company.default_filament_loss_percent);
  const [nameDraft, setNameDraft] = useState(company.name);
  const [rateDraft, setRateDraft] = useState(company.electricity_rate_per_kwh === null ? "" : decimal(company.electricity_rate_per_kwh));
  const [lossDraft, setLossDraft] = useState(decimal(company.default_filament_loss_percent));
  const saving = useRef(false);

  const [nameState, nameAction, namePending] = useActionState<ActionState, FormData>(async (_, form) => {
    try {
      const res = await updateCompanyName(null, form);
      if (res.status !== "success") return failure(res.status, "Informe um nome entre 1 e 200 caracteres.");
      if (res.version !== undefined) setCurrentVersion(res.version);
      if (res.name !== undefined) setCurrentName(res.name);
      return { status: "success", message: "Nome salvo com sucesso." };
    } catch {
      return failure("unknown", "");
    } finally { saving.current = false; }
  }, initialState);

  const [rateState, rateAction, ratePending] = useActionState<ActionState, FormData>(async (_, form) => {
    try {
      const res = await updateCompanyRateAction(null, form);
      if (res.status !== "success") return failure(res.status, "Informe uma tarifa entre 0 e 100, com até 6 casas decimais, ou deixe em branco.");
      if (res.version !== undefined) setCurrentVersion(res.version);
      if (res.electricity_rate_per_kwh !== undefined) setCurrentRate(res.electricity_rate_per_kwh);
      return { status: "success", message: "Tarifa salva com sucesso." };
    } catch {
      return failure("unknown", "");
    } finally { saving.current = false; }
  }, initialState);

  const [lossState, lossAction, lossPending] = useActionState<ActionState, FormData>(async (_, form) => {
    try {
      const res = await updateCompanyLossAction(null, form);
      if (res.status !== "success") return failure(res.status, "Informe um percentual entre 0 e 100, com até 2 casas decimais.");
      if (res.version !== undefined) setCurrentVersion(res.version);
      if (res.default_filament_loss_percent !== undefined) setCurrentLoss(res.default_filament_loss_percent);
      return { status: "success", message: "Perda padrão salva com sucesso." };
    } catch {
      return failure("unknown", "");
    } finally { saving.current = false; }
  }, initialState);

  const pending = namePending || ratePending || lossPending;
  function guardSubmit(event: FormEvent<HTMLFormElement>) {
    if (saving.current || pending) { event.preventDefault(); return; }
    saving.current = true;
  }
  const initials = currentName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("pt-BR");
  const created = canManageEnterprise && company.created_at ? new Date(company.created_at) : null;
  const createdLabel = created && Number.isFinite(created.getTime())
    ? created.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }) : null;
  const description = (field: string, state: ActionState) => `${field}-hint${state.status !== "idle" ? ` ${field}-feedback` : ""}`;

  return (
    <div className={styles.profile}>
      <header className={styles.hero}>
        <div className={styles.heroTop}>
          <span className={styles.eyebrow}>SEU ESPAÇO DE GESTÃO</span>
          <Image src="/logo_Horizontal.svg" alt="Modulus" width={184} height={38} className={styles.logo} />
        </div>
        <div className={styles.identity}>
          <div className={styles.avatar} aria-hidden="true">{canManageEnterprise ? initials || "E" : "CE"}</div>
          <div className={styles.heroText}>
            <p className={styles.kicker}>{canManageEnterprise ? "Perfil empresarial" : "Parâmetros de produção"}</p>
            <h1>{canManageEnterprise ? "Dados da empresa" : "Configurações da empresa"}</h1>
            {canManageEnterprise && <p className={styles.companyName}>{currentName}</p>}
            <p className={styles.heroDescription}>Uma base bem configurada para decisões mais precisas.</p>
            {createdLabel && <p className={styles.created}>Empresa cadastrada em {createdLabel}</p>}
          </div>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.main}>
          {canManageEnterprise && <section className={styles.card} aria-labelledby="information-title">
            <div className={styles.sectionHeading}><span className={styles.sectionNumber} aria-hidden="true">01</span><div><h2 id="information-title">Informações da empresa</h2><p>A identidade do seu negócio no Modulus.</p></div></div>
            <form action={nameAction} onSubmit={guardSubmit} aria-busy={namePending}>
              <input type="hidden" name="version" value={currentVersion} />
              <fieldset disabled={pending} className={styles.fieldset}>
                <label htmlFor="company-name">Nome da empresa <span className={styles.required}>Obrigatório</span></label>
                <input id="company-name" name="name" type="text" required maxLength={200} value={nameDraft} onChange={event => setNameDraft(event.target.value)} aria-describedby={description("name", nameState)} aria-invalid={nameState.status === "invalid_input"} />
                <p id="name-hint" className={styles.hint}>Use o nome pelo qual sua empresa é conhecida.</p>
                <Feedback state={nameState} id="name-feedback" />
                <div className={styles.formFooter}><span>Salve apenas esta informação.</span><button type="submit">{namePending ? "Salvando…" : "Salvar nome"}</button></div>
              </fieldset>
            </form>
          </section>}

          <section className={styles.card} aria-labelledby="parameters-title">
            <div className={styles.sectionHeading}><span className={styles.sectionNumber} aria-hidden="true">{canManageEnterprise ? "02" : "01"}</span><div><h2 id="parameters-title">Parâmetros do negócio</h2><p>Valores de referência para sua precificação.</p></div></div>
            {canManageEnterprise && <form action={rateAction} onSubmit={guardSubmit} aria-busy={ratePending}>
              <input type="hidden" name="version" value={currentVersion} />
              <fieldset disabled={pending} className={styles.fieldset}>
                <label htmlFor="electricity-rate">Tarifa de energia <span className={styles.unit}>R$/kWh</span></label>
                <input id="electricity-rate" name="electricity_rate_per_kwh" type="text" inputMode="decimal" value={rateDraft} onChange={event => setRateDraft(event.target.value)} placeholder="Ex.: 0,854321" aria-describedby={description("rate", rateState)} aria-invalid={rateState.status === "invalid_input"} />
                <p id="rate-hint" className={styles.hint}>Opcional. De 0 a 100, com até 6 casas decimais. Deixe em branco para remover a tarifa.</p>
                <Feedback state={rateState} id="rate-feedback" />
                <div className={styles.formFooter}><span>Atualiza somente a tarifa.</span><button type="submit">{ratePending ? "Salvando…" : "Salvar tarifa"}</button></div>
              </fieldset>
            </form>}
            <form action={lossAction} onSubmit={guardSubmit} aria-busy={lossPending} className={canManageEnterprise ? styles.dividedForm : undefined}>
              <input type="hidden" name="version" value={currentVersion} />
              <fieldset disabled={pending} className={styles.fieldset}>
                <label htmlFor="default-loss">Perda padrão de filamento <span className={styles.unit}>%</span></label>
                <input id="default-loss" name="default_filament_loss_percent" type="text" inputMode="decimal" required value={lossDraft} onChange={event => setLossDraft(event.target.value)} aria-describedby={description("loss", lossState)} aria-invalid={lossState.status === "invalid_input"} />
                <p id="loss-hint" className={styles.hint}>Valor inicial da perda na precificadora. De 0 a 100%, com até 2 casas decimais.</p>
                <Feedback state={lossState} id="loss-feedback" />
                <div className={styles.formFooter}><span>Atualiza somente a perda padrão.</span><button type="submit">{lossPending ? "Salvando…" : "Salvar perda padrão"}</button></div>
              </fieldset>
            </form>
          </section>
        </div>

        <aside className={styles.aside} aria-label="Contexto e resumo da empresa">
          <section className={styles.context} aria-labelledby="context-title">
            <span className={styles.eyebrow}>CADA DETALHE CONTA</span>
            <h2 id="context-title">Mais clareza nos seus custos.</h2>
            <p>{canManageEnterprise ? "A tarifa de energia e a perda de filamento servem de referência para os cálculos da precificadora. Mantenha esses valores alinhados à sua operação." : "A perda padrão é o valor inicial sugerido na precificadora. Ajuste-a para refletir a realidade da sua produção."}</p>
            <div className={styles.contextNote}>Cada configuração tem seu próprio botão de salvar. Alterações em outros campos só serão aplicadas quando você salvá-las.</div>
          </section>
          <section className={styles.summary} aria-labelledby="summary-title">
            <div className={styles.summaryHeader}><h2 id="summary-title">Resumo da configuração</h2><span>Valores salvos</span></div>
            <dl>
              {canManageEnterprise && <><div><dt>Empresa</dt><dd>{currentName}</dd></div><div><dt>Tarifa de energia</dt><dd>{currentRate === null ? "Não informada" : `R$ ${decimal(currentRate)} / kWh`}</dd></div></>}
              <div><dt>Perda de filamento</dt><dd>{decimal(currentLoss)}%</dd></div>
            </dl>
            <p>O resumo reflete os últimos valores salvos, não as alterações em edição.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
