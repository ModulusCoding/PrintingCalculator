"use client";

import { useRef, type ReactNode } from "react";
import styles from "./Landing.module.css";
import { useLandingEffects } from "./useLandingEffects";

export default function LandingShell({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLandingEffects(root);
  return <div ref={root} className={styles.landing}>{children}</div>;
}
