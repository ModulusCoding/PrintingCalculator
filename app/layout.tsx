import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/context/LanguageContext";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000/";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title: {
    default: "Modulus 3D Calculator | Precificação para Impressão 3D",
    template: "%s | Modulus 3D Calculator",
  },

  description:
    "Calcule o custo e o preço de venda das suas impressões 3D de forma rápida e precisa. Considere material, energia, máquina, acabamento, embalagem, impostos e margens de lucro.",

  applicationName: "Modulus 3D Calculator",

  keywords: [
    "calculadora impressão 3D",
    "precificação impressão 3D",
    "custo impressão 3D",
    "preço impressão 3D",
    "calculadora 3D",
    "custo de impressão",
    "precificação 3D",
    "impressão 3D",
    "filamento 3D",
    "custo de filamento",
  ],

  authors: [
    {
      name: "Modulus",
    },
  ],

  creator: "Modulus",
  publisher: "Modulus",

  icons: {
    icon: "/og-image.png",
    shortcut: "/og-image.png",
    apple: "/og-image.png",
  },

  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: siteUrl,
    siteName: "Modulus 3D Calculator",

    title: "Modulus 3D Calculator | Precifique suas impressões 3D",

    description:
      "Calcule custos e preços de venda para impressões 3D considerando material, energia, máquina, acabamento, embalagem, impostos e margem de lucro.",

    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Modulus 3D Calculator - Calculadora de precificação para impressão 3D",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",

    title: "Modulus 3D Calculator | Precificação para Impressão 3D",

    description:
      "Calcule rapidamente o custo e o preço de venda das suas impressões 3D.",

    images: ["/og-image.png"],
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