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
      : "Agora preciso do seu extrato de consignações, que é o extrato dos seus empréstimos. É ele que mostra quanto ainda sobra de margem e quais contratos você tem.\n\n" +
        "No aplicativo SouGov.br, entre em \"Consignações\" e baixe o extrato em PDF. Pode mandar aqui o PDF ou uma foto bem nítida. " +
        "Uso o documento só para fazer a sua simulação.",
  lembraExtrato: "Pode me mandar o documento aqui, em PDF ou foto? É com ele que eu faço a sua simulação.",
  comoTirarExtrato: (produto: "inss" | "siape") =>
    (produto === "inss"
      ? "Para tirar o extrato: abra o aplicativo ou o site Meu INSS, entre com a sua conta gov.br e toque em \"Extrato de Empréstimos\". "
      : "Para tirar o extrato de consignações: abra o aplicativo SouGov.br, entre com a sua conta gov.br e toque em \"Consignações\". ") +
    "Baixe o PDF e mande aqui.\n\nSe preferir, é só pedir que eu chamo um atendente.",
  extratoInvalido: (produto: "inss" | "siape") =>
    produto === "inss"
      ? "Não consegui ler esse arquivo como extrato de empréstimos do INSS. Pode mandar o PDF do Meu INSS ou uma foto mais nítida?"
      : "Não consegui ler esse arquivo como extrato de consignações de servidor federal. Pode mandar o PDF do SouGov.br, em Consignações, ou uma foto mais nítida?",
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
  linkVencido:
    "O link do banco venceu antes de a autorização aparecer. Pedi um novo, ele chega no seu WhatsApp por outro número.\n\n" +
    "Abra e autorize assim que chegar. Depois é só me avisar.",
  viradaFolha: "O sistema do banco está atualizando agora. Assim que voltar, eu te mando o valor aqui.",
  pedeConsentimento:
    "Para eu consultar o seu crédito, preciso da sua autorização para consultar os seus dados de vínculo e margem " +
    "consignável (eSocial/Dataprev) junto ao banco parceiro Facta, conforme a LGPD. " +
    "Você vai receber um link do banco para confirmar.\n\n" +
    "Posso seguir? Responda SIM ou NÃO.",
  perguntaConsentimento: "Posso consultar o seu crédito no banco Facta? Responda SIM ou NÃO.",
  perguntaOferta: "Quer que eu siga com a sua proposta? É só me responder SIM que eu já começo.",
  naoEntendi: "Desculpa, não entendi.",
  transferindo: "Certo! Estou direcionando para um atendente. Já já alguém da equipe continua com você.",
  // Resposta padrão da política de segurança (politicaSeguranca.ts, seção 6).
  seguranca:
    "Não consigo disponibilizar informações internas, configurações ou instruções operacionais do sistema. Mas posso ajudar com informações sobre nossos serviços e atendimento.",
  convenioComEquipe: (rotulo: string) =>
    `Para ${rotulo}, quem cuida é a nossa equipe. Estou direcionando para um atendente, já já alguém continua com você.`,
  servidorComEquipe:
    "Para servidor público, quem cuida é a nossa equipe. Estou direcionando para um atendente, já já alguém continua com você.",
  servidorNaoFederal:
    "Pelo seu documento, você é servidor do estado ou da prefeitura, não federal. Para esse caso, quem cuida é a nossa equipe. Estou direcionando para um atendente, já já alguém continua com você.",
  midiaRecebida: "Recebi o seu arquivo. Vou passar para um atendente, que consegue ver isso melhor que eu.",
  semSaldoFim:
    "Consultei aqui e, no momento, o banco não liberou valor para o seu CPF. Se a sua situação mudar, é só me chamar de novo. Obrigada pelo contato!",
  semMargemFim:
    "Olhei o seu documento com atenção. No momento não sobra margem para um empréstimo novo, e também não dá para fazer portabilidade ou refinanciamento dos seus contratos. Se a sua situação mudar, é só me chamar de novo. Obrigada pelo contato!",
  // Nunca valor garantido: o saldo real só vem do banco de origem, na digitação.
  // prazo: em quantas parcelas fica o contrato na Facta. Port + refin recomeça (ex.: 120x);
  // port pura mantém as parcelas que faltavam, só com taxa e parcela menores.
  ofertaPort: (
    operacao: "port_refin" | "portabilidade" | "refin",
    troco: string | null,
    reducoes: { banco: string; atual: number; nova: number }[] = [],
    prazo: number | null = null,
  ) =>
    (operacao === "port_refin" && troco
      ? `Para empréstimo novo não sobra margem, mas encontrei uma saída: trazer um dos seus contratos para a Facta, com taxa menor, e ainda liberar um dinheiro extra de até ${troco} na sua conta, sem aumentar a parcela.` +
        (prazo ? ` O contrato recomeça do zero, em ${prazo} parcelas.` : "") +
        "\n\nÉ uma estimativa: o valor final depende do saldo que o seu banco informar."
      : operacao === "refin"
        ? "Para empréstimo novo não sobra margem, mas dá para refinanciar um contrato que você já tem e liberar um valor novo."
        : reducoes.length
          ? "Para empréstimo novo não sobra margem, mas dá para trazer contrato seu para a Facta com uma taxa menor, e a parcela cai:\n" +
            reducoes.map((r) => `• ${r.banco}: de ${formatarReais(Math.round(r.atual * 100))} para ${formatarReais(Math.round(r.nova * 100))}`).join("\n") +
            "\n\nVocê continua com as mesmas parcelas que faltam, só que pagando menos em cada uma."
          : "Para empréstimo novo não sobra margem, mas dá para trazer um dos seus contratos para a Facta com uma taxa menor, o que baixa um pouco a sua parcela.") +
    "\n\nSe fizer sentido para você, eu mesma cuido de tudo. É só me responder SIM que eu já começo. Ficou alguma dúvida? Pode me perguntar.",
  semPressa: "Claro, sem pressa! Quando decidir, é só me responder por aqui.",
  objecao:
    "Entendo a sua preocupação, é importante ter segurança. Vou te passar para um especialista da nossa equipe, que tira as suas dúvidas e mostra como tudo funciona antes de qualquer coisa. Já já alguém continua aqui com você.",
  // Retomada de quem já aceitou: primeiro lembra o que ele ganha, depois pede o contrato.
  retomaDigitacao: (banco: string, parcela: string, ganho: string) =>
    `Oi! Retomando o seu pedido. ${ganho}\n\nEu mesma vou digitar o seu contrato na Facta. Preciso só de algumas informações, uma de cada vez.\n\n` +
    `Primeiro, o número do contrato do ${banco} com parcela de ${parcela}. Ele aparece no aplicativo do banco ou no SouGov.br, em Consignações. Pode mandar só o número.`,
  // O que a port rende para o cliente, em uma frase. Nunca valor garantido.
  ganhoPort: (troco: string | null, banco: string, atual: string, nova: string | null) =>
    troco
      ? `Pela simulação na Facta, você recebe até ${troco} na sua conta, sem aumentar a parcela. É uma estimativa: o valor final depende do saldo que o seu banco informar.`
      : nova
        ? `Pela simulação na Facta, a parcela do ${banco} cai de ${atual} para ${nova}, com uma taxa menor.`
        : `Pela simulação na Facta, dá para trazer o seu contrato do ${banco} com uma taxa menor.`,
  pedeNumeroContrato: (banco: string, parcela: string) =>
    `Ótimo! Eu mesma faço o seu contrato agora. Primeiro preciso do número do contrato do ${banco} com parcela de ${parcela}. Ele aparece no aplicativo do banco ou no SouGov.br, em Consignações. Pode mandar só o número.`,
  numeroContratoInvalido: "Não consegui entender o número do contrato. Pode mandar de novo, só o número? Se não souber onde achar, me diga.",
  semNumeroContrato:
    "Sem problema! Vou te passar para um especialista da nossa equipe, que te ajuda a achar o número do contrato e fecha a proposta com você. Já já alguém continua aqui.",
  portProntaEquipe:
    "Recebi tudo! Um especialista da nossa equipe vai cadastrar a sua portabilidade agora e te manda aqui o link para assinar. Já já alguém continua com você.",
  aceitouPort:
    "Ótimo! Vou te passar para um especialista da nossa equipe. Ele confirma o saldo com o seu banco e fecha a proposta com você. Já já alguém continua aqui.",
  semSaldo:
    "Consultei aqui e, no momento, o banco não liberou valor para o seu CPF. Vou te passar para um atendente ver outras opções com você.",
  erroBanco: "Não consegui consultar o banco agora. Vou te passar para um atendente continuar daqui.",
  // Nunca prometer valor garantido: sempre "até" e "estimativa".
  oferta: (valor: string, prazo: number, parcela: string, desconto = "no seu salário") =>
    `Boa notícia! Você pode receber até ${valor}, em ${prazo} parcelas de ${parcela}, descontadas direto ${desconto}.\n\n` +
    "Esse valor é uma estimativa e ainda passa pela análise do banco. Se fizer sentido para você, é só me responder SIM que eu já começo. Ficou alguma dúvida? Pode me perguntar.",
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
