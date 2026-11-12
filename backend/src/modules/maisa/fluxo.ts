import type { Convenio } from "@prisma/client";
import type { Classificador, ConvenioEntendido, LeituraOferta } from "./classificador.js";
import type { DigitacaoPort, ReducaoParcela, TabelaDigitacao, ResultadoAutorizacao, ResultadoBanco, ResultadoConsulta, ResultadoExtrato } from "./bancos.js";
import { cpfValido, extrairCpf } from "./cpf.js";
import { buscarFaq } from "./faq.js";
import { PRODUTOS_COM_SIMULACAO, ROTULO_CONVENIO, TEXTOS, formatarReais } from "./textos.js";
import { camposFaltando, proximaPergunta, resumoDados, type CampoContrato, type DadosContrato } from "./contrato.js";
import type { ResultadoContratacao } from "./facta.js";

// O fluxograma da Maisa. Cada etapa só sabe tratar a resposta da pergunta que ela
// fez. Este arquivo não fala com o banco de dados nem com o WhatsApp: recebe o estado
// e a mensagem e devolve o novo estado, as respostas e o que precisa ser gravado.
// Assim dá para testar o fluxo inteiro sem nada rodando (ver scripts/testarMaisa.ts).

// CLT: cpf, nome, consentimento, aguardando (link do banco), oferta.
// INSS e SIAPE: cpf, nascimento, extrato, oferta. A margem sai do extrato do cliente.
export type Etapa =
  | "inicio"
  | "convenio"
  | "cpf"
  | "nome"
  | "consentimento"
  | "aguardando"
  | "nascimento"
  | "extrato"
  | "oferta"
  // Sem margem para novo, mas a Facta abriu port ou refin: ela oferta e a equipe digita.
  | "oferta_port"
  // Aceitou a port + refin: pede o número do contrato no banco de origem.
  | "numero_contrato"
  | "coleta"
  | "confirmacao"
  | "finalizada";

export type Produto = "clt" | "inss" | "siape";
type ProdutoExtrato = Exclude<Produto, "clt">;
const porExtrato = (p: string | undefined): p is ProdutoExtrato => p === "inss" || p === "siape";

export interface EstadoMaisa {
  etapa: Etapa;
  // Quantas vezes seguidas ela não entendeu a resposta da etapa atual.
  tentativas: number;
  produto?: Produto;
  // INSS e SIAPE: AAAA-MM-DD, a Facta pede na simulação.
  dataNascimento?: string;
  // Data com ano impossível (ex.: 1852): a que ela acha que o cliente quis dizer, esperando confirmação.
  dataSugerida?: string;
  // Extrato que chegou antes da hora (na etapa do CPF, por exemplo): é lido quando tiver a data.
  extratoPendenteId?: string;
  // Nome completo, que o banco exige no pedido de autorização.
  nome?: string;
  // Espera pela autorização do cliente no link do banco (ISO).
  autorizacaoPedidaEm?: string;
  proximaVerificacao?: string;
  reenvios?: number;
  // Oferta enviada e ainda sem resposta: follow-up em 10 minutos, carrinho em 24 horas.
  ofertaEm?: string;
  ultimoContatoCliente?: string;
  followupEnviado?: boolean;
  oferta?: {
    banco: string;
    valorCentavos: number;
    parcelaCentavos: number;
    prazoMeses: number;
    tabela?: { codigoTabela: number; prazo: number; contrato: number; parcela: number; coeficiente: number };
    renda?: number | null;
    especie?: number | null;
    matricula?: string | null;
    contaSalario?: { bancoConta: string; agencia: string; conta: string } | null;
  };
  // Quantas objeções ela já tentou contornar nesta oferta.
  contornos?: number;
  // O cliente já tinha aceitado (conversa retomada): ela não oferta de novo, vai direto ao contrato.
  aceitouOferta?: boolean;
  // Port, port + refin ou refin que a Facta abriu, ofertado ao cliente.
  alternativa?: {
    operacao: "port_refin" | "portabilidade" | "refin";
    trocoCentavos: number | null;
    motivo: string;
    digitacao?: DigitacaoPort;
    reducoes?: ReducaoParcela[];
    // Todo contrato em que a Facta abriu tabela, com as tabelas, para a nota da equipe.
    simulacoes?: DigitacaoPort[];
    numeroContrato?: string;
    // Do extrato, para o contrato não perguntar de novo.
    renda?: number | null;
    matricula?: string | null;
    contaSalario?: { bancoConta: string; agencia: string; conta: string } | null;
  };
  // Cadastro para digitar a proposta. Sai do estado assim que ela passa para a equipe.
  contrato?: { dados: DadosContrato; pergunta: string };
  motivoTransferencia?: string;
  // Onde ela estava quando passou para a equipe, e por quê, num rótulo fechado.
  // A tela usa isso para dizer ao atendente o que fazer em seguida.
  paradaEm?: Etapa;
  saida?: string;
}

// Mensagem do cliente, ou uma checagem automática do relógio (sem texto).
// documento = PDF ou imagem, que pode ser o extrato. Áudio chega já transcrito em texto.
export type Entrada = { texto: string | null; temMidia: boolean; documento?: boolean; documentoId?: string } | { evento: "verificar_autorizacao" | "verificar_oferta" };

export interface Dependencias {
  classificador: Classificador;
  agora(): Date;
  // Quem chama já sabe o CPF e o celular do cliente. O fluxo não precisa vê-los.
  solicitarAutorizacao(nome: string): Promise<ResultadoAutorizacao>;
  consultar(): Promise<ResultadoConsulta>;
  statusProposta(): Promise<{ banco: string; status: string } | null>;
  // Lê o extrato que acabou de chegar e simula com a margem dele.
  // documentoId: extrato que o cliente mandou antes da hora. Sem ele, o da mensagem atual.
  simularPorExtrato(produto: ProdutoExtrato, dataNascimento: string, documentoId?: string): Promise<ResultadoExtrato>;
  // Digitação na Facta (INSS e SIAPE). Desligada, o "sim" vai para a equipe.
  digitacaoAtiva: boolean;
  extrairDados(pergunta: string, entrada: { texto: string | null; documento?: boolean }, faltando: CampoContrato[]): Promise<DadosContrato>;
  digitar(dados: DadosContrato): Promise<ResultadoContratacao>;
  // Responde ao que o cliente disse fora do esperado (ex.: "estou negativo"), só com fatos
  // aprovados. null: não tem o que dizer. Ausente nos testes: valem as regras.
  responderLivre?(texto: string, etapa: string, produto: string | undefined, pergunta: string): Promise<string | null>;
}

export type Efeito =
  | { tipo: "convenio"; convenio: Convenio }
  | { tipo: "cpf"; cpf: string }
  | { tipo: "simulacao"; convenio: Produto; resultado: ResultadoBanco }
  // nota: o que a Maisa fez, para o operador ler na conversa.
  | { tipo: "transferir"; motivo: string; nota?: string }
  // Não há o que fazer: a conversa fecha sem passar para a equipe.
  | { tipo: "encerrar"; motivo: string }
  | { tipo: "proposta"; codigoAf: string };

export interface Passo {
  estado: EstadoMaisa;
  respostas: string[];
  efeitos: Efeito[];
  // O que ela entendeu da mensagem. Vai para o registro, nunca o texto do cliente.
  rotulo: string;
}

// Não entendeu duas vezes: pergunta de novo. Na terceira, passa para a equipe.
const MAX_TENTATIVAS = 2;
// Link reenviado no máximo duas vezes.
const MAX_REENVIOS = 2;
// Depois de 48 horas sem autorizar, a conversa vai para a equipe.
const PRAZO_AUTORIZACAO_MS = 48 * 60 * 60_000;

const PERGUNTA_DA_ETAPA: Record<Etapa, string> = {
  inicio: TEXTOS.perguntaConvenio,
  convenio: TEXTOS.perguntaConvenio,
  cpf: TEXTOS.pedeCpf,
  nome: TEXTOS.nomeInvalido,
  consentimento: TEXTOS.perguntaConsentimento,
  aguardando: TEXTOS.aindaNaoAutorizou,
  nascimento: TEXTOS.nascimentoInvalido,
  extrato: TEXTOS.lembraExtrato,
  oferta: TEXTOS.perguntaOferta,
  oferta_port: TEXTOS.perguntaOferta,
  numero_contrato: TEXTOS.numeroContratoInvalido,
  coleta: TEXTOS.continuarCadastro,
  confirmacao: TEXTOS.perguntaConfirmacao,
  finalizada: "",
};

// Depois de responder ao que o cliente disse, ela retoma a etapa com uma pergunta curta.
// Repetir o texto inteiro (a lista de 10 produtos) a cada mensagem soa como robô.
const RETOMA_ETAPA: Partial<Record<Etapa, string>> = {
  inicio: "Me conta: qual é o seu vínculo? Por exemplo CLT, INSS, SIAPE ou outro.",
  convenio: "Me conta: qual é o seu vínculo? Por exemplo CLT, INSS, SIAPE ou outro.",
  cpf: "Pode me mandar o seu CPF? Só os números.",
  nascimento: "Qual a sua data de nascimento?",
  extrato: "Quando puder, me manda o extrato aqui, em PDF ou foto.",
  consentimento: "Posso consultar? É só me responder SIM.",
};

const NOME_ETAPA: Record<Etapa, string> = {
  inicio: "início",
  convenio: "vínculo",
  cpf: "CPF",
  nome: "nome",
  consentimento: "autorização",
  aguardando: "link do banco",
  nascimento: "data de nascimento",
  extrato: "extrato",
  oferta: "oferta",
  oferta_port: "oferta de portabilidade",
  numero_contrato: "número do contrato",
  coleta: "dados do contrato",
  confirmacao: "confirmação dos dados",
  finalizada: "fim",
};

function ir(estado: EstadoMaisa, etapa: Etapa, respostas: string[], rotulo: string, efeitos: Efeito[] = [], extra: Partial<EstadoMaisa> = {}): Passo {
  return { estado: { ...estado, ...extra, etapa, tentativas: 0 }, respostas, efeitos, rotulo };
}

function transferir(
  estado: EstadoMaisa,
  motivo: string,
  resposta: string | null,
  rotulo: string,
  efeitos: Efeito[] = [],
  saida = rotulo,
): Passo {
  return {
    // Os dados do cadastro (RG, endereço, filiação) não ficam guardados depois daqui.
    estado: { ...estado, etapa: "finalizada", tentativas: 0, motivoTransferencia: motivo, paradaEm: estado.etapa, saida, contrato: undefined },
    respostas: resposta ? [resposta] : [],
    efeitos: [...efeitos, { tipo: "transferir", motivo, nota: notaEquipe(estado, motivo, efeitos) }],
    rotulo,
  };
}

const r$ = (reais: number) => formatarReais(Math.round(reais * 100));

// Nota para o operador ao passar a conversa: o que a Maisa fez, onde simulou e o que
// voltou. Fica na conversa, só para a equipe. Os dados do cadastro saem resumidos.
export function notaEquipe(estado: EstadoMaisa, motivo: string, efeitos: Efeito[] = []): string {
  const linhas = [`Passei para a equipe: ${motivo}.`];
  const produto = estado.produto ? estado.produto.toUpperCase() : "não definido";
  linhas.push(`Produto: ${produto}. Parei na etapa: ${NOME_ETAPA[estado.etapa]}.`);

  for (const e of efeitos) {
    if (e.tipo !== "simulacao") continue;
    const r = e.resultado;
    if (r.tipo === "com_saldo") {
      linhas.push(`Simulei no ${r.banco}: até ${formatarReais(r.valorCentavos)} em ${r.prazoMeses}x de ${formatarReais(r.parcelaCentavos)}.`);
    } else if (r.tipo === "sem_saldo") {
      linhas.push(`Simulei no ${r.banco === "extrato" ? "extrato (leitura do documento)" : r.banco}: sem saldo. ${r.motivo}`);
    } else {
      linhas.push(`Simulação no ${r.banco} deu erro: ${r.motivo}`);
    }
  }

  const o = estado.oferta;
  if (o) {
    linhas.push(
      `Oferta enviada (${o.banco}): até ${formatarReais(o.valorCentavos)} em ${o.prazoMeses}x de ${formatarReais(o.parcelaCentavos)}` +
        (o.tabela ? `, tabela ${o.tabela.codigoTabela}.` : "."),
    );
  }

  const a = estado.alternativa;
  if (a) {
    const nome = { port_refin: "port + refin", portabilidade: "portabilidade", refin: "refin" }[a.operacao];
    linhas.push(...dadosDoCliente(estado));
    linhas.push(`Simulei na Facta (${nome}, operação 003500): ${a.motivo}.`);
    if (a.trocoCentavos) linhas.push(`Troco ofertado: até ${formatarReais(a.trocoCentavos)}.`);
    if (a.numeroContrato) linhas.push(`Número do contrato informado pelo cliente: ${a.numeroContrato}.`);
    if (a.digitacao) linhas.push(`Contrato que ela ofertou: ${a.digitacao.banco}, parcela ${r$(a.digitacao.parcela)}.`);
    // Tudo o que a Facta abriu, contrato por contrato, para a equipe digitar no portal.
    if (a.simulacoes?.length) {
      linhas.push("", "SIMULAÇÕES NA FACTA (SIAPE, averbador 15, operação 003500). Saldo estimado: confirmar na CIP.");
      a.simulacoes.forEach((s, i) => linhas.push(...blocoSimulacao(s, i + 1, a.numeroContrato, a.digitacao)));
    }
  }
  // Conversa antiga, sem a lista: só o contrato ofertado e as reduções.
  if (a && !a.simulacoes?.length) {
    if (a.digitacao) linhas.push("", "SIMULAÇÃO NA FACTA (SIAPE, averbador 15, operação 003500). Saldo estimado: confirmar na CIP.", ...blocoSimulacao(a.digitacao, 1, a.numeroContrato, a.digitacao));
    for (const red of a.reducoes ?? []) linhas.push(`Port ${red.banco}: parcela de ${r$(red.atual)} cai para ${r$(red.nova)}.`);
  }

  const dados = estado.contrato?.dados;
  if (dados && Object.keys(dados).length) {
    linhas.push("", `DADOS PARA O CADASTRO:\n${resumoDados(dados, true)}`);
  }
  return linhas.join("\n");
}

const pct = (n: number) => `${String(Number(n.toFixed(2))).replace(".", ",")}% a.m.`;

function linhaTabela(rotulo: string, t: TabelaDigitacao, refin: boolean): string {
  return (
    `   ${rotulo}: tabela ${t.codigoTabela}${t.nome ? ` (${t.nome})` : ""}, ${t.prazo}x de ${r$(t.parcela)}` +
    (t.taxa ? `, taxa ${pct(t.taxa)}` : "") +
    `, coeficiente ${t.coeficiente}, ${refin ? "bruto" : "valor da operação"} ${r$(t.contrato)}` +
    (refin && t.liquido != null ? `, troco ${r$(t.liquido)}` : "")
  );
}

// Um contrato simulado, com tudo o que o portal pede para digitar.
function blocoSimulacao(s: DigitacaoPort, n: number, numeroCliente?: string, ofertado?: DigitacaoPort): string[] {
  const foiOfertado = ofertado && ofertado.banco === s.banco && ofertado.parcela === s.parcela;
  const numero = s.numeroContrato || (foiOfertado ? numeroCliente : undefined);
  const economia = s.parcela - s.port.parcela;
  return [
    `${n}) ${s.banco}${s.bancoCodigo ? `, código ${s.bancoCodigo}` : ", código do banco não identificado"}` +
      `${numero ? `, contrato nº ${numero}` : ", nº do contrato: pegar na BRB"}${foiOfertado ? "  [OFERTADO]" : ""}`,
    // Sem o total no extrato, o prazo original enviado à Facta é o próprio restante.
    `   Hoje: parcela ${r$(s.parcela)}, faltam ${s.prazoRestante}` +
      (s.prazoOriginal > s.prazoRestante ? ` de ${s.prazoOriginal}` : " (total e pagas não informados no extrato: conferir na BRB)") +
      `, saldo estimado ${r$(s.saldoDevedor)}`,
    linhaTabela("Port", s.port, false) + (economia > 0 ? `, parcela cai ${r$(economia)} por mês` : ""),
    s.refin ? linhaTabela("Refin da port", s.refin, true) : "   Refin da port: nenhuma tabela com troco (só port pura)",
  ];
}

// Cliente: o que o portal pede além do cadastro, lido do extrato.
function dadosDoCliente(estado: EstadoMaisa): string[] {
  const a = estado.alternativa;
  const partes = [
    estado.nome ? `nome ${estado.nome}` : null,
    estado.dataNascimento ? `nascimento ${estado.dataNascimento.slice(0, 10).split("-").reverse().join("/")}` : null,
    a?.matricula ? `matrícula ${a.matricula}` : null,
    a?.renda ? `renda bruta ${r$(a.renda)}` : null,
    a?.contaSalario ? `conta salário: banco ${a.contaSalario.bancoConta}, agência ${a.contaSalario.agencia}, conta ${a.contaSalario.conta}` : null,
  ].filter(Boolean);
  return partes.length ? [`Cliente: ${partes.join("; ")}.`] : [];
}

// Fim sem atendente: nada a oferecer agora. Se o cliente escrever de novo, começa outra conversa.
function encerrar(estado: EstadoMaisa, motivo: string, resposta: string, rotulo: string, efeitos: Efeito[] = [], saida = rotulo): Passo {
  return {
    estado: { ...estado, etapa: "finalizada", tentativas: 0, motivoTransferencia: motivo, paradaEm: estado.etapa, saida, contrato: undefined },
    respostas: [resposta],
    efeitos: [...efeitos, { tipo: "encerrar", motivo }],
    rotulo,
  };
}

function tentarDeNovo(estado: EstadoMaisa, resposta: string, rotulo: string, saida = "nao_entendeu"): Passo {
  const tentativas = estado.tentativas + 1;
  if (tentativas > MAX_TENTATIVAS) {
    return transferir(estado, `não entendeu a resposta na etapa ${NOME_ETAPA[estado.etapa]}`, TEXTOS.transferindo, rotulo, [], saida);
  }
  return { estado: { ...estado, tentativas }, respostas: [resposta], efeitos: [], rotulo };
}

// Resposta fora do que a etapa espera. Se for uma dúvida conhecida, responde e repete
// a pergunta. Dúvida desconhecida vai para a equipe, em vez de a Maisa improvisar.
// Antes de repetir a pergunta da etapa, responde ao que o cliente disse. Sem resposta
// possível, vale a regra de sempre (FAQ, dúvida para a equipe ou "não entendi").
async function ouvirCliente(estado: EstadoMaisa, texto: string, deps: Dependencias, pergunta = PERGUNTA_DA_ETAPA[estado.etapa]): Promise<Passo> {
  const faq = buscarFaq(texto);
  if (faq) return { estado, respostas: [faq, pergunta], efeitos: [], rotulo: "faq" };
  const tentativas = estado.tentativas + 1;
  if (deps.responderLivre && texto.trim() && tentativas <= MAX_TENTATIVAS) {
    try {
      const resposta = await deps.responderLivre(texto, NOME_ETAPA[estado.etapa], estado.produto, pergunta);
      if (resposta) {
        const retoma = RETOMA_ETAPA[estado.etapa] ?? pergunta;
        return { estado: { ...estado, tentativas }, respostas: [resposta, retoma], efeitos: [], rotulo: "resposta_livre" };
      }
    } catch (err) {
      console.error("Resposta livre falhou:", err instanceof Error ? err.message : err);
    }
  }
  return foraDaEtapa(estado, texto);
}

function foraDaEtapa(estado: EstadoMaisa, texto: string): Passo {
  const faq = buscarFaq(texto);
  if (faq) return { estado, respostas: [faq, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "faq" };
  if (texto.includes("?")) return transferir(estado, "dúvida sem resposta pronta", TEXTOS.transferindo, "duvida");
  return tentarDeNovo(estado, `${TEXTOS.naoEntendi} ${PERGUNTA_DA_ETAPA[estado.etapa]}`, "nao_entendeu");
}

function decidirConvenio(estado: EstadoMaisa, convenio: ConvenioEntendido, prefixo: string[] = []): Passo {
  const comPrefixo = (p: Passo) => ({ ...p, respostas: [...prefixo, ...p.respostas] });
  // Só segue com a Maisa o produto que tem simulação por API (CLT, INSS e SIAPE, na Facta).
  // Os demais vão para a equipe abaixo.
  if ((convenio === "clt" || porExtrato(convenio)) && PRODUTOS_COM_SIMULACAO.includes(convenio)) {
    return comPrefixo(ir(estado, "cpf", [TEXTOS.pedeCpf], convenio, [{ tipo: "convenio", convenio }], { produto: convenio }));
  }
  if (convenio === "servidor") {
    return comPrefixo(transferir(estado, "servidor público", TEXTOS.servidorComEquipe, "servidor"));
  }
  if (convenio === "outro") {
    return comPrefixo(transferir(estado, "vínculo fora dos convênios", TEXTOS.transferindo, "outro"));
  }
  return comPrefixo(
    transferir(
      estado,
      `convênio ${ROTULO_CONVENIO[convenio]}`,
      TEXTOS.convenioComEquipe(ROTULO_CONVENIO[convenio]),
      convenio,
      [{ tipo: "convenio", convenio }],
      "convenio",
    ),
  );
}

// Quando checar de novo se o cliente autorizou: a cada minuto nos primeiros 15,
// a cada 5 até completar 1 hora, depois a cada 30.
function proximaVerificacao(pedidaEm: Date, agora: Date) {
  const passou = agora.getTime() - pedidaEm.getTime();
  const intervalo = passou < 15 * 60_000 ? 60_000 : passou < 60 * 60_000 ? 5 * 60_000 : 30 * 60_000;
  return new Date(agora.getTime() + intervalo).toISOString();
}

const DESCONTO: Record<Produto, string> = { clt: "no seu salário", inss: "no seu benefício", siape: "na sua folha de pagamento" };

function mostrarResultado(estado: EstadoMaisa, resultado: ResultadoBanco, agora: Date): Passo {
  const efeito: Efeito = { tipo: "simulacao", convenio: estado.produto ?? "clt", resultado };
  if (resultado.tipo === "sem_saldo") {
    // "extrato" = a margem já acabou no extrato, nem chegou a consultar o banco.
    const doExtrato = resultado.banco === "extrato";
    // Leitura com dúvida: pode ser erro de leitura, a equipe confere.
    if (resultado.revisar) {
      return transferir(estado, `sem margem, leitura com dúvida: ${resultado.motivo}`, TEXTOS.semMargemExtrato, "sem_saldo", [efeito], "revisar_extrato");
    }
    // Sem margem e sem port ou refin: não há o que fazer. Encerra sem atendente.
    return encerrar(estado, `sem saldo: ${resultado.motivo}`, doExtrato ? TEXTOS.semMargemFim : TEXTOS.semSaldoFim, "sem_saldo", [efeito]);
  }
  if (resultado.tipo === "erro") {
    return transferir(estado, `erro no banco: ${resultado.motivo}`, TEXTOS.erroBanco, "erro_banco", [efeito]);
  }
  const { banco, valorCentavos, parcelaCentavos, prazoMeses, tabela, renda, especie, matricula, contaSalario } = resultado;
  const mensagem = TEXTOS.oferta(formatarReais(valorCentavos), prazoMeses, formatarReais(parcelaCentavos), DESCONTO[estado.produto ?? "clt"]);
  return ir(estado, "oferta", [mensagem], "com_saldo", [efeito], {
    oferta: { banco, valorCentavos, parcelaCentavos, prazoMeses, tabela, renda, especie, matricula, contaSalario },
    autorizacaoPedidaEm: undefined,
    proximaVerificacao: undefined,
    ofertaEm: agora.toISOString(),
    ultimoContatoCliente: undefined,
    followupEnviado: false,
  });
}

async function etapaInicio(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const intencao = await deps.classificador.intencao(texto);

  if (intencao === "acompanhar_proposta") {
    const proposta = await deps.statusProposta();
    if (!proposta) return transferir(estado, "quer acompanhar uma proposta sem registro", TEXTOS.transferindo, intencao);
    return ir(estado, "inicio", [TEXTOS.statusProposta(proposta.banco, proposta.status)], intencao);
  }

  // Quem já diz o vínculo na primeira mensagem pula a pergunta. "Outro" fica de fora
  // aqui porque "quero outro empréstimo" não diz nada sobre o vínculo.
  // Um número solto antes de ver a lista não é escolha de produto.
  const convenio = /^\d+\W*$/.test(texto) ? null : await deps.classificador.convenio(texto);
  if (convenio && convenio !== "outro") return decidirConvenio(estado, convenio, [TEXTOS.apresentacao]);

  if (intencao === "duvida") {
    const faq = buscarFaq(texto);
    if (!faq) return transferir(estado, "dúvida sem resposta pronta", TEXTOS.transferindo, intencao);
    return ir(estado, "convenio", [faq, TEXTOS.saudacao], intencao);
  }

  return ir(estado, "convenio", [TEXTOS.saudacao], intencao);
}

async function etapaConvenio(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const convenio = await deps.classificador.convenio(texto);
  return convenio ? decidirConvenio(estado, convenio) : ouvirCliente(estado, texto, deps);
}

async function etapaCpf(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const cpf = extrairCpf(texto);
  if (cpf) {
    if (!cpfValido(cpf)) return tentarDeNovo(estado, TEXTOS.cpfInvalido, "cpf_invalido");
    if (porExtrato(estado.produto)) return ir(estado, "nascimento", [TEXTOS.pedeNascimento], "cpf_valido", [{ tipo: "cpf", cpf }]);
    return ir(estado, "nome", [TEXTOS.pedeNome], "cpf_valido", [{ tipo: "cpf", cpf }]);
  }
  if ((await deps.classificador.simNao(texto)) === "nao") {
    return transferir(estado, "não quis informar o CPF", TEXTOS.semConsentimento, "recusou_cpf");
  }
  return ouvirCliente(estado, texto, deps);
}

// Nome com pelo menos duas palavras, só letras.
const NOME_COMPLETO = /^[a-zA-ZÀ-ÿ'´`^~-]{2,}( [a-zA-ZÀ-ÿ'´`^~.-]+)+$/;

async function etapaNome(estado: EstadoMaisa, texto: string): Promise<Passo> {
  const nome = texto.replace(/\s+/g, " ").trim();
  if (nome.length <= 120 && NOME_COMPLETO.test(nome)) {
    return ir(estado, "consentimento", [TEXTOS.pedeConsentimento], "nome_valido", [], { nome });
  }
  if (texto.includes("?")) return foraDaEtapa(estado, texto);
  return tentarDeNovo(estado, TEXTOS.nomeInvalido, "nome_invalido");
}

// "15/03/1958", "15-03-58", "15 03 1958" ou "15031958". Devolve AAAA-MM-DD.
export function lerDataNascimento(texto: string, agora: Date): string | null {
  const m = texto.match(/\b(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4}|\d{2})\b/) ?? texto.match(/\b(\d{2})(\d{2})(\d{4})\b/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let ano = Number(m[3]);
  if (m[3].length === 2) ano += ano > agora.getFullYear() % 100 ? 1900 : 2000;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCDate() !== dia || data.getUTCMonth() !== mes - 1) return null;
  const idade = (agora.getTime() - data.getTime()) / (365.25 * 24 * 60 * 60_000);
  if (idade < 18 || idade > 100) return null;
  return data.toISOString().slice(0, 10);
}

const produtoExtrato = (estado: EstadoMaisa): ProdutoExtrato => (porExtrato(estado.produto) ? estado.produto : "inss");

// Ano impossível com cara de erro de digitação (1852 no lugar de 1952): a data que
// provavelmente era. null se não der para adivinhar com segurança.
export function sugerirDataNascimento(texto: string, agora: Date): string | null {
  const m = texto.match(/\b(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4})\b/);
  if (!m || m[3].startsWith("19")) return null;
  return lerDataNascimento(`${m[1]}/${m[2]}/19${m[3].slice(2)}`, agora);
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

// Com a data em mãos: se o extrato já chegou antes, lê e simula agora; senão, pede o extrato.
async function seguirParaExtrato(estado: EstadoMaisa, data: string, deps: Dependencias): Promise<Passo> {
  const pronto: EstadoMaisa = { ...estado, etapa: "extrato", tentativas: 0, dataNascimento: data, dataSugerida: undefined, extratoPendenteId: undefined };
  if (estado.extratoPendenteId) return etapaExtrato(pronto, { texto: null, documento: true }, deps, estado.extratoPendenteId);
  return { estado: pronto, respostas: [TEXTOS.pedeExtrato(produtoExtrato(estado))], efeitos: [], rotulo: "nascimento_valido" };
}

async function etapaNascimento(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Confirmou a data que ela sugeriu ("isso", "sim", "tá certa").
  if (estado.dataSugerida && ((await deps.classificador.simNao(texto)) === "sim" || /(cert|corret|exato|essa mesma|isso)/.test(t))) {
    return seguirParaExtrato(estado, estado.dataSugerida, deps);
  }
  const data = lerDataNascimento(texto, deps.agora());
  if (data) return seguirParaExtrato(estado, data, deps);
  const sugerida = sugerirDataNascimento(texto, deps.agora());
  if (sugerida) return ir(estado, "nascimento", [TEXTOS.confirmaData(dataBr(sugerida))], "nascimento_sugerido", [], { dataSugerida: sugerida });
  // Sem número nenhum, é conversa: responde antes de pedir a data de novo.
  if (!/\d/.test(texto)) return ouvirCliente(estado, texto, deps);
  return tentarDeNovo(estado, TEXTOS.nascimentoInvalido, "nascimento_invalido");
}

// Chegou um PDF ou foto: lê como extrato e simula. Texto: explica como tirar o extrato.
async function etapaExtrato(
  estado: EstadoMaisa,
  entrada: { texto: string | null; documento?: boolean },
  deps: Dependencias,
  documentoId?: string,
): Promise<Passo> {
  if (!entrada.documento) {
    const texto = entrada.texto?.trim() ?? "";
    const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    // Não sabe tirar o extrato: explica como. Outra conversa ("estou negativo"): responde antes.
    // Só quando fala do extrato ou do aplicativo. "Não tenho margem" é outra conversa.
    const comoTirar =
      /(como|onde) (eu )?(tiro|tirar|baixo|baixar|pego|pegar|acho|achar|faco|fazer)|nao (sei|consigo) (tirar|baixar|pegar|achar|entrar|abrir|fazer)|nao tenho (o |a )?(extrato|aplicativo|app|sougov|senha|gov|celular)|sougov|meu inss|aplicativo|senha do gov|^nao (tenho|sei)( isso| esse| ele| nao)?[\s.!]*$/;
    if (!t || comoTirar.test(t)) {
      return tentarDeNovo(estado, TEXTOS.comoTirarExtrato(produtoExtrato(estado)), "sem_extrato", "sem_extrato");
    }
    return ouvirCliente(estado, texto, deps);
  }
  let resultado: ResultadoExtrato;
  try {
    resultado = await deps.simularPorExtrato(produtoExtrato(estado), estado.dataNascimento ?? "", documentoId);
  } catch (err) {
    resultado = { tipo: "erro", banco: "desconhecido", motivo: err instanceof Error ? err.message : "falha na leitura do extrato" };
  }
  if (resultado.tipo === "alternativa") {
    const troco = resultado.trocoCentavos ? formatarReais(resultado.trocoCentavos) : null;
    const { operacao, trocoCentavos, motivo, digitacao, reducoes, simulacoes, renda, matricula, contaSalario } = resultado;
    const lidos = {
      ...(renda ? { renda } : {}),
      ...(matricula ? { matricula } : {}),
      ...(contaSalario ? { contaSalario } : {}),
      ...(simulacoes?.length ? { simulacoes } : {}),
    };
    // Sem simulação na Facta (INSS, refin ou simulação que falhou): pode passar, mas
    // ela não oferta o que não simulou. A equipe simula e mostra ao cliente.
    if (!resultado.simulada) {
      const comAlternativa: EstadoMaisa = { ...estado, alternativa: { operacao, trocoCentavos, motivo, ...lidos } };
      return transferir(comAlternativa, `sem margem para novo; ${motivo}`, TEXTOS.semMargemExtrato, "alternativa", [], "alternativa");
    }
    // Já tinha dito SIM: avisa que vai digitar e pede o que falta, começando pelo contrato.
    if (estado.aceitouOferta && digitacao && deps.digitacaoAtiva) {
      const ganho = TEXTOS.ganhoPort(troco, digitacao.banco, r$(digitacao.parcela), digitacao.refin ? null : r$(digitacao.port.parcela));
      // Número do contrato já no extrato: retoma direto nos dados do cliente.
      if (digitacao.numeroContrato) {
        const comAlternativa: EstadoMaisa = {
          ...estado,
          aceitouOferta: undefined,
          alternativa: { operacao, trocoCentavos, motivo, digitacao, ...(reducoes?.length ? { reducoes } : {}), ...lidos },
        };
        return iniciarColetaPort(comAlternativa, digitacao.numeroContrato, "retoma_contrato", [TEXTOS.retomaSemNumero(ganho)]);
      }
      return ir(
        estado,
        "numero_contrato",
        [
          TEXTOS.retomaDigitacao(
            digitacao.banco,
            r$(digitacao.parcela),
            TEXTOS.ganhoPort(
              troco,
              digitacao.banco,
              r$(digitacao.parcela),
              digitacao.refin ? null : r$(digitacao.port.parcela),
            ),
          ),
        ],
        "retoma_contrato",
        [],
        {
          aceitouOferta: undefined,
          alternativa: { operacao, trocoCentavos, motivo, digitacao, ...(reducoes?.length ? { reducoes } : {}), ...lidos },
        },
      );
    }
    return ir(estado, "oferta_port", [TEXTOS.ofertaPort({ operacao, trocoCentavos, digitacao, reducoes })], "alternativa", [], {
      alternativa: { operacao, trocoCentavos, motivo, ...(digitacao ? { digitacao } : {}), ...(reducoes?.length ? { reducoes } : {}), ...lidos },
    });
  }
  if (resultado.tipo === "servidor_outro") {
    return transferir(estado, resultado.motivo, TEXTOS.servidorNaoFederal, "servidor_outro", [], "servidor_outro");
  }
  if (resultado.tipo === "extrato_invalido") {
    return tentarDeNovo(estado, TEXTOS.extratoInvalido(produtoExtrato(estado)), "extrato_invalido", "extrato_invalido");
  }
  return mostrarResultado(estado, resultado, deps.agora());
}

async function pedirAutorizacao(
  estado: EstadoMaisa,
  deps: Dependencias,
  rotulo: string,
  reenvio = false,
  aviso?: string,
): Promise<Passo> {
  let resultado: ResultadoAutorizacao;
  try {
    resultado = await deps.solicitarAutorizacao(estado.nome ?? "");
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "falha no pedido de autorização";
    return transferir(estado, `erro no banco: ${motivo}`, TEXTOS.erroBanco, "erro_banco", [], "erro_banco");
  }

  if (resultado === "telefone_de_outro_cpf") {
    return transferir(estado, "o celular já está ligado a outro CPF no banco", TEXTOS.transferindo, rotulo, [], "telefone_outro_cpf");
  }
  if (resultado === "erro") {
    return transferir(estado, "erro no banco: pedido de autorização recusado", TEXTOS.erroBanco, rotulo, [], "erro_banco");
  }
  // Já autorizou nos últimos 30 dias: consulta direto.
  // Sem renovar de novo, para não ficar num ciclo se a Facta insistir em "expirado".
  if (resultado === "ja_autorizado") return consultarAgora(estado, deps, rotulo, true, false);

  const agora = deps.agora();
  return ir(estado, "aguardando", [aviso ?? (reenvio ? TEXTOS.linkReenviado : TEXTOS.avisoLink)], rotulo, [], {
    autorizacaoPedidaEm: reenvio && estado.autorizacaoPedidaEm ? estado.autorizacaoPedidaEm : agora.toISOString(),
    proximaVerificacao: new Date(agora.getTime() + 60_000).toISOString(),
    reenvios: reenvio ? (estado.reenvios ?? 0) + 1 : 0,
  });
}

// Consulta o banco. "avisar" = o cliente está esperando uma resposta agora.
async function consultarAgora(
  estado: EstadoMaisa,
  deps: Dependencias,
  rotulo: string,
  avisar: boolean,
  podeRenovar = true,
): Promise<Passo> {
  let resultado: ResultadoConsulta;
  try {
    resultado = await deps.consultar();
  } catch (err) {
    resultado = { tipo: "erro", banco: "desconhecido", motivo: err instanceof Error ? err.message : "falha na consulta" };
  }

  const agora = deps.agora();
  const pedidaEm = new Date(estado.autorizacaoPedidaEm ?? agora.toISOString());
  const esperando = { ...estado, etapa: "aguardando" as const, autorizacaoPedidaEm: pedidaEm.toISOString() };

  if (resultado.tipo === "nao_autorizado") {
    if (agora.getTime() - pedidaEm.getTime() > PRAZO_AUTORIZACAO_MS) {
      return transferir(esperando, "não autorizou o link do banco em 48 horas", null, rotulo, [], "link_nao_autorizado");
    }
    const proxima = proximaVerificacao(pedidaEm, agora);
    if (!avisar) return { estado: { ...esperando, proximaVerificacao: proxima }, respostas: [], efeitos: [], rotulo };
    // O cliente diz que autorizou, mas o banco ainda não mostra. Na terceira vez, a equipe ajuda.
    const tentativas = estado.tentativas + 1;
    if (tentativas > MAX_TENTATIVAS) {
      return transferir(esperando, "cliente diz que autorizou, mas o banco não mostra", TEXTOS.transferindo, rotulo, [], "link_nao_autorizado");
    }
    return { estado: { ...esperando, tentativas, proximaVerificacao: proxima }, respostas: [TEXTOS.aindaNaoAutorizou], efeitos: [], rotulo };
  }
  // O link venceu antes de o cliente autorizar: pede outro e avisa, até o limite de reenvios.
  if (resultado.tipo === "link_expirado") {
    if (!podeRenovar || (estado.reenvios ?? 0) >= MAX_REENVIOS) {
      return transferir(esperando, "o link do banco venceu e o pedido novo não resolveu", TEXTOS.transferindo, rotulo, [], "link_nao_autorizado");
    }
    return pedirAutorizacao(esperando, deps, "link_expirado", true, TEXTOS.linkVencido);
  }
  if (resultado.tipo === "indisponivel") {
    // Virada de folha: o banco volta em algumas horas. Checa de novo em 1 hora.
    const proximaEm = new Date(agora.getTime() + 60 * 60_000).toISOString();
    return { estado: { ...esperando, proximaVerificacao: proximaEm }, respostas: avisar ? [TEXTOS.viradaFolha] : [], efeitos: [], rotulo };
  }
  return mostrarResultado(esperando, resultado, agora);
}

async function etapaConsentimento(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const resposta = await deps.classificador.simNao(texto);
  if (resposta === "nao") return transferir(estado, "não autorizou a consulta", TEXTOS.semConsentimento, "nao_autorizou");
  if (resposta !== "sim") return ouvirCliente(estado, texto, deps);
  return pedirAutorizacao(estado, deps, "autorizou");
}

async function etapaAguardando(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  if (await deps.classificador.linkNaoChegou(texto)) {
    if ((estado.reenvios ?? 0) >= MAX_REENVIOS) {
      return transferir(estado, "o link do banco não chegou para o cliente", TEXTOS.transferindo, "link_nao_chegou", [], "link_nao_autorizado");
    }
    return pedirAutorizacao(estado, deps, "reenviar_link", true);
  }
  if (texto.includes("?") && buscarFaq(texto)) return foraDaEtapa(estado, texto);
  // Qualquer outra coisa ("autorizei", "pronto") faz ela olhar no banco na hora.
  return consultarAgora(estado, deps, "cliente_respondeu", true);
}

// Aceitou a port ou o refin: a equipe confirma o saldo na CIP e digita. Recusou: encerra.
async function etapaOfertaPort(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  // O modelo (com reserva nas regras) diz se aceitou, recusou, perguntou ou levantou objeção.
  const leitura = await deps.classificador.lerOferta(texto, contextoOfertaPort(estado));
  const resposta = leitura
    ? leitura.tipo === "aceita"
      ? "sim"
      : leitura.tipo === "recusa" && !leitura.objecao
        ? "nao"
        : null
    : await deps.classificador.simNao(texto);
  const motivo = estado.alternativa?.motivo ?? "portabilidade";
  const dig = estado.alternativa?.digitacao;
  if (leitura?.tipo === "humano") {
    return transferir(estado, "quer falar com uma pessoa", TEXTOS.transferindo, "humano", [], "objecao");
  }
  if (leitura?.tipo === "pensar") return { estado, respostas: [TEXTOS.semPressa], efeitos: [], rotulo: "pensando" };
  // Objeção, ou recusa com motivo: ela tenta contornar com os argumentos aprovados.
  if (leitura && (leitura.tipo === "objecao" || (leitura.tipo === "recusa" && leitura.objecao))) {
    return contornar(estado, texto, leitura);
  }
  // Com a simulação em mãos ela conduz: número do contrato, dados e, se a API permitir, a
  // digitação. Só passa para a equipe se travar no caminho.
  if (resposta === "sim" && dig && deps.digitacaoAtiva) {
    // O extrato já trouxe o número do contrato: vai direto para os dados.
    if (dig.numeroContrato) return iniciarColetaPort(estado, dig.numeroContrato, "aceitou_port", [TEXTOS.inicioContrato]);
    return ir(estado, "numero_contrato", [TEXTOS.pedeNumeroContrato(dig.banco, formatarReais(Math.round(dig.parcela * 100)))], "aceitou_port");
  }
  if (resposta === "sim") return transferir(estado, `aceitou: ${motivo}`, TEXTOS.aceitouPort, "aceitou_port", [], "alternativa");
  // NÃO, receio ou dúvida: a Facta já aprovou, é cliente para a equipe convencer.
  return objecao(estado, texto, resposta === "nao" ? "recusou a portabilidade" : "objeção na oferta de portabilidade", resposta === "nao");
}

// A oferta em texto, para o modelo entender a resposta do cliente.
function contextoOfertaPort(estado: EstadoMaisa): string {
  const a = estado.alternativa;
  const d = a?.digitacao;
  if (!a) return "oferta de portabilidade";
  const linhas = [`Operação: ${a.operacao === "port_refin" ? "portabilidade com refinanciamento (libera troco)" : "portabilidade (só baixa a parcela)"}.`];
  if (d) linhas.push(`Contrato: ${d.banco}, parcela ${r$(d.parcela)}, faltam ${d.prazoRestante} parcelas.`);
  if (d?.refin) linhas.push(`Na Facta: parcela ${r$(d.refin.parcela)} em ${d.refin.prazo} parcelas.`);
  if (a.trocoCentavos) linhas.push(`Troco: até ${formatarReais(a.trocoCentavos)}.`);
  for (const red of a.reducoes ?? []) linhas.push(`${red.banco}: parcela de ${r$(red.atual)} para ${r$(red.nova)}.`);
  return linhas.join("\n");
}

const MAX_CONTORNOS = 2;

// Contorna a objeção com os argumentos aprovados pelo dono e os números da simulação.
// Depois de duas tentativas, ou sem argumento para aquele caso, a equipe assume.
function contornar(estado: EstadoMaisa, texto: string, l: LeituraOferta): Passo {
  const a = estado.alternativa;
  const dig = a?.digitacao;
  const vezes = estado.contornos ?? 0;
  const motivo = `objeção (${l.objecao ?? "sem motivo"}): ${texto.slice(0, 120)}${l.outraOferta ? ` | outra oferta: ${l.outraOferta}` : ""}`;
  if (vezes >= MAX_CONTORNOS) {
    return transferir(estado, motivo, l.objecao === "desconfianca" ? TEXTOS.objecao : TEXTOS.recusaValor, "objecao", [], "objecao");
  }
  const fica = (respostas: string[], extra: Partial<EstadoMaisa> = {}): Passo => ({
    estado: { ...estado, ...extra, contornos: vezes + 1 },
    respostas,
    efeitos: [],
    rotulo: `contorno_${l.objecao}`,
  });
  switch (l.objecao) {
    case "desconfianca":
      return fica([TEXTOS.contornoConfianca, PERGUNTA_DA_ETAPA.oferta_port]);
    case "pouco_valor":
      if (a?.trocoCentavos && dig?.refin) return fica([TEXTOS.contornoPoucoValor(r$(dig.refin.parcela), formatarReais(a.trocoCentavos))]);
      break;
    case "prazo_longo":
      // Não quer esticar: oferece a port sem refin, que mantém as parcelas que faltam.
      if (a && dig?.refin && dig.port.parcela < dig.parcela) {
        const reducoes = [{ banco: dig.banco, atual: dig.parcela, nova: dig.port.parcela, restantes: dig.prazoRestante }];
        return fica([TEXTOS.contornoPrazo(dig.banco, dig.prazoRestante, r$(dig.parcela), r$(dig.port.parcela))], {
          alternativa: { ...a, operacao: "portabilidade", trocoCentavos: null, digitacao: { ...dig, refin: undefined }, reducoes },
        });
      }
      break;
    case "oferta_melhor":
      if (l.outraOferta) return transferir(estado, motivo, TEXTOS.ofertaMelhorEquipe, "objecao", [], "objecao");
      return fica([TEXTOS.perguntaOutraOferta]);
  }
  return transferir(estado, motivo, l.tipo === "recusa" ? TEXTOS.recusaValor : TEXTOS.duvidaParaEquipe, "objecao", [], "objecao");
}

// Número do contrato no banco de origem: a Facta precisa dele para comprar a dívida.
async function etapaNumeroContrato(estado: EstadoMaisa, texto: string): Promise<Passo> {
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/nao sei|nao tenho|nao lembro|nao acho|onde (vejo|acho|encontro)/.test(t)) {
    return transferir(estado, "não sabe o número do contrato", TEXTOS.semNumeroContrato, "sem_numero_contrato", [], "alternativa");
  }
  // Mandou o contrato de outro banco (ex.: Santander quando o pedido era o Hoje): não aceita.
  const banco = estado.alternativa?.digitacao?.banco ?? "";
  const outro = outroBancoCitado(t, banco);
  if (outro) {
    return tentarDeNovo(estado, TEXTOS.contratoOutroBanco(outro, banco), "contrato_outro_banco", "alternativa");
  }
  const numero = extrairNumeroContrato(texto);
  if (!numero) {
    return tentarDeNovo(estado, TEXTOS.numeroContratoInvalido, "numero_contrato_invalido", "alternativa");
  }
  return iniciarColetaPort(estado, numero, "numero_contrato", [TEXTOS.inicioContrato]);
}

// Começa o cadastro da port com o número do contrato em mãos. Renda, matrícula e conta
// salário já lidas do extrato entram preenchidas: ela não pergunta de novo.
function iniciarColetaPort(estado: EstadoMaisa, numero: string, rotulo: string, antes: string[]): Passo {
  const dados: DadosContrato = {};
  if (estado.alternativa?.renda) dados.renda = estado.alternativa.renda;
  if (estado.alternativa?.matricula) dados.matricula = estado.alternativa.matricula;
  if (estado.produto === "siape" && estado.alternativa?.contaSalario) Object.assign(dados, estado.alternativa.contaSalario);
  const pergunta = proximaPergunta(dados, produtoExtrato(estado))!;
  return ir(estado, "coleta", [...antes, pergunta], rotulo, [], {
    alternativa: { ...estado.alternativa!, numeroContrato: numero },
    contrato: { dados, pergunta },
  });
}

// O número do contrato: o maior trecho com pelo menos 4 dígitos ("Hoje 20250464573").
export function extrairNumeroContrato(texto: string): string | null {
  const trechos = (texto.match(/[0-9A-Za-z.\-/]+/g) ?? [])
    .map((x) => x.replace(/[^0-9A-Za-z]/g, ""))
    .filter((x) => x.length >= 5 && x.length <= 30 && (x.match(/\d/g) ?? []).length >= 4);
  return trechos.sort((a, b) => b.length - a.length)[0] ?? null;
}

// Bancos que o cliente costuma escrever. Usado só para perceber contrato de outro banco.
const NOMES_BANCO: [RegExp, string][] = [
  [/santander|\bole\b/, "Santander/Olé"],
  [/bradesc/, "Bradesco"],
  [/\bitau\b/, "Itaú"],
  [/\bcaixa\b|\bcef\b/, "Caixa"],
  [/banco do brasil|\bbb\b/, "Banco do Brasil"],
  [/\bpan\b/, "PAN"],
  [/\bbmg\b/, "BMG"],
  [/daycoval/, "Daycoval"],
  [/agibank/, "Agibank"],
  [/\bc6\b/, "C6"],
  [/digio/, "Digio"],
  [/safra/, "Safra"],
  [/mercantil/, "Mercantil"],
  [/\bhoje\b/, "Hoje"],
  [/\bqi\b/, "QI"],
  [/sabemi/, "SABEMI"],
  [/futuro/, "Futuro"],
  [/digimais/, "Digimais"],
];

// Nome do banco que o cliente citou, quando não é o do contrato pedido. null se não citou
// banco nenhum ou citou o certo.
function outroBancoCitado(t: string, bancoPedido: string): string | null {
  const pedido = bancoPedido.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const citados = NOMES_BANCO.filter(([re]) => re.test(t));
  if (!citados.length || citados.some(([re]) => re.test(pedido))) return null;
  return citados[0][1];
}

// Na oferta, o que não é SIM é objeção: dúvida com resposta pronta ela responde e repete a
// pergunta. O resto (receio, NÃO, pergunta sem resposta) vai para a equipe como lead quente.
const PENSANDO = /(pensar|pensando|depois|mais tarde|amanh|vou ver|ver com|conversar com|falar com (a|o|minha|meu))/i;

function objecao(estado: EstadoMaisa, texto: string, motivo: string, recusou = false): Passo {
  // "Deixa eu pensar" não é objeção: ela espera (follow-up e Carrinho cuidam do resto).
  if (PENSANDO.test(texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) && !texto.includes("?")) {
    return { estado, respostas: [TEXTOS.semPressa], efeitos: [], rotulo: "pensando" };
  }
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Receio de verdade pede acolhimento e a equipe, mesmo que fale de dinheiro.
  if (RECEIO.test(t)) return transferir(estado, motivo, TEXTOS.objecao, "objecao", [], "objecao");
  // Recusou (NÃO): nunca repetir a oferta. Pedido com resposta pronta (contato da Facta) ela
  // atende; senão a equipe tenta outra condição, com resposta que reconhece o motivo.
  if (recusou) {
    const faqRecusa = buscarFaq(texto);
    if (faqRecusa) return { estado, respostas: [faqRecusa, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "faq" };
    const motivoValor = /(pouco|baixo|pequeno|valor|troco|dinheiro|prazo|meses|mes|parcela|caro|juros|taxa)/.test(t);
    return transferir(estado, `${motivo}: ${texto.slice(0, 120)}`, motivoValor ? TEXTOS.recusaValor : TEXTOS.recusaSimples, "recusou", [], "objecao");
  }
  // Pergunta sobre a própria oferta: ela sabe a resposta, então responde com os números.
  const sobreOferta = respostaSobreOferta(estado, t);
  if (sobreOferta) return { estado, respostas: [sobreOferta, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "duvida_oferta" };
  const faq = buscarFaq(texto);
  if (faq) return { estado, respostas: [faq, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "faq" };
  // Dúvida que ela não sabe responder: chama a equipe, sem falar em preocupação.
  return transferir(estado, motivo, TEXTOS.duvidaParaEquipe, "objecao", [], "objecao");
}

const RECEIO = /(medo|receio|golpe|fraude|reclame|confia|seguro|segura|demora|nao libera|nao paga|enganad|desconfi|perigo|risco)/;

// Troco, dinheiro, valor, parcela, taxa: as perguntas que a oferta já responde.
function respostaSobreOferta(estado: EstadoMaisa, t: string): string | null {
  const a = estado.alternativa;
  const o = estado.oferta;
  const querDinheiro = /(troco|dinheiro|libera|recebo|receber|valor extra|sobra|quanto (eu )?(pego|ganho|recebo|cai))/.test(t);
  const querParcela = /(parcela|prestacao|desconto|quanto (vou )?pagar|taxa|juros|prazo|quantas vezes)/.test(t);
  // "Depende do qual", "qual contrato?", "de qual banco?": diz qual contrato e o que muda.
  const querContrato = /(qual|quais|que contrato|que banco)/.test(t);
  if (!querDinheiro && !querParcela && !querContrato) return null;

  if (a) {
    const red = a.reducoes?.[0];
    const dig = a.digitacao;
    if (querContrato && !querDinheiro && !querParcela) {
      if (dig) {
        return (
          `É o seu contrato do ${dig.banco}, o de parcela de ${r$(dig.parcela)}, que ainda tem ${dig.prazoRestante} parcelas. ` +
          (a.trocoCentavos
            ? `Ele foi o que deu o melhor resultado na simulação: você recebe até ${formatarReais(a.trocoCentavos)} na sua conta${dig.refin ? `, e a parcela continua ${r$(dig.refin.parcela)}` : ""}.`
            : red
              ? `Na Facta, a parcela dele cai para ${r$(red.nova)}.`
              : "Ele foi o que deu o melhor resultado na simulação.")
        );
      }
      if (red) {
        return `São estes contratos:\n${(a.reducoes ?? []).map((x) => `• ${x.banco}: de ${r$(x.atual)} para ${r$(x.nova)} por mês`).join("\n")}`;
      }
    }
    if (querDinheiro) {
      if (a.trocoCentavos) {
        return `Sim! Pela simulação na Facta, você recebe até ${formatarReais(a.trocoCentavos)} de dinheiro extra na sua conta. É uma estimativa: o valor final depende do saldo que o seu banco informar.`;
      }
      if (red) {
        return (
          `Nessa opção não sobra dinheiro extra para você. O ganho é na parcela: ela cai de ${r$(red.atual)} para ${r$(red.nova)}, ` +
          `uma economia de ${r$(red.atual - red.nova)} por mês${red.restantes ? `, ou ${r$((red.atual - red.nova) * red.restantes)} até o fim do contrato` : ""}.`
        );
      }
      return "Nessa opção não sobra dinheiro extra para você. O ganho é uma taxa menor no seu contrato.";
    }
    if (dig?.refin) {
      return `A parcela continua ${r$(dig.refin.parcela)}, em ${dig.refin.prazo} parcelas${dig.refin.taxa ? `, com taxa de ${dig.refin.taxa.toLocaleString("pt-BR")}% ao mês` : ""}. O contrato recomeça na Facta.`;
    }
    if (red) {
      return `A parcela cai de ${r$(red.atual)} para ${r$(red.nova)}${red.taxa ? `, com taxa de ${red.taxa.toLocaleString("pt-BR")}% ao mês` : ""}, e você continua com as mesmas parcelas que faltavam.`;
    }
    return null;
  }
  if (o) {
    return querDinheiro
      ? `Pela simulação, você recebe até ${formatarReais(o.valorCentavos)} na sua conta.`
      : `São ${o.prazoMeses} parcelas de ${formatarReais(o.parcelaCentavos)}.`;
  }
  return null;
}

async function etapaOferta(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const resposta = await deps.classificador.simNao(texto);
  // INSS e SIAPE com a digitação ligada: ela mesma faz o contrato.
  if (resposta === "sim" && porExtrato(estado.produto) && deps.digitacaoAtiva && estado.oferta?.tabela) {
    const dados: DadosContrato = {};
    if (estado.oferta.renda) dados.renda = estado.oferta.renda;
    if (estado.oferta.matricula) dados.matricula = estado.oferta.matricula;
    if (estado.produto === "siape" && estado.oferta.contaSalario) Object.assign(dados, estado.oferta.contaSalario);
    if (estado.produto === "inss" && estado.oferta.especie) dados.tipoBeneficio = String(estado.oferta.especie);
    const pergunta = proximaPergunta(dados, estado.produto)!;
    return ir(estado, "coleta", [TEXTOS.inicioContrato, pergunta], "aceitou_contrato", [], {
      contrato: { dados, pergunta },
      ofertaEm: undefined,
      followupEnviado: undefined,
    });
  }
  if (resposta === "sim") return transferir(estado, "aceitou a oferta", TEXTOS.aceitou, "aceitou");
  if (resposta === "nao") return transferir(estado, "recusou a oferta", TEXTOS.recusou, "recusou");
  return objecao(estado, texto, "objeção na oferta", false);
}

// Cada resposta do cliente (texto, foto do documento ou áudio já transcrito) preenche
// o que der do cadastro. Falta algo: pergunta o próximo. Completo: mostra o resumo.
async function etapaColeta(estado: EstadoMaisa, entrada: { texto: string | null; documento?: boolean }, deps: Dependencias): Promise<Passo> {
  const produto = produtoExtrato(estado);
  const dados = estado.contrato?.dados ?? {};
  const pergunta = estado.contrato?.pergunta ?? proximaPergunta(dados, produto) ?? TEXTOS.continuarCadastro;
  const texto = entrada.texto?.trim() ?? "";
  // No meio da coleta o cliente mandou o número do contrato do banco certo ("Hoje 2025..."):
  // anota no lugar do anterior e segue com a mesma pergunta.
  const dig = estado.alternativa?.digitacao;
  if (dig && texto && !entrada.documento) {
    const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const citaBancoPedido = NOMES_BANCO.some(
      ([re]) => re.test(t) && re.test(dig.banco.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()),
    );
    const numero = citaBancoPedido ? extrairNumeroContrato(texto) : null;
    if (numero) {
      return {
        estado: { ...estado, alternativa: { ...estado.alternativa!, numeroContrato: numero } },
        respostas: [TEXTOS.contratoAnotado(dig.banco, numero), pergunta],
        efeitos: [],
        rotulo: "numero_contrato_corrigido",
      };
    }
  }
  if (!entrada.documento && texto.includes("?") && buscarFaq(texto)) return foraDaEtapa(estado, texto);

  let novos: DadosContrato;
  try {
    novos = await deps.extrairDados(pergunta, entrada, camposFaltando(dados, produto));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "falha ao ler a resposta";
    return transferir(estado, `erro na coleta dos dados: ${motivo}`, TEXTOS.erroDigitacao, "erro_coleta", [], "erro_digitacao");
  }
  if (novos.pixCpf === false) {
    return transferir(estado, "não quer receber por PIX no CPF", TEXTOS.pixRecusado, "pix_recusado", [], "dados_contrato");
  }

  const junto = { ...dados, ...novos };
  const proxima = proximaPergunta(junto, produto);
  if (!proxima) {
    return ir(estado, "confirmacao", [TEXTOS.confirmaDados(resumoDados(junto))], "dados_completos", [], {
      contrato: { dados: junto, pergunta: TEXTOS.perguntaConfirmacao },
    });
  }
  if (!Object.keys(novos).length) {
    return tentarDeNovo({ ...estado, contrato: { dados, pergunta } }, `${TEXTOS.naoEntendi} ${pergunta}`, "dado_nao_entendido", "dados_contrato");
  }
  return ir(estado, "coleta", [proxima], "dado_recebido", [], { contrato: { dados: junto, pergunta: proxima } });
}

async function etapaConfirmacao(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const resposta = await deps.classificador.simNao(texto);
  if (resposta === "nao") return transferir(estado, "cliente quer corrigir os dados", TEXTOS.corrigirDados, "corrigir_dados", [], "dados_contrato");
  if (resposta !== "sim") return foraDaEtapa(estado, texto);

  // Port pura ou banco de origem sem código: a API da Facta não digita. Tudo coletado, a
  // equipe só cadastra no portal Agente Facta com os dados da nota.
  const dig = estado.alternativa?.digitacao;
  if (estado.alternativa && (!dig?.refin || !dig.bancoCodigo)) {
    const motivo = !dig?.refin
      ? "port pura aceita, a API da Facta não digita port sem refin: cadastrar no portal Agente Facta"
      : "banco de origem sem código conhecido: cadastrar no portal Agente Facta";
    return transferir(estado, motivo, TEXTOS.portProntaEquipe, "port_pronta", [], "alternativa");
  }

  let resultado: ResultadoContratacao;
  try {
    resultado = await deps.digitar(estado.contrato?.dados ?? {});
  } catch (err) {
    resultado = { tipo: "erro", etapa: "sistema", mensagem: err instanceof Error ? err.message : "falha na digitação" };
  }
  if (resultado.tipo === "erro") {
    return transferir(estado, `erro na digitação (${resultado.etapa}): ${resultado.mensagem}`, TEXTOS.erroDigitacao, "erro_digitacao");
  }
  return transferir(estado, `proposta ${resultado.codigoAf} digitada na Facta`, TEXTOS.contratoEnviado(resultado.url), "contrato_enviado", [
    { tipo: "proposta", codigoAf: resultado.codigoAf },
  ]);
}

const FOLLOWUP_MS = 10 * 60_000;
const CARRINHO_MS = 24 * 60 * 60_000;

// Oferta sem resposta. 10 minutos: uma mensagem só, para retomar. 24 horas: sai da
// Maisa e entra no Carrinho, para alguém da equipe ligar. O relógio conta a partir da
// última mensagem do cliente, ou da oferta se ele não escreveu nada depois.
function verificarOferta(estado: EstadoMaisa, agora: Date): Passo {
  const parado: Passo = { estado, respostas: [], efeitos: [], rotulo: "nada_a_verificar" };
  if (estado.etapa !== "oferta" || !estado.ofertaEm) return parado;
  const desde = Math.max(new Date(estado.ofertaEm).getTime(), estado.ultimoContatoCliente ? new Date(estado.ultimoContatoCliente).getTime() : 0);
  const passou = agora.getTime() - desde;
  if (passou >= CARRINHO_MS) {
    return transferir(estado, "não respondeu a oferta em 24 horas", null, "carrinho", [], "carrinho");
  }
  if (passou >= FOLLOWUP_MS && !estado.followupEnviado) {
    return { estado: { ...estado, followupEnviado: true }, respostas: [TEXTOS.followupOferta], efeitos: [], rotulo: "followup_oferta" };
  }
  return parado;
}

export async function avancar(atual: EstadoMaisa | null, entrada: Entrada, deps: Dependencias): Promise<Passo> {
  let estado: EstadoMaisa = atual ?? { etapa: "inicio", tentativas: 0 };
  if (estado.etapa === "finalizada") return { estado, respostas: [], efeitos: [], rotulo: "ja_finalizada" };

  // Checagens automáticas do relógio.
  if ("evento" in entrada) {
    if (entrada.evento === "verificar_oferta") return verificarOferta(estado, deps.agora());
    if (estado.etapa !== "aguardando") return { estado, respostas: [], efeitos: [], rotulo: "nada_a_verificar" };
    return consultarAgora(estado, deps, "verificacao_automatica", false);
  }

  // O cliente falou durante a oferta: o relógio do follow-up recomeça daqui.
  if (estado.etapa === "oferta") estado = { ...estado, ultimoContatoCliente: deps.agora().toISOString() };

  // Na etapa do extrato, PDF ou foto é o que ela pediu. Fora dela, arquivo vai para a equipe.
  if (estado.etapa === "extrato" && entrada.documento) return etapaExtrato(estado, entrada, deps);
  // Extrato antes da hora (INSS ou SIAPE, ainda no CPF, nome ou data): guarda e pede o que falta.
  if (entrada.documento && entrada.documentoId && porExtrato(estado.produto) && ["cpf", "nome", "nascimento"].includes(estado.etapa)) {
    return {
      estado: { ...estado, extratoPendenteId: entrada.documentoId },
      respostas: [TEXTOS.extratoGuardado, PERGUNTA_DA_ETAPA[estado.etapa]],
      efeitos: [],
      rotulo: "extrato_antecipado",
    };
  }
  if (estado.etapa === "coleta" && entrada.documento) return etapaColeta(estado, entrada, deps);
  if (entrada.temMidia) return transferir(estado, "cliente enviou arquivo", TEXTOS.midiaRecebida, "midia");

  const texto = entrada.texto?.trim() ?? "";
  if (!texto) return { estado, respostas: [], efeitos: [], rotulo: "vazia" };

  // Pedir uma pessoa vale em qualquer etapa.
  if (await deps.classificador.pedeHumano(texto)) {
    return transferir(estado, "pediu atendente", TEXTOS.transferindo, "humano");
  }

  // Pedido de instruções internas ou credenciais: resposta padrão e volta à pergunta da
  // etapa, sem explicar a regra. O rótulo fica no registro da Maisa como auditoria.
  if (await deps.classificador.tentativaExtracao(texto)) {
    const pergunta = PERGUNTA_DA_ETAPA[estado.etapa];
    return { estado, respostas: pergunta ? [TEXTOS.seguranca, pergunta] : [TEXTOS.seguranca], efeitos: [], rotulo: "tentativa_extracao" };
  }

  switch (estado.etapa) {
    case "inicio":
      return etapaInicio(estado, texto, deps);
    case "convenio":
      return etapaConvenio(estado, texto, deps);
    case "cpf":
      return etapaCpf(estado, texto, deps);
    case "nome":
      return etapaNome(estado, texto);
    case "consentimento":
      return etapaConsentimento(estado, texto, deps);
    case "aguardando":
      return etapaAguardando(estado, texto, deps);
    case "nascimento":
      return etapaNascimento(estado, texto, deps);
    case "extrato":
      return etapaExtrato(estado, { texto }, deps);
    case "oferta":
      return etapaOferta(estado, texto, deps);
    case "oferta_port":
      return etapaOfertaPort(estado, texto, deps);
    case "numero_contrato":
      return etapaNumeroContrato(estado, texto);
    case "coleta":
      return etapaColeta(estado, { texto }, deps);
    case "confirmacao":
      return etapaConfirmacao(estado, texto, deps);
    case "finalizada":
      return { estado, respostas: [], efeitos: [], rotulo: "ja_finalizada" };
  }
}
