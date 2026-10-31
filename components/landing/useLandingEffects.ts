"use client";

import { useEffect, type RefObject } from "react";

/** Visual enhancements only; the server-rendered landing remains usable without JS. */
export function useLandingEffects(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");

    function initialize() {
      if (!root) return () => {};
      const cleanups: (() => void)[] = [];
      const styles = new Map<HTMLElement, Map<string, [string, string]>>();
      const classes = new Map<Element, Map<string, boolean>>();
      let disposed = false;
      let scrollFrame = 0;
      const reduced = motion.matches;
      const query = <T extends HTMLElement = HTMLElement>(selector: string) =>
        root.querySelector<T>(selector);
      const queryAll = <T extends HTMLElement = HTMLElement>(selector: string) =>
        Array.from(root.querySelectorAll<T>(selector));

      function style(element: HTMLElement | null, property: string, value: string) {
        if (!element) return;
        let original = styles.get(element);
        if (!original) {
          original = new Map();
          styles.set(element, original);
        }
        if (!original.has(property)) {
          original.set(property, [
            element.style.getPropertyValue(property),
            element.style.getPropertyPriority(property),
          ]);
        }
        element.style.setProperty(property, value);
      }

      function toggle(element: Element | null, name: string, enabled: boolean) {
        if (!element) return;
        let original = classes.get(element);
        if (!original) {
          original = new Map();
          classes.set(element, original);
        }
        if (!original.has(name)) original.set(name, element.classList.contains(name));
        element.classList.toggle(name, enabled);
      }

      const progress = query(".ml-scroll-progress");
      const header = query(".ml-header");
      const art = query(".ml-hero-art");
      function updateScroll() {
        scrollFrame = 0;
        if (disposed) return;
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        style(progress, "transform", `scaleX(${max > 0 ? Math.min(1, Math.max(0, y / max)) : 0})`);
        toggle(header, "ml-scrolled", y > 15);
        style(art, "--art-y", `${!reduced && window.innerWidth > 650 ? Math.min(Math.max(y, 0), 900) * 0.09 : 0}px`);
      }
      function queueScroll() {
        if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScroll);
      }
      window.addEventListener("scroll", queueScroll, { passive: true });
      window.addEventListener("resize", queueScroll);
      cleanups.push(() => {
        window.removeEventListener("scroll", queueScroll);
        window.removeEventListener("resize", queueScroll);
        window.cancelAnimationFrame(scrollFrame);
      });
      updateScroll();

      const reveals = queryAll(".ml-reveal");
      const supportsObserver = typeof IntersectionObserver !== "undefined";
      // Only opt into hidden-until-revealed CSS once enhancement is available.
      toggle(root, "ml-js", !reduced && supportsObserver);
      if (!reduced && supportsObserver) {
        const revealObserver = new IntersectionObserver((entries) => {
          if (disposed) return;
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            toggle(entry.target, "ml-visible", true);
            revealObserver.unobserve(entry.target);
          });
        }, { threshold: 0.09, rootMargin: "0px 0px -25px 0px" });
        reveals.forEach((element) => revealObserver.observe(element));
        cleanups.push(() => revealObserver.disconnect());
        queryAll(".ml-benefit-grid .ml-reveal,.ml-plan-grid .ml-reveal").forEach((element, index) => {
          style(element, "transition-delay", `${(index % 3) * 80}ms`);
        });
      } else {
        reveals.forEach((element) => toggle(element, "ml-visible", true));
      }

      const steps = queryAll(".ml-flow-step");
      const nodes = queryAll(".ml-flow-node");
      const current = query("#flow-current");
      const originalCurrent = current?.textContent ?? null;
      const flowProgress = query("#flow-progress");
      function activateStep(index: number) {
        if (!Number.isInteger(index) || index < 0 || index >= steps.length) return;
        steps.forEach((element, i) => toggle(element, "ml-active", i === index));
        nodes.forEach((element, i) => toggle(element, "ml-active", i === index));
        if (current) current.textContent = String(index + 1).padStart(2, "0");
        style(flowProgress, "width", `${((index + 1) / steps.length) * 100}%`);
      }
      activateStep(0);
      cleanups.push(() => {
        if (current) current.textContent = originalCurrent;
      });

      if (supportsObserver) {
        const flowObserver = new IntersectionObserver((entries) => {
          if (disposed) return;
          const visible = entries.filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
          if (visible.length) {
            const step = (visible[0].target as HTMLElement).dataset.step;
            if (step !== undefined) activateStep(Number(step));
          }
        }, { rootMargin: "-15% 0px -35% 0px", threshold: [0, 0.15, 0.4, 0.65] });
        steps.forEach((element) => flowObserver.observe(element));
        cleanups.push(() => flowObserver.disconnect());

        const links = queryAll<HTMLAnchorElement>(".ml-desktop-nav a");
        const navObserver = new IntersectionObserver((entries) => {
          if (disposed) return;
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              links.forEach((link) => toggle(link, "ml-active", link.hash === `#${entry.target.id}`));
            }
          });
        }, { rootMargin: "-15% 0px -65% 0px" });
        queryAll("#funcionalidades,#fluxo,#planos,#duvidas").forEach((element) => navObserver.observe(element));
        cleanups.push(() => navObserver.disconnect());
      }

      if (pointer.matches && !reduced) {
        const light = query(".ml-pointer-light");
        const moveLight = (event: PointerEvent) => {
          style(light, "left", `${event.clientX}px`);
          style(light, "top", `${event.clientY}px`);
        };
        root.addEventListener("pointermove", moveLight, { passive: true });
        cleanups.push(() => root.removeEventListener("pointermove", moveLight));

        queryAll(".ml-tilt-card").forEach((card) => {
          const move = (event: PointerEvent) => {
            const rect = card.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            style(card, "--rx", `${-(event.clientY - rect.top - rect.height / 2) / rect.height * 5}deg`);
            style(card, "--ry", `${(event.clientX - rect.left - rect.width / 2) / rect.width * 5}deg`);
          };
          const leave = () => {
            style(card, "--rx", "0deg");
            style(card, "--ry", "0deg");
          };
          card.addEventListener("pointermove", move, { passive: true });
          card.addEventListener("pointerleave", leave);
          cleanups.push(() => {
            card.removeEventListener("pointermove", move);
            card.removeEventListener("pointerleave", leave);
          });
        });

        queryAll(".ml-magnetic").forEach((button) => {
          const move = (event: PointerEvent) => {
            const rect = button.getBoundingClientRect();
            style(button, "transform", `translate(${(event.clientX - rect.left - rect.width / 2) * 0.08}px, ${(event.clientY - rect.top - rect.height / 2) * 0.12}px)`);
          };
          const leave = () => {
            const original = styles.get(button)?.get("transform");
            style(button, "transform", original?.[0] ?? "");
          };
          button.addEventListener("pointermove", move, { passive: true });
          button.addEventListener("pointerleave", leave);
          cleanups.push(() => {
            button.removeEventListener("pointermove", move);
            button.removeEventListener("pointerleave", leave);
          });
        });
      }

      return () => {
        disposed = true;
        cleanups.forEach((cleanup) => cleanup());
        styles.forEach((properties, element) => {
          properties.forEach(([value, priority], property) => {
            if (value) element.style.setProperty(property, value, priority);
            else element.style.removeProperty(property);
          });
        });
        classes.forEach((names, element) => {
          names.forEach((present, name) => element.classList.toggle(name, present));
        });
      };
    }

    let cleanup = initialize();
    const reinitialize = () => {
      cleanup();
      cleanup = initialize();
    };
    motion.addEventListener("change", reinitialize);
    pointer.addEventListener("change", reinitialize);
    return () => {
      motion.removeEventListener("change", reinitialize);
      pointer.removeEventListener("change", reinitialize);
      cleanup();
    };
  }, [rootRef]);
}

export default useLandingEffects;
