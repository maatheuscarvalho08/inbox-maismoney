// Horário de atendimento da equipe (definido pelo dono): segunda a sexta das 9h às 18h,
// sábado das 9h às 13h, domingo fechado. Sempre no horário de Brasília.
const ABERTURA: Record<number, [number, number] | null> = {
  0: null, // domingo
  1: [9, 18],
  2: [9, 18],
  3: [9, 18],
  4: [9, 18],
  5: [9, 18],
  6: [9, 13], // sábado
};

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function agoraEmBrasilia(agora: Date) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(agora);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(valor("weekday"));
  return { dia, minutos: Number(valor("hour")) * 60 + Number(valor("minute")) };
}

export function dentroDoHorario(agora = new Date()): boolean {
  const { dia, minutos } = agoraEmBrasilia(agora);
  const h = ABERTURA[dia];
  return Boolean(h && minutos >= h[0] * 60 && minutos < h[1] * 60);
}

// "hoje às 9h", "amanhã às 9h" ou "segunda às 9h": quando a equipe volta.
export function proximaAbertura(agora = new Date()): string {
  const { dia, minutos } = agoraEmBrasilia(agora);
  const hoje = ABERTURA[dia];
  if (hoje && minutos < hoje[0] * 60) return `hoje às ${hoje[0]}h`;
  for (let i = 1; i <= 7; i++) {
    const d = (dia + i) % 7;
    const h = ABERTURA[d];
    if (h) return `${i === 1 ? "amanhã" : DIAS[d]} às ${h[0]}h`;
  }
  return "no próximo dia útil";
}

export const TEXTO_FORA_DO_HORARIO = (volta: string) =>
  "Nossa equipe atende de segunda a sexta, das 9h às 18h, e aos sábados, das 9h às 13h. " +
  `Agora estamos fora desse horário, mas a sua conversa fica registrada e um especialista te responde ${volta}.`;
