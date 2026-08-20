export default function Positioning() {
  return (
    <section className="relative overflow-hidden bg-white px-6 py-28 text-[var(--modulus-dark)] sm:px-10 lg:px-16">
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--modulus-primary)]">
          Posicionamento
        </p>
        <h2 className="mt-6 text-3xl font-black leading-[1.15] sm:text-5xl">
          Não vendemos plástico.
          <br />
          <span className="text-[var(--modulus-primary)]">Vendemos soluções que encantam.</span>
        </h2>
        <p className="mx-auto mt-8 max-w-2xl text-base leading-8 text-[var(--modulus-dark)]/60 sm:text-lg">
          A Modulus conecta desenvolvimento de produtos, tecnologia e manufatura
          digital em uma única jornada — do arquivo à peça na mão de quem pediu.
          A impressão 3D é uma das formas que essa visão assume, não o limite dela.
        </p>
        <div className="mt-14 grid gap-8 border-t border-[var(--modulus-dark)]/10 pt-10 text-left sm:grid-cols-3">
          {[
            { n: "01", t: "Desenvolvimento de produtos" },
            { n: "02", t: "Tecnologia" },
            { n: "03", t: "Manufatura digital" },
          ].map(({ n, t }) => (
            <div key={n}>
              <span className="text-sm font-bold text-[var(--modulus-accent)]">{n}</span>
              <p className="mt-2 text-lg font-bold leading-6">{t}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
