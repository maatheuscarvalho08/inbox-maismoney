import axios from "axios";

// Por que um envio pelo WhatsApp falhou, para decidir se dá para tentar de novo.
// - nao_enviada: há prova de que a mensagem não saiu. Pode reenviar.
// - incerta: a mensagem pode ter saído. Não reenvia (duplicaria); a equipe confere.
// - recusada: o provedor respondeu que não aceitou o pedido (erro do cliente da API,
//   4xx). Reenviar não resolve.
//
// Regra: status HTTP de erro sozinho não prova que nada saiu. Só contam como prova:
// - conexão que nem chegou a abrir (recusada, nome não resolvido, rede inalcançável):
//   o pedido nunca chegou ao provedor;
// - na Meta, os códigos de limite de envio da tabela de erros da Cloud API (o pedido foi
//   barrado antes do envio): 4 (limite de chamadas da aplicação), 80007 (limite da conta),
//   130429 (limite de throughput), 131056 (limite por par empresa-cliente). A lista vale
//   como foi documentada pela Meta; confira em mudanças de versão da API.
// A Evolution não documenta códigos de erro de envio: qualquer 5xx ou 429 é incerta.
export type FalhaEnvio = "nao_enviada" | "incerta" | "recusada";
export type Provedor = "evolution" | "meta_cloud";

const SEM_CONEXAO = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
const META_LIMITE = new Set([4, 80007, 130429, 131056]);

export function classificarFalhaEnvio(err: unknown, provedor: Provedor = "evolution"): FalhaEnvio {
  const code = (err as { code?: string } | null)?.code;
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === undefined) return code && SEM_CONEXAO.has(code) ? "nao_enviada" : "incerta";
    if (provedor === "meta_cloud") {
      const codigoMeta = Number((err.response?.data as { error?: { code?: unknown } } | undefined)?.error?.code);
      if (META_LIMITE.has(codigoMeta)) return "nao_enviada";
    }
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return "recusada";
    return "incerta";
  }
  if (code && SEM_CONEXAO.has(code)) return "nao_enviada";
  return "incerta";
}
