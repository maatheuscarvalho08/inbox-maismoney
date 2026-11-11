// Coleta dos dados que a Facta pede para digitar a proposta (etapa 2 do manual), em
// grupos, na ordem em que a Maisa pergunta. Este arquivo só decide o que falta e como
// perguntar. Quem entende a resposta do cliente é coleta.ts.

export interface DadosContrato {
  nome?: string;
  rg?: string;
  orgaoEmissor?: string;
  estadoRg?: string;
  dataExpedicao?: string; // AAAA-MM-DD
  nomeMae?: string;
  nomePai?: string;
  cidadeNatural?: string; // código Facta
  cidadeNaturalNome?: string;
  estadoNatural?: string;
  sexo?: "M" | "F";
  estadoCivil?: string; // código Facta
  estadoCivilNome?: string;
  cep?: string;
  numero?: string;
  complemento?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string; // código Facta
  cidadeNome?: string;
  estado?: string;
  email?: string;
  matricula?: string;
  tipoCreditoNb?: "1" | "2";
  renda?: number;
  tipoBeneficio?: string;
  valorPatrimonio?: string;
  pixCpf?: boolean;
  // SIAPE: o crédito cai na conta em que o servidor recebe o salário.
  bancoConta?: string; // código do banco
  agencia?: string;
  conta?: string;
}

export type CampoContrato = keyof DadosContrato;
type ProdutoContrato = "inss" | "siape";

export const ROTULO_CAMPO: Partial<Record<CampoContrato, string>> = {
  nome: "nome completo",
  rg: "número do RG",
  orgaoEmissor: "órgão emissor do RG",
  estadoRg: "estado que emitiu o RG",
  dataExpedicao: "data de expedição do RG",
  nomeMae: "nome da mãe",
  nomePai: "nome do pai",
  cidadeNatural: "cidade onde nasceu",
  estadoNatural: "estado onde nasceu",
  cep: "CEP",
  numero: "número da casa",
  endereco: "nome da rua",
  bairro: "bairro",
  bancoConta: "banco da conta salário",
  agencia: "agência",
  conta: "número da conta",
};

interface Grupo {
  id: string;
  campos: CampoContrato[];
  pergunta: (produto: ProdutoContrato) => string;
  so?: ProdutoContrato;
}

export const GRUPOS: Grupo[] = [
  {
    id: "documento",
    campos: ["nome", "rg", "orgaoEmissor", "estadoRg", "dataExpedicao", "nomeMae", "nomePai"],
    pergunta: () => "Me manda uma foto do seu RG ou da CNH, com frente e verso. Pode ser em duas fotos.",
  },
  {
    id: "naturalidade",
    campos: ["cidadeNatural", "estadoNatural"],
    pergunta: () => "Em qual cidade e estado você nasceu?",
  },
  { id: "sexo", campos: ["sexo"], pergunta: () => "Como está no seu documento: sexo masculino ou feminino?" },
  {
    id: "estadoCivil",
    campos: ["estadoCivil"],
    pergunta: () => "Qual o seu estado civil? Solteiro, casado, união estável, divorciado ou viúvo?",
  },
  {
    id: "endereco",
    campos: ["cep", "numero"],
    pergunta: () => "Qual o CEP da sua casa e o número? Se tiver complemento, como apartamento ou bloco, manda também.",
  },
  { id: "rua", campos: ["endereco", "bairro"], pergunta: () => "Não achei a rua pelo CEP. Qual o nome da rua e o bairro?" },
  { id: "email", campos: ["email"], pergunta: () => "Qual o seu e-mail?" },
  {
    id: "matricula",
    campos: ["matricula"],
    pergunta: (p) =>
      p === "inss"
        ? "Qual o número do seu benefício? Ele aparece no extrato do Meu INSS e tem 10 dígitos."
        : "Qual a sua matrícula SIAPE? Ela aparece no SouGov.br e no seu extrato de consignações.",
  },
  {
    id: "credito",
    campos: ["tipoCreditoNb"],
    so: "inss",
    pergunta: () => "Você recebe o benefício em conta corrente ou com cartão magnético?",
  },
  {
    id: "renda",
    campos: ["renda"],
    pergunta: (p) => (p === "inss" ? "Qual o valor bruto do seu benefício?" : "Qual o seu salário bruto?"),
  },
  {
    id: "especie",
    campos: ["tipoBeneficio"],
    so: "inss",
    pergunta: () => "Qual a espécie do seu benefício? É o número que aparece no extrato, por exemplo 41 ou 42.",
  },
  {
    id: "pix",
    campos: ["pixCpf"],
    so: "inss",
    pergunta: () => "O dinheiro cai por PIX, na chave do seu CPF. Pode ser assim? Responda SIM ou NÃO.",
  },
  {
    // No SIAPE o crédito vai obrigatoriamente para a conta salário (roteiro da Facta).
    id: "conta",
    campos: ["bancoConta", "agencia", "conta"],
    so: "siape",
    pergunta: () =>
      "O dinheiro cai na mesma conta em que você recebe o salário. Qual o banco, a agência e o número dessa conta? Se preferir, pode mandar uma foto do cartão ou do contracheque.",
  },
];

const gruposDo = (produto: ProdutoContrato) => GRUPOS.filter((g) => !g.so || g.so === produto);

const falta = (dados: DadosContrato, campo: CampoContrato) => dados[campo] === undefined || dados[campo] === "";

export function camposFaltando(dados: DadosContrato, produto: ProdutoContrato): CampoContrato[] {
  return gruposDo(produto).flatMap((g) => g.campos.filter((c) => falta(dados, c)));
}

// A próxima pergunta. Grupo pela metade (a foto não mostrou tudo): pede só o que faltou.
export function proximaPergunta(dados: DadosContrato, produto: ProdutoContrato): string | null {
  for (const g of gruposDo(produto)) {
    const faltando = g.campos.filter((c) => falta(dados, c));
    if (!faltando.length) continue;
    if (faltando.length === g.campos.length || g.id === "endereco") return g.pergunta(produto);
    const nomes = faltando.map((c) => ROTULO_CAMPO[c] ?? c);
    const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0];
    return `Quase lá! Não consegui ver: ${lista}. Pode me mandar por escrito?`;
  }
  return null;
}

const dataBr = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "");

// O que o cliente confere antes de a Maisa digitar. Sem CPF nem RG completo.
export function resumoDados(d: DadosContrato): string {
  const endereco = [d.endereco, d.numero, d.complemento].filter(Boolean).join(", ");
  return [
    `Nome: ${d.nome}`,
    `Naturalidade: ${d.cidadeNaturalNome}/${d.estadoNatural}`,
    `RG: final ${String(d.rg).slice(-3)}, ${d.orgaoEmissor}/${d.estadoRg}, expedido em ${dataBr(d.dataExpedicao)}`,
    `Mãe: ${d.nomeMae}`,
    `Pai: ${d.nomePai}`,
    `Estado civil: ${d.estadoCivilNome}`,
    `Endereço: ${endereco}, ${d.bairro}, ${d.cidadeNome}/${d.estado}, CEP ${d.cep}`,
    `E-mail: ${d.email}`,
    ...(d.conta ? [`Conta para receber: banco ${d.bancoConta}, agência ${d.agencia}, conta final ${String(d.conta).slice(-3)}`] : []),
  ].join("\n");
}
