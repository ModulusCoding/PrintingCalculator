import Link from "next/link";

export default async function ResetSuccessPage({ searchParams }: { searchParams: Promise<{ logout?: string }> }) {
  const { logout } = await searchParams;
  const logoutFailed = logout === "failed";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f8f9fa] px-4">
      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(to right,#e5e7eb 1px,transparent 1px),linear-gradient(to bottom,#e5e7eb 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <section className="relative w-full max-w-md rounded-xl border bg-white p-8 shadow-sm sm:p-10 text-center">
        <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-600 text-xl font-bold text-white">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-black">Senha alterada com sucesso!</h1>
        {logoutFailed ? (
          <p className="mt-3 text-gray-600">Senha alterada com sucesso, mas não foi possível encerrar a sessão.</p>
        ) : (
          <p className="mt-3 text-gray-600">Sua nova senha já está ativa. Use-a para entrar.</p>
        )}
        <div className="mt-6">
          <Link className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700" href="/admin/login">
            Ir para o login
          </Link>
        </div>
      </section>
    </main>
  );
}