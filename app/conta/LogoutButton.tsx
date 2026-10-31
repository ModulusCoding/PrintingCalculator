"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutAction } from "@/lib/auth/actions";
import { LogOut, Loader2 } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleLogout = () => {
    setError(null);
    startTransition(async () => {
      const result = await logoutAction();
      if (result.error) {
        setError(result.error);
        return;
      }

      router.replace("/admin/login");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleLogout}
        disabled={isPending}
        className="w-full flex items-center justify-center gap-2 border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60 text-gray-700 py-3 rounded-lg font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogOut className="w-4 h-4" aria-hidden="true" />
        )}
        {isPending ? "Saindo..." : "Sair"}
      </button>
    </div>
  );
}
