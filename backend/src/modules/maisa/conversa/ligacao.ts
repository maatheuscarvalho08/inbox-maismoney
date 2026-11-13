// Liga o motor conversacional ao fluxo: monta o ConversaDeps que o fluxo.ts usa. Fica fora do
// fluxo para o serviço e os testes usarem a mesma montagem.
import type { ConversaDeps, EstadoMaisa } from "../fluxo.js";
import { formatarReais } from "../textos.js";
import type { MensagemHistorico } from "./contexto.js";
import type { MotorConversacional } from "./motor.js";

export const ETAPAS_SO_DO_MOTOR: ReadonlySet<string> = new Set(["consentimento", "oferta", "oferta_port", "aguardando"]);

export interface ContextoExtra {
  historico: MensagemHistorico[];
  arquivos: { quando: Date; tipo: string; resumo: string | null }[];
}

export function criarConversaDeps(opts: {
  motor: MotorConversacional;
  etapas: Iterable<string>;
  modo?: "ativo" | "sombra";
  // Histórico recente e arquivos da conversa. Ausente: contexto sem histórico.
  contexto?: (estado: EstadoMaisa) => Promise<ContextoExtra>;
  lerContratoDeArquivo?: ConversaDeps["lerContratoDeArquivo"];
}): ConversaDeps {
  return {
    // Etapas em que o motor aceita, consulta ou autoriza (consentimento, oferta, aguardando) ficam
    // sempre só com as regras de sempre: ali um passo já faz efeito antes de qualquer veto.
    etapas: new Set([...opts.etapas].filter((e) => !ETAPAS_SO_DO_MOTOR.has(e))),
    lerContratoDeArquivo: opts.lerContratoDeArquivo,
    async decidir(p) {
      const extra = opts.contexto ? await opts.contexto(p.estado).catch(() => null) : null;
      const d = p.estado.alternativa?.digitacao;
      return opts.motor.decidir({
        modo: opts.modo ?? "ativo",
        produto: p.estado.produto,
        texto: p.texto,
        viaAudio: p.viaAudio,
        pendencia: p.pendencia,
        contratoPedido: d ? `${d.banco}, parcela ${formatarReais(Math.round(d.parcela * 100))}` : undefined,
        banco: d?.banco,
        oferta: undefined,
        fatosOferta: [],
        memoria: p.estado.memoria,
        historico: extra?.historico ?? [],
        arquivos: extra?.arquivos ?? [],
        agora: p.agora,
      });
    },
  };
}
