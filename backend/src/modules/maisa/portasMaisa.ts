// Pontos que os testes trocam: relógio, espera entre reenvios e o "digitando".
import { randomUUID } from "node:crypto";

export function tempoDigitando(texto: string, sorteio = Math.random()) {
  const base = 2500 + texto.length * 30;
  return Math.round(Math.min(12_000, Math.max(3000, base * (0.85 + sorteio * 0.3))));
}

export const portasMaisa = {
  agora: () => new Date(),
  digitando: (texto: string) => tempoDigitando(texto),
  // Espera até a próxima tentativa de uma mensagem "nao_enviada".
  esperaReenvioMs: (tentativa: number) => [2_000, 6_000, 15_000, 30_000][Math.min(tentativa - 1, 3)],
};

// Identifica este processo nos leases e nas saídas em envio.
export const DONO_PROCESSO = `${process.pid}-${randomUUID().slice(0, 8)}`;
