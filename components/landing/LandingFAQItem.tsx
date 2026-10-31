"use client";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function LandingFAQItem({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const detail = useRef<HTMLDetailsElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = detail.current, content = answer.current;
    if (!node || !content) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = content.animate([{ height: open ? "0px" : `${content.scrollHeight}px` }, { height: open ? `${content.scrollHeight}px` : "0px" }], { duration: reduced ? 0 : 350, easing: "cubic-bezier(.22,1,.36,1)" });
    animation.onfinish = () => { if (!open) node.open = false; };
    return () => animation.cancel();
  }, [open]);
  return <details ref={detail} name="landing-faq" onToggle={event => { if (!event.currentTarget.open) setOpen(false); }}>
    <summary onClick={event => { event.preventDefault(); if (!open && detail.current) detail.current.open = true; setOpen(!open); }}>{title}<span><Plus size={20} strokeWidth={1.75} aria-hidden="true" /></span></summary>
    <div ref={answer} className="ml-faq-answer">{children}</div>
  </details>;
}
