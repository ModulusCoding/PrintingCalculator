"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { AuthField, authStyles } from "./AuthUI";

export function PasswordField({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const [show, setShow] = useState(false);
  return <AuthField {...props} label={label} error={error} type={show ? "text" : "password"} icon={<Lock size={20} />}><button type="button" disabled={props.disabled} className={authStyles.toggle} onClick={() => setShow(!show)} aria-label={`${show ? "Ocultar" : "Mostrar"} ${label.toLocaleLowerCase("pt-BR")}`} aria-pressed={show} aria-controls={props.id ?? props.name}>{show ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}</button></AuthField>;
}
