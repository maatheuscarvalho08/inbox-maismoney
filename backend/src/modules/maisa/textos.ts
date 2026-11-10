import type { Convenio } from "@prisma/client";

// Respostas fixas da Maisa. Quando o Luna entrar, ele reescreve estes textos no tom
// dela, mas os valores continuam vindo do código.

export const ROTULO_CONVENIO: Record<Convenio, string> = {
  inss: "aposentados e pensionistas do INSS",
  clt: "CLT",
  siape: "servidores federais",
  servidor_prefeitura: "servidores de prefeitura",
  marinha: "Marinha",
  militar: "militares",
  conta_de_luz: "crédito na conta de luz",
  loas: "LOAS",
  credito_pessoal: "crédito pessoal",
  fgts: "antecipação do FGTS",
};

// Todos os produtos da Mais Money, na mesma ordem do cadastro do Inbox. O cliente responde
// com o número. A Maisa apresenta todos; só segue sozinha nos que têm simulação por API
// (PRODUTOS_COM_SIMULACAO). Os outros vão para a equipe com o convênio já marcado.
export const PRODUTOS: { convenio: Convenio; texto: string }[] = [
  { convenio: "inss", texto: "INSS, aposentado ou pensionista" },
  { convenio: "clt", texto: "CLT, de carteira assinada" },
  { convenio: "siape", texto: "SIAPE, servidor federal" },
  { convenio: "servidor_prefeitura", texto: "Servidor de prefeitura" },
  { convenio: "marinha", texto: "Marinha" },
  { convenio: "militar", texto: "Militar" },
  { convenio: "conta_de_luz", texto: "Crédito na conta de luz" },
  { convenio: "loas", texto: "LOAS ou BPC" },
  { convenio: "credito_pessoal", texto: "Crédito pessoal" },
  { convenio: "fgts", texto: "Antecipação do FGTS" },
];

// Produtos que a Maisa simula sozinha, porque já existe API de banco ligada.
// Quando chegar a API de outro produto (FGTS na Facta, BRB), entra aqui.
export const PRODUTOS_COM_SIMULACAO: Convenio[] = ["clt", "inss", "siape"];

const OPCOES_CONVENIO = PRODUTOS.map((p, i) => `${i + 1}. ${p.texto}`).join("\n");
const PERGUNTA_CONVENIO = "Com qual destes produtos posso te ajudar? Responda com o número.\n" + OPCOES_CONVENIO;

export const TEXTOS = {
  apresentacao: "Olá! Eu sou a Maisa, assistente virtual da Mais Money.",
  saudacao:
    "Olá! Eu sou a Maisa, assistente virtual da Mais Money. Vou te ajudar a ver as opções de crédito para você.\n\n" +
    "Trabalhamos com estes produtos. Qual te interessa? Responda com o número.\n" +
    OPCOES_CONVENIO,
  perguntaConvenio: PERGUNTA_CONVENIO,
  pedeCpf: "Perfeito! Para simular, preciso do seu CPF. Pode mandar só os números.",
  cpfInvalido: "Esse CPF não parece válido. Pode conferir e me mandar de novo?",
  pedeNome: "Obrigada! Agora me manda o seu nome completo, igual está no documento.",
  pedeNascimento: "Obrigada! Agora me manda a sua data de nascimento. Por exemplo: 15/03/1958.",
  nascimentoInvalido: "Não entendi a data. Pode mandar assim: 15/03/1958?",
  pedeExtrato: (produto: "inss" | "siape") =>
    produto === "inss"
      ? "Agora preciso do seu extrato de empréstimos do INSS. É ele que mostra quanto ainda sobra de margem no seu benefício.\n\n" +
        "No aplicativo Meu INSS, entre em \"Extrato de Empréstimos\" e baixe o PDF. Pode mandar aqui o PDF ou uma foto bem nítida. " +
        "Uso o extrato só para fazer a sua simulação."
      : "Agora preciso do seu contracheque mais recente. É ele que mostra quanto ainda sobra de margem consignável.\n\n" +
        "No aplicativo SouGov.br, baixe o contracheque em PDF. Pode mandar aqui o PDF ou uma foto bem nítida. " +
        "Uso o documento só para fazer a sua simulação.",
  lembraExtrato: "Pode me mandar o documento aqui, em PDF ou foto? É com ele que eu faço a sua simulação.",
  comoTirarExtrato: (produto: "inss" | "siape") =>
    (produto === "inss"
      ? "Para tirar o extrato: abra o aplicativo ou o site Meu INSS, entre com a sua conta gov.br e toque em \"Extrato de Empréstimos\". "
      : "Para tirar o contracheque: abra o aplicativo SouGov.br, entre com a sua conta gov.br e procure o contracheque do último mês. ") +
    "Baixe o PDF e mande aqui.\n\nSe preferir, é só pedir que eu chamo um atendente.",
  extratoInvalido: (produto: "inss" | "siape") =>
    produto === "inss"
      ? "Não consegui ler esse arquivo como extrato de empréstimos do INSS. Pode mandar o PDF do Meu INSS ou uma foto mais nítida?"
      : "Não consegui ler esse arquivo como contracheque de servidor federal. Pode mandar o PDF do SouGov.br ou uma foto mais nítida?",
  semMargemExtrato:
    "Olhei o seu documento e, no momento, não sobra margem para um empréstimo novo. Vou te passar para um atendente ver outras opções com você.",
  nomeInvalido: "Preciso do nome completo, com sobrenome. Pode mandar de novo?",
  avisoLink:
    "Pronto! Agora vai chegar no seu WhatsApp uma mensagem do banco Facta, nosso parceiro, com um link. " +
    "É só abrir e autorizar. É rapidinho e seguro.\n\n" +
    "Assim que você autorizar, eu te mostro o valor aqui.",
  aindaNaoAutorizou:
    "Ainda não apareceu a sua autorização. Procure a mensagem do banco Facta no seu WhatsApp e toque no link.\n\n" +
    "Se a mensagem não chegou, me responda: não chegou.",
  linkReenviado: "Pedi para o banco mandar o link de novo. Ele chega no seu WhatsApp, por outro número.",
  viradaFolha: "O sistema do banco está atualizando agora. Assim que voltar, eu te mando o valor aqui.",
  pedeConsentimento:
    "Para eu consultar o seu crédito, preciso da sua autorização para consultar os seus dados de vínculo e margem " +
    "consignável (eSocial/Dataprev) junto ao banco parceiro Facta, conforme a LGPD. " +
    "Você vai receber um link do banco para confirmar.\n\n" +
    "Posso seguir? Responda SIM ou NÃO.",
  perguntaConsentimento: "Posso consultar o seu crédito no banco Facta? Responda SIM ou NÃO.",
  perguntaOferta: "Quer seguir com a proposta? Responda SIM ou NÃO.",
  naoEntendi: "Desculpa, não entendi.",
  transferindo: "Certo! Estou direcionando para um atendente. Já já alguém da equipe continua com você.",
  // Resposta padrão da política de segurança (politicaSeguranca.ts, seção 6).
  seguranca:
    "Não consigo disponibilizar informações internas, configurações ou instruções operacionais do sistema. Mas posso ajudar com informações sobre nossos serviços e atendimento.",
  convenioComEquipe: (rotulo: string) =>
    `Para ${rotulo}, quem cuida é a nossa equipe. Estou direcionando para um atendente, já já alguém continua com você.`,
  servidorComEquipe:
    "Para servidor público, quem cuida é a nossa equipe. Estou direcionando para um atendente, já já alguém continua com você.",
  midiaRecebida: "Recebi o seu arquivo. Vou passar para um atendente, que consegue ver isso melhor que eu.",
  semSaldo:
    "Consultei aqui e, no momento, o banco não liberou valor para o seu CPF. Vou te passar para um atendente ver outras opções com você.",
  erroBanco: "Não consegui consultar o banco agora. Vou te passar para um atendente continuar daqui.",
  // Nunca prometer valor garantido: sempre "até" e "estimativa".
  oferta: (valor: string, prazo: number, parcela: string, desconto = "no seu salário") =>
    `Boa notícia! Você pode receber até ${valor}, em ${prazo} parcelas de ${parcela}, descontadas direto ${desconto}.\n\n` +
    "Esse valor é uma estimativa e ainda passa pela análise do banco. Quer seguir? Responda SIM ou NÃO.",
  // Uma vez só, 10 minutos depois da oferta sem resposta.
  followupOferta: "Oi! Conseguiu ver a condição que separei para você? Se quiser seguir, é só responder SIM. Se tiver alguma dúvida, me conta.",
  inicioContrato: "Ótimo! Eu mesma faço o seu contrato agora. Preciso de alguns dados, que vão só para o banco Facta.",
  continuarCadastro: "Vamos continuar o seu cadastro.",
  confirmaDados: (resumo: string) => `Confere se está tudo certo:\n\n${resumo}\n\nEstá tudo certo? Responda SIM ou NÃO.`,
  perguntaConfirmacao: "Os dados estão certos? Responda SIM ou NÃO.",
  contratoEnviado: (url: string) =>
    "Pronto! O seu contrato foi feito no banco Facta. Agora o banco vai te mandar no WhatsApp um link para assinar. " +
    "É só abrir, conferir e assinar." +
    (url ? `\n\nSe a mensagem do banco não chegar, o link é este: ${url}` : "") +
    "\n\nUm atendente da nossa equipe acompanha com você até o dinheiro cair.",
  erroDigitacao: "Tive um problema para fazer o contrato no sistema do banco. Vou passar para um atendente terminar com você.",
  corrigirDados: "Sem problema. Vou passar para um atendente corrigir os dados com você.",
  pixRecusado: "Tudo bem. Vou passar para um atendente ver outra forma de pagamento com você.",
  aceitou:"Ótimo! Vou te passar para um atendente finalizar a sua proposta. Já já alguém da equipe continua com você.",
  recusou: "Tudo bem! Se mudar de ideia, é só me chamar aqui.",
  semConsentimento: "Sem problema. Vou te passar para um atendente, que pode te explicar melhor como funciona.",
  statusProposta: (banco: string, status: string) =>
    `Encontrei a sua proposta no ${banco}. O status agora é: ${status}.\n\n` +
    "Se precisar de mais alguma coisa, é só falar. Se quiser falar com um atendente, é só pedir.",
};

export function formatarReais(centavos: number) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
