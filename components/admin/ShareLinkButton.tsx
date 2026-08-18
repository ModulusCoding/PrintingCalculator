"use client";

import { useState } from "react";
import { Copy, ExternalLink, Check } from "lucide-react";
import { getPublicCatalogUrl } from "@/lib/links";

interface ShareLinkButtonProps {
  slug: string;
}

export function ShareLinkButton({ slug }: ShareLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const url = getPublicCatalogUrl(slug);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // noop
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleCopy}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
          copied
            ? "bg-emerald-600 text-white"
            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
        }`}
        title="Copiar link público do catálogo"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" />
            Link copiado!
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Copiar link
          </>
        )}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        title="Abrir catálogo público em nova aba"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Abrir
      </a>
    </div>
  );
}
