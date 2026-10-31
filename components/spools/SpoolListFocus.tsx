"use client";

import { useEffect } from "react";

/** Full-page detail navigation restores focus to its originating card, without storage. */
export function SpoolListFocus() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (/^spool-[\da-f-]{36}$/i.test(id)) document.getElementById(id)?.focus();
  }, []);
  return null;
}
