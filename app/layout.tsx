import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/context/LanguageContext";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";



export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ||
      "https://printing-calculator-lovat.vercel.app" || "http://localhost:3000"
  ),

  title: {
    default: "Modulus 3D Calculator | Precificação para Impressão 3D",
    template: "%s | Modulus 3D Calculator",
  },

  description:
    "Transforme os custos da sua impressão 3D em preços inteligentes. Calcule, simule e descubra quanto realmente vale cada peça.",

  applicationName: "Modulus 3D Calculator",

  icons: {
    icon: "/favicon.ico",
  },

  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Modulus 3D Calculator",
    title: "Modulus 3D Calculator | Precifique suas impressões 3D",
    description:
      "Precifique suas impressões 3D com inteligência. Descubra o custo real de cada peça, simule sua margem e encontre o preço ideal para vender.",
  },

  twitter: {
    card: "summary_large_image",
    title: "Modulus 3D Calculator | Precificação para Impressão 3D",
    description:
      "Calcule rapidamente o custo e o preço de venda das suas impressões 3D.",
  },

  robots: {
    index: true,
    follow: true,
  },
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap"
          rel="stylesheet"
        />
      </head>

      <body className="min-h-full flex flex-col">
        <LanguageProvider>{children}</LanguageProvider>

        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}