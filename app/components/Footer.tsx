import React from 'react'
 import Link from "next/link";
const Footer = () => {
  return (
   

<section className="border-t border-black/10 bg-white px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 md:grid-cols-[1fr_auto_auto_auto] md:gap-16">
            {/* Brand */}
            <div>
              <Link href="/" className="flex items-center gap-2">
                <div><img className="h-12" src="../logo_Horizontal.png" alt="Logo Modulus" /></div>
              </Link>
              <p className="mt-4 max-w-xs text-sm leading-6 text-black/50">
                Precificacao inteligente para quem fabrica com seriedade. Calcule, decida, venda.
              </p>
              {/* Social mini row */}
              <div className="mt-5 flex gap-2">
                {[
                  { label: "TikTok", href: "https://www.tiktok.com/@modulus.studios?_r=1&_t=zs-95u3cwvuqep", path: "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.72a8.18 8.18 0 0 0 4.78 1.52V6.79a4.85 4.85 0 0 1-1.01-.1z" },
                  { label: "Instagram", href: "https://www.instagram.com/modulus.studios?igsh=Zno4cTY2cG51aXR0&utm_source=qr", path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" },
                  { label: "WhatsApp", href: "https://wa.me/5511912000753?text=%E2%98%BA%EF%B8%8E%20%20%E1%90%B8%20%20Bem-vindo%20%C3%A0%20%20%2AM%E1%B4%8F%E1%B4%85%E1%B4%9C%CA%9F%E1%B4%9C%EA%9C%B1%2A%20%20%21%20%20%2A%E2%9F%AF%2A%0A%20%20%E2%80%A2%20Tudo%20come%C3%A7a%20com%20sua%20ideia%0A%20%20%E2%80%A2%20Voc%C3%AA%20pensa%2C%20n%C3%B3s%20fazemos%0A%E2%86%92%20Sem%20custo%2C%20me%20conte%20como%20vamos%20dar%20vida%20a%20seu%20projeto%3A", path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" },
                ].map(({ label, href, path }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-black/10 text-black/40 transition hover:border-[#5852FF]/30 hover:bg-[#5852FF]/8 hover:text-[#5852FF]"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d={path} />
                    </svg>
                  </a>
                ))}
              </div>
            </div>

           
          </div>

          {/* Footer bottom */}
          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-black/8 pt-8 sm:flex-row">
            <p className="text-xs text-black/40">
              © {new Date().getFullYear()} Modulus. Todos os direitos reservados.
            </p>
            <div className="flex items-center gap-1.5 text-xs text-black/35">
              <span>Feito com</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="#5852FF" stroke="none">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              <span>para a Comunidade <em className="font-bold">Maker</em></span>
            </div>
          </div>
        </div>
      </section>
  )
}

export default Footer
