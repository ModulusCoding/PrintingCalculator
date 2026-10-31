import { isPublicOnboardingEnabled } from "@/lib/auth/config";
import { notFound } from "next/navigation";

export default function CadastroLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!isPublicOnboardingEnabled()) {
    notFound();
  }

  return children;
}
