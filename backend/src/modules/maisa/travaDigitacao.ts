// Trava da digitação automática na Facta. Independente do código master: mesmo com a
// Facta configurada, a Maisa só digita se TODAS as condições abaixo valerem. Qualquer
// uma falhando, o contrato vai para a equipe com os dados na nota.
//
// As outras duas condições ficam fora daqui porque dependem do banco de dados:
// - nenhuma mensagem do cliente chegou depois do "sim" sem ser lida (fluxo.ts,
//   mensagemPosterior);
// - nenhuma outra digitação desta oferta (chave única em operacoes_facta, operacaoFacta.ts).
import { camposFaltando } from "./contrato.js";
import type { EstadoMaisa } from "./fluxo.js";

export interface ContextoTrava {
  // MAISA_DIGITACAO_LIBERADA. Desligada por padrão.
  liberada: boolean;
}

export function motivoTravaDigitacao(estado: EstadoMaisa, ctx: ContextoTrava): string | null {
  if (!ctx.liberada) return "trava MAISA_DIGITACAO_LIBERADA desligada";
  if (estado.etapa !== "confirmacao") return `conversa fora da confirmação (${estado.etapa})`;
  const pendente = estado.confirmacaoPendente;
  if (!pendente?.consentimento?.trim()) return "sem SIM explícito do cliente registrado";
  const produto = estado.produto;
  if (produto !== "inss" && produto !== "siape") return "produto sem digitação automática";
  const dados = estado.contrato?.dados;
  if (!dados) return "sem dados do cadastro";
  const faltando = camposFaltando(dados, produto);
  if (faltando.length) return `dados incompletos: ${faltando.join(", ")}`;
  if ((estado.contrato?.correcoes ?? []).some((c) => !c.aplicada)) return "dado do extrato divergente, sem validação";
  if (estado.contrato?.correcaoPendente) return "correção pedida pelo cliente e não aplicada";
  const port = estado.alternativa;
  if (port) {
    if (!port.digitacao?.refin || !port.digitacao.bancoCodigo) return "portabilidade sem refin ou sem código do banco de origem";
    if (!port.numeroContrato) return "portabilidade sem número do contrato";
  } else if (!estado.oferta?.tabela) {
    return "oferta sem tabela da Facta";
  }
  return null;
}
