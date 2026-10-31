import Image from "next/image";
import Link from "next/link";
import { AlertCircle, Layers3, Loader2, Mail } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./auth.module.css";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.shell} font-sans`}>
      <a className={styles.skip} href="#auth-content">Ir para o conteúdo</a>
      <aside className={styles.brand} aria-label="Modulus Hub">
        <Link href="/" className={styles.logo} aria-label="Modulus — página inicial"><Image src="/logo_Horizontal.svg" alt="Modulus" width={224} height={46} priority /></Link>
        <div className={styles.brandContent}>
          <span className={styles.brandBadge}><Layers3 size={16} aria-hidden="true" /> 3D PRINT OPS</span>
          <h2>Operação inteligente de manufatura aditiva.</h2>
          <p>Produtos, custos e operação de impressão 3D em um só lugar.</p>
          <div className={styles.features}><div><strong>PRECIFICAÇÃO</strong><span>Clareza sobre os custos de cada peça.</span></div><div><strong>GESTÃO INTEGRADA</strong><span>Uma visão organizada da sua operação.</span></div></div>
        </div>
        <p className={styles.brandFooter}>Modulus Hub <span>Gestão para impressão 3D</span></p>
      </aside>
      <main id="auth-content" className={styles.main} tabIndex={-1}>
        <div className={styles.mobileBrand}><Link href="/" aria-label="Modulus — página inicial"><Image src="/logo_Horizontal.svg" alt="Modulus" width={224} height={46} priority /></Link></div>
        <div className={styles.content}>{children}<footer className={styles.footer}>Modulus Hub · Gestão para impressão 3D</footer></div>
      </main>
    </div>
  );
}

export function AuthHeading({ title, description, badge = "ACESSO MODULUS" }: { title: string; description: string; badge?: string }) {
  return <header className="mb-8"><span className={styles.badge}><span aria-hidden="true" />{badge}</span><h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#191c1d] sm:text-[32px]">{title}</h1><p className="mt-2 text-base leading-relaxed text-[#5e5e5e]">{description}</p></header>;
}

export function AuthNotice({ children, type = "success" }: { children: ReactNode; type?: "error" | "success" | "info" }) {
  return <div role={type === "error" ? "alert" : "status"} className={`mb-5 flex items-start gap-3 rounded-lg border p-4 text-sm leading-relaxed ${type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-[#a6b4ff] bg-[#a6b4ff]/15 text-[#152336]"}`}><AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><div className="min-w-0 break-words">{children}</div></div>;
}

export function AuthField({ label, icon, error, children, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; icon?: ReactNode; error?: string; children?: ReactNode }) {
  const id = props.id ?? props.name;
  return <div><label htmlFor={id} className={styles.label}>{label}</label><div className="relative"><span className={styles.inputIcon} aria-hidden="true">{icon}</span><input {...props} id={id} aria-invalid={!!error} aria-describedby={[error ? `${id}-error` : null, props["aria-describedby"]].filter(Boolean).join(" ") || undefined} className={`${styles.input} ${children ? "pr-12" : "pr-4"}`} />{children}</div>{error ? <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-red-800">{error}</p> : null}</div>;
}

export function AuthSubmit({ pending, children, pendingText = "Enviando..." }: { pending: boolean; children: ReactNode; pendingText?: string }) {
  return <button type="submit" disabled={pending} className={styles.primary} aria-busy={pending}>{pending ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}<span role="status">{pending ? pendingText : children}</span></button>;
}

export function AuthBack({ href = "/admin/login", children = "Voltar para entrar" }: { href?: string; children?: ReactNode }) {
  return <div className="mt-6 text-center"><Link href={href} className={styles.back}>{children}</Link></div>;
}

export function AuthStatus({ title, description, children, error = false }: { title: string; description: string; children?: ReactNode; error?: boolean }) {
  return <section className={styles.status}><div className={styles.statusIcon}><Mail size={28} aria-hidden="true" /></div><AuthHeading title={title} description={description} badge={error ? "VERIFIQUE SEU ACESSO" : "ETAPA DE VERIFICAÇÃO"} />{children}</section>;
}

export const authStyles = styles;
