import type { Metadata } from "next";
import { isPublicOnboardingEnabled } from "@/lib/auth/config";
import LandingShell from "@/components/landing/LandingShell";
import LandingHeader from "@/components/landing/LandingHeader";
import LandingHero from "@/components/landing/LandingHero";
import LandingDemo from "@/components/landing/LandingDemo";
import LandingFeatures from "@/components/landing/LandingFeatures";
import LandingComparison from "@/components/landing/LandingComparison";
import LandingPricing from "@/components/landing/LandingPricing";
import LandingFAQ from "@/components/landing/LandingFAQ";
import LandingFooter from "@/components/landing/LandingFooter";

const title = "Modulus Hub — Sua próxima camada de crescimento";
const description = "Da primeira ideia à próxima entrega. Conheça o Modulus Hub: precificação, produtos, materiais e pedidos em um só fluxo.";
export const metadata: Metadata = {
  metadataBase: new URL("https://www.modulus3d.com.br"),
  title: { absolute: title }, description,
  alternates: { canonical: "https://www.modulus3d.com.br/" },
  openGraph: { type: "website", locale: "pt_BR", siteName: "Modulus Hub", title, description, url: "https://www.modulus3d.com.br/" },
  twitter: { card: "summary", title, description },
  robots: { index: true, follow: true },
  icons: { icon: "/landing/favicon.svg" },
};

export default function Page() {
  // Respect the existing public-onboarding policy; do not expose a production 404.
  const signupHref = isPublicOnboardingEnabled() ? "/cadastro" : "/admin/login";
  return <LandingShell>
    <a className="ml-skip-link" href="#conteudo">Pular para o conteúdo</a>
    <div className="ml-scroll-progress" aria-hidden="true" /><div className="ml-pointer-light" aria-hidden="true" />
    <LandingHeader />
    <main id="conteudo">
      <LandingHero />
      <div className="ml-ticker" aria-hidden="true"><div className="ml-ticker-track">{[0, 1].map(copy => <span key={copy} className="ml-ticker-copy"><span>Crie com liberdade</span><i>✳</i><span>Precifique com clareza</span><i>✳</i><span>Organize sua operação</span><i>✳</i><span>Cresça no seu ritmo</span><i>✳</i></span>)}</div></div>
      <LandingDemo /><LandingFeatures /><LandingComparison />
      <LandingPricing signupHref={signupHref} />
      {!isPublicOnboardingEnabled() && <p className="ml-access-note">Já tem uma conta? Os botões de acesso levam ao login do Hub. O cadastro público ainda não está disponível neste ambiente.</p>}
      <LandingFAQ />
    </main>
    <LandingFooter signupHref={signupHref} />
  </LandingShell>;
}
