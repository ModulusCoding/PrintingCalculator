import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Modulus 3D Calculator",
  description:
    "Plataforma SaaS para calculo de precificacao de impressao 3D, estimativas rapidas e vendas em marketplaces.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
    
      <html lang="pt-BR" className="h-full antialiased">
        <head>
<link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet" />
    </head>
      
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </>
  );
}
