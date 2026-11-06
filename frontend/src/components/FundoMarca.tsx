// Formas orgânicas em tom sobre tom. Decorativas: o contraste do índigo só melhora sobre elas.
export function FundoMarca() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        viewBox="0 0 600 640"
        className="login-forma absolute -right-[12%] -top-[28%] w-[max(64vw,520px)] fill-white/10"
      >
        <path d="M84 62C176-22 356-34 470 42c112 74 158 214 104 330-52 112-182 118-280 190C206 626 92 620 34 510-24 400 12 280 40 186 54 138 48 94 84 62Z" />
      </svg>
      <svg
        viewBox="0 0 600 600"
        className="login-forma absolute -bottom-[34%] -left-[14%] w-[max(52vw,460px)] fill-none stroke-white/10"
      >
        <circle cx="300" cy="300" r="270" strokeWidth="60" />
        <circle cx="300" cy="300" r="150" strokeWidth="60" />
      </svg>
    </div>
  );
}
