import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { FundoMarca } from "./FundoMarca";
import { LogoMaisMoney } from "./LogoMaisMoney";

const TEMPO_NA_TELA_MS = 1450;
const TEMPO_NA_TELA_REDUZIDO_MS = 900;
const SAIDA_MS = 650;

function movimentoReduzido() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Fica por cima do sistema, que já carrega por baixo: ao sair, a pessoa cai direto no
// Dashboard pronto. Só aparece após o login, nunca ao recarregar a página.
export function SaudacaoEntrada() {
  const { usuario, saudacao, concluirSaudacao } = useAuth();
  const logoRef = useRef<HTMLDivElement>(null);
  const [saindo, setSaindo] = useState(false);
  const ativa = Boolean(saudacao && usuario);

  // A logo continua do ponto exato em que estava na tela de login.
  useLayoutEffect(() => {
    const logo = logoRef.current;
    if (!ativa || !logo || !saudacao || movimentoReduzido()) return;
    const destino = logo.getBoundingClientRect();
    const escala = saudacao.origemLogo.width / destino.width;
    const x = saudacao.origemLogo.left - destino.left;
    const y = saudacao.origemLogo.top - destino.top;
    logo.animate([{ transform: `translate(${x}px, ${y}px) scale(${escala})` }, { transform: "none" }], {
      duration: 700,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
  }, [ativa, saudacao]);

  useEffect(() => {
    if (!ativa) return;
    setSaindo(false);
    const reduzido = movimentoReduzido();
    const tempo = reduzido ? TEMPO_NA_TELA_REDUZIDO_MS : TEMPO_NA_TELA_MS;
    const sair = setTimeout(() => setSaindo(true), tempo);
    const fim = setTimeout(concluirSaudacao, tempo + (reduzido ? 200 : SAIDA_MS));
    return () => {
      clearTimeout(sair);
      clearTimeout(fim);
    };
  }, [ativa, concluirSaudacao]);

  if (!ativa || !usuario) return null;

  const primeiroNome = usuario.nome.trim().split(/\s+/)[0];

  return (
    <div
      role="status"
      className={`font-marca fixed inset-0 z-50 bg-marca-laranja text-marca-indigo ${saindo ? "saudacao-painel-saindo" : ""}`}
    >
      <FundoMarca />
      <div className="relative flex h-full flex-col items-center justify-center px-6">
        <div ref={logoRef} className="w-44 origin-top-left sm:w-56">
          <LogoMaisMoney className="block w-full" />
        </div>
        <div className="mt-8 max-w-full overflow-hidden pb-[0.12em]">
          <p className="saudacao-texto text-center text-[clamp(2.75rem,8vw,5.5rem)] font-bold leading-[1.1] tracking-[-0.03em] [overflow-wrap:anywhere]">
            Olá, {primeiroNome}
          </p>
        </div>
      </div>
      {/* Borda inferior do painel: a mesma curva do sorriso da logo. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute left-0 top-full -mt-0.5 h-[14vh] w-full fill-marca-laranja"
      >
        <path d="M0 0H100Q50 200 0 0Z" />
      </svg>
    </div>
  );
}
