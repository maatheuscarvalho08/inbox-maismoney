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

// O que a oferta de port precisa saber. Estrutural, para não amarrar textos.ts a bancos.ts.
export interface OfertaPortTexto {
  operacao: "port_refin" | "portabilidade" | "refin";
  trocoCentavos: number | null;
  digitacao?: {
    banco: string;
    parcela: number;
    prazoRestante: number;
    refin?: { parcela: number; prazo: number; taxa?: number };
  };
  reducoes?: { banco: string; atual: number; nova: number; restantes?: number; taxa?: number }[];
}

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
  extratoGuardado: "Recebi o seu documento, obrigada! Já guardei aqui para a sua simulação.",
  confirmaData: (data: string) => `Acho que o ano saiu trocado. Você quis dizer ${data}? Se for isso, é só me responder SIM.`,
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
  // Oferta de port: diz qual contrato, como está hoje, como fica na Facta (parcela, prazo e
  // taxa) e o que o cliente ganha. Nunca valor garantido: o saldo real vem do banco de origem.
  ofertaPort: (a: OfertaPortTexto) => {
    const r = (v: number) => formatarReais(Math.round(v * 100));
    const taxa = (t?: number) => (t ? `, com taxa de ${t.toLocaleString("pt-BR")}% ao mês` : "");
    const d = a.digitacao;
    let corpo: string;
    if (a.operacao === "port_refin" && a.trocoCentavos && d?.refin) {
      corpo =
        `Para empréstimo novo não sobra margem, mas encontrei uma saída com o seu contrato do ${d.banco}:\n\n` +
        `• Hoje: parcela de ${r(d.parcela)}, faltando ${d.prazoRestante} parcelas.\n` +
        `• Na Facta: a parcela continua ${r(d.refin.parcela)}, em ${d.refin.prazo} parcelas (o contrato recomeça)${taxa(d.refin.taxa)}.\n` +
        `• Você recebe: até ${formatarReais(a.trocoCentavos)} de dinheiro extra na sua conta.\n\n` +
        `É uma estimativa: o valor final depende do saldo que o ${d.banco} informar.`;
    } else if (a.operacao === "port_refin" && a.trocoCentavos) {
      corpo =
        `Para empréstimo novo não sobra margem, mas encontrei uma saída: trazer um dos seus contratos para a Facta, com taxa menor, e ainda liberar um dinheiro extra de até ${formatarReais(a.trocoCentavos)} na sua conta, sem aumentar a parcela.\n\n` +
        "É uma estimativa: o valor final depende do saldo que o seu banco informar.";
    } else if (a.operacao === "refin") {
      corpo = "Para empréstimo novo não sobra margem, mas dá para refinanciar um contrato que você já tem e liberar um valor novo.";
    } else if (a.reducoes?.length) {
      corpo =
        "Para empréstimo novo não sobra margem, mas dá para trazer contrato seu para a Facta com uma taxa menor:\n\n" +
        a.reducoes
          .map((x) => {
            const economia = x.atual - x.nova;
            const total = x.restantes ? ` (${r(economia * x.restantes)} até o fim do contrato)` : "";
            return (
              `• ${x.banco}: hoje ${r(x.atual)} por mês${x.restantes ? `, faltando ${x.restantes} parcelas` : ""}. ` +
              `Na Facta, ${r(x.nova)}${taxa(x.taxa)}. Economia de ${r(economia)} por mês${total}.`
            );
          })
          .join("\n") +
        "\n\nVocê continua com as mesmas parcelas que faltam, só que pagando menos em cada uma. É uma estimativa: o valor final depende do saldo que o seu banco informar.";
    } else {
      corpo = "Para empréstimo novo não sobra margem, mas dá para trazer um dos seus contratos para a Facta com uma taxa menor, o que baixa a sua parcela.";
    }
    return corpo + "\n\nSe fizer sentido para você, eu mesma cuido de tudo. É só me responder SIM que eu já começo. Ficou alguma dúvida? Pode me perguntar.";
  },
  semPressa: "Claro, sem pressa! Quando decidir, é só me responder por aqui.",
  contornoConfianca:
    "Entendo a preocupação, é importante ter segurança. Funciona assim: o contrato só é assinado por você, pelo link da Facta, e só se você concordar. O dinheiro cai depois que a portabilidade é aprovada.\n\n" +
    "Se quiser conferir, o SAC da Facta Financeira é 0800 942 0462, que também atende pelo WhatsApp. E a Mais Money, que cuida da sua proposta, tem CNPJ 45.027.472/0001-76 e Instagram @maismoneyrj.",
  contornoPoucoValor: (parcela: string, troco: string) =>
    `Entendo! Vale lembrar: a sua parcela não aumenta. Você continua pagando os mesmos ${parcela} e ainda recebe até ${troco} na sua conta.\n\n` +
    "E esse valor foi calculado com o saldo aproximado do seu contrato. Com o saldo real do banco, ele pode ser maior. Você só assina se concordar. Quer que eu siga? É só me responder SIM.",
  contornoPrazo: (banco: string, restantes: number, atual: string, nova: string) =>
    `Entendo, você não quer esticar o prazo. Então tem outra opção: trazer o seu contrato do ${banco} sem refinanciar. ` +
    `Você continua com as ${restantes} parcelas que faltam, sem dinheiro extra, e a parcela cai de ${atual} para ${nova}.\n\nPrefere assim? É só me responder SIM.`,
  perguntaOutraOferta:
    "Que bom que você está comparando! Me conta quanto te ofereceram, em quantas parcelas e em qual banco. Assim a nossa equipe compara e vê se consegue fazer melhor.",
  ofertaMelhorEquipe:
    "Obrigada por me contar! Vou passar para um especialista da nossa equipe, que vai comparar com essa oferta e ver se consegue fazer melhor para você. Já já alguém continua aqui.",
  recusaValor:
    "Entendi, faz sentido você querer mais. Esse valor é uma estimativa feita com o saldo aproximado do seu contrato. Vou pedir para um especialista da nossa equipe olhar o saldo real e ver se consegue uma condição melhor para você. Já já alguém continua aqui.",
  recusaSimples:
    "Tudo bem! Se mudar de ideia ou quiser ver outras opções, um especialista da nossa equipe fica à disposição por aqui.",
  duvidaParaEquipe:
    "Essa dúvida um especialista da nossa equipe responde melhor. Vou chamar alguém, já já continua aqui com você.",
  objecao:
    "Entendo a sua preocupação, é importante ter segurança. Vou te passar para um especialista da nossa equipe, que tira as suas dúvidas e mostra como tudo funciona antes de qualquer coisa. Já já alguém continua aqui com você.",
  // Retomada de quem já aceitou: primeiro lembra o que ele ganha, depois pede o contrato.
  retomaDigitacao: (banco: string, parcela: string, ganho: string) =>
    `Oi! Retomando o seu pedido. ${ganho}\n\nEu mesma vou digitar o seu contrato na Facta. Preciso só de algumas informações, uma de cada vez.\n\n` +
    `Primeiro, o número do contrato do ${banco} com parcela de ${parcela}. Ele aparece no aplicativo do banco ou no SouGov.br, em Consignações. Pode mandar só o número.`,
  retomaSemNumero: (ganho: string) =>
    `Oi! Retomando o seu pedido. ${ganho}\n\nEu mesma vou digitar o seu contrato na Facta. Preciso só de alguns dados seus, um de cada vez.`,
  // O que a port rende para o cliente, em uma frase. Nunca valor garantido.
  ganhoPort: (troco: string | null, banco: string, atual: string, nova: string | null) =>
    troco
      ? `Pela simulação na Facta, você recebe até ${troco} na sua conta, sem aumentar a parcela. É uma estimativa: o valor final depende do saldo que o seu banco informar.`
      : nova
        ? `Pela simulação na Facta, a parcela do ${banco} cai de ${atual} para ${nova}, com uma taxa menor.`
        : `Pela simulação na Facta, dá para trazer o seu contrato do ${banco} com uma taxa menor.`,
  pedeNumeroContrato: (banco: string, parcela: string) =>
    `Ótimo! Eu mesma faço o seu contrato agora. Primeiro preciso do número do contrato do ${banco} com parcela de ${parcela}. Ele aparece no aplicativo do banco ou no SouGov.br, em Consignações. Pode mandar só o número.`,
  contratoOutroBanco: (citado: string, pedido: string) =>
    `Esse parece ser o contrato do ${citado}. Para essa proposta eu preciso do número do contrato do ${pedido}. Pode me mandar esse?`,
  contratoDoAudio: (numero: string) => `Entendi o número ${numero} no seu áudio. É esse mesmo? Responda sim para eu seguir, ou me mande o número certo.`,
  contratoDoArquivo: (numero: string, banco: string | null) =>
    `Achei no arquivo o contrato número ${numero}${banco ? ` do ${banco}` : ""}. É esse mesmo? Responda sim para eu seguir, ou me mande o número certo.`,
  contratoArquivoOutroBanco: (citado: string, pedido: string) =>
    `Esse arquivo parece ser de um contrato do ${citado}. Para essa proposta eu preciso do contrato do ${pedido}. Pode me mandar o desse banco?`,
  arquivoSemContrato: (banco: string) =>
    `Recebi o arquivo, mas não consegui achar nele o número do contrato do ${banco}. Pode digitar o número por aqui, ou mandar uma foto mais nítida?`,
  cadastroAnterior: "Já tenho os seus dados do atendimento anterior, então não vou pedir tudo de novo.",
  cadastroParcial: "Já tenho parte dos seus dados do atendimento anterior. Falta só o resto.",
  contratoAnotado: (banco: string, numero: string) => `Anotei o número do contrato do ${banco}: ${numero}. Obrigada!`,
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
  // Confirmação: o cliente apontou erro. Ela corrige ali mesmo, sem passar para a equipe.
  qualCorrigir: "Sem problema, vamos corrigir. Me manda só o dado certo. Por exemplo: RG 12345678, ou agência 1234 e conta 12345-6.",
  dadosCorrigidos: "Corrigi aqui!",
  // Oferta: "ok", "👍", "valeu" não são sim nem não. Ela pergunta de novo.
  confirmaAceite: "Só para confirmar: quer que eu siga com a sua proposta? É só me responder SIM.",
  // "sim" na confirmação: a digitação espera a janela, e o cliente ainda pode corrigir.
  confirmacaoRecebida: "Perfeito! Vou fazer o seu contrato agora. Se lembrar de algum dado para corrigir, me avisa aqui.",
  // Digitação automática travada: os dados estão completos e a equipe digita.
  digitacaoComEquipe:
    "Recebi tudo! Um especialista da nossa equipe vai fazer o seu contrato agora e te manda aqui o link para assinar. Já já alguém continua com você.",
  // Resultado incerto na Facta: a equipe confere antes de qualquer coisa.
  digitacaoEmConferencia:
    "Estou conferindo o seu contrato no sistema do banco. Um especialista da nossa equipe confirma e continua com você aqui, já já.",
  // Correção de dado lido do extrato (renda, matrícula, conta): a equipe valida.
  dadoExtratoEquipe:
    "Anotei. Esse dado veio do seu extrato, então um especialista da nossa equipe vai conferir com você antes de fazer o contrato. Já já alguém continua aqui.",
  followupOfertaPort:
    "Oi! Conseguiu ver a condição da portabilidade que separei para você? Se quiser seguir, é só responder SIM. Se tiver alguma dúvida, me conta.",
  confirmaDadosDeNovo: "Se os dados estiverem certos, é só me responder SIM. Se algum estiver errado, me diz qual.",
  semPressaConfirmacao: "Claro, sem pressa! Eu só faço o contrato quando você me responder SIM. Se algum dado estiver errado, me diz qual.",
  relembraOferta: "A sua condição continua de pé. Quer que eu siga? É só me responder SIM.",
  // Aceite com condição ("sim, mas tem seguro?"): responde e confirma antes de seguir.
  confirmaCondicao: "Com isso esclarecido, posso seguir com a sua proposta? É só me responder SIM.",
  // Aceite com condição que ela não sabe responder: confirma sem fingir que esclareceu.
  confirmaAntes: "Antes de seguir, me confirma: posso fazer a proposta do jeito que te mostrei? É só me responder SIM. Se quiser mudar alguma coisa, me conta.",
  // Aceite com outro valor ou prazo: a equipe refaz. A Maisa não muda a oferta sozinha.
  outroValorEquipe:
    "Anotei o que você quer. Vou pedir para um especialista da nossa equipe refazer a simulação com esse valor ou prazo. Já já alguém continua aqui com você.",
  // Data ou CPF diferente depois da oferta: a simulação usou o dado antigo.
  dadoCorrigidoEquipe:
    "Obrigada por avisar! Como esse dado mudou, um especialista da nossa equipe vai refazer a sua simulação. Já já alguém continua aqui com você.",
  cpfJaAnotado: "O seu CPF já está anotado aqui 😊",
  dataJaAnotada: "Essa data já está anotada aqui 😊",
  dataCorrigida: (data: string) => `Pronto, corrigi a sua data de nascimento para ${data}.`,
  numeroNaOferta: "Recebi esse número, mas não sei a que ele se refere.",
  recomecar: "Sem problema! Se quiser refazer, é só me mandar outro extrato aqui. Se preferir, chamo alguém da equipe para olhar com você.",
  naoSeiSeEntendi: "Não sei se entendi direito. Quer que eu siga com a sua proposta? Responda SIM, ou me conta a sua dúvida.",
  menorDeIdade: "Pela data, você teria menos de 18 anos, e o crédito é só para maiores de idade. Pode conferir a data e me mandar de novo?",
  perguntaIdade: "A idade entra na análise: com a sua data de nascimento eu já vejo o prazo possível para você. Qual a sua data de nascimento?",
  senhaGov: (produto: "inss" | "siape") =>
    `Se a senha do gov.br venceu ou você esqueceu, dá para criar uma nova no aplicativo gov.br, tocando em "Esqueci minha senha". Depois é só entrar no ${produto === "siape" ? "SouGov.br" : "Meu INSS"} e baixar o extrato.`,
  mensagemNaoSuportada: "Essa mensagem não abriu aqui para mim. Pode mandar o extrato de novo, em PDF ou foto?",
  retomaNumero: (banco: string) => `Quando puder, me manda o número do contrato do ${banco}.`,
  // Foto chegou, mas o dado pedido não aparece nela (foto torta, apagada, de lado).
  fotoSemDado: "Recebi a foto, mas não consegui ler esse dado nela.",
  // Arquivo antes de saber o vínculo: guarda (pode ser o extrato) e pergunta o vínculo.
  arquivoNoInicio: "Recebi o seu arquivo e já guardei aqui. Antes de olhar, me conta qual é o seu vínculo.",
  // Mandou o extrato de novo depois da oferta: a simulação já foi feita com ele.
  extratoRepetido: "Recebi! A sua simulação já foi feita com o seu extrato. Os valores estão na mensagem aqui em cima.",
  extratoRecente: "Serve sim! O extrato de ontem ou dos últimos dias está ótimo. Pode mandar aqui, em PDF ou foto.",
  extratoNaoChegou:
    "Ainda não chegou nenhum arquivo aqui para mim. Pode mandar de novo? Toque no clipe 📎 aqui no WhatsApp, escolha Documento e selecione o PDF.",
  extratoPorLink:
    "Não consigo abrir links. Me manda o próprio arquivo aqui na conversa: no Acrobat, toque em Compartilhar, depois em Enviar uma cópia, e escolha o WhatsApp. Também pode ser uma foto bem nítida.",
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
