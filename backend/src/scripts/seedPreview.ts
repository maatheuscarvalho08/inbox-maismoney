// Conversas fictícias para ver as telas no ambiente de preview. Recusa rodar fora de
// um banco local: nunca use em produção.
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(env.DATABASE_URL)) {
  throw new Error("seedPreview só roda com banco local");
}

async function main() {
  const atendente = await prisma.usuario.findFirstOrThrow({ where: { email: "barbara@preview.local" } });

  const atendimento = await prisma.instancia.create({
    data: { nome: "Atendimento", numero: "+55 21 90000-0001", tipoConexao: "evolution", evolutionInstanceId: "preview-atendimento", status: "conectado" },
  });
  const trafego = await prisma.instancia.create({
    data: { nome: "Tráfego", numero: "+55 21 90000-0002", tipoConexao: "meta_cloud", metaPhoneNumberId: "preview-meta", status: "conectado", maisaAtiva: true },
  });

  const exemplos = [
    { nome: "Ana Exemplo", instanciaId: trafego.id, comMaisa: true, texto: "Quero simular um empréstimo CLT" },
    { nome: "Bruno Exemplo", instanciaId: trafego.id, comMaisa: true, texto: "Trabalho de carteira assinada há 2 anos" },
    { nome: "Carla Exemplo", instanciaId: trafego.id, comMaisa: true, texto: "Qual o valor das parcelas?" },
    { nome: "Diego Exemplo", instanciaId: trafego.id, texto: "Sou aposentado do INSS" },
    { nome: "Elisa Exemplo", instanciaId: atendimento.id, texto: "Boa tarde, queria falar com um atendente" },
    { nome: "Fabio Exemplo", instanciaId: atendimento.id, texto: "Vocês refinanciam contrato?" },
    { nome: "Gabi Exemplo", instanciaId: atendimento.id, operadorId: atendente.id, status: "em_atendimento" as const, texto: "Enviei o contracheque" },
    { nome: "Hugo Exemplo", instanciaId: trafego.id, operadorId: atendente.id, status: "aguardando" as const, texto: "Vou conversar em casa e retorno" },
    { nome: "Iara Exemplo", instanciaId: trafego.id, origemDisparo: true, respondida: false, operador: "Olá! Temos uma condição para você." },
  ];

  for (const [i, e] of exemplos.entries()) {
    const contato = await prisma.contato.create({
      data: { nome: e.nome, numeroWhatsapp: `552190000${String(1000 + i)}` },
    });
    const conversa = await prisma.conversa.create({
      data: {
        instanciaId: e.instanciaId,
        contatoId: contato.id,
        comMaisa: e.comMaisa ?? false,
        operadorId: e.operadorId,
        status: e.status ?? "aberta",
        origemDisparo: e.origemDisparo ?? false,
        respondida: e.respondida ?? true,
      },
    });
    await prisma.mensagem.create({
      data: e.texto
        ? { conversaId: conversa.id, remetenteTipo: "cliente", conteudoTexto: e.texto }
        : { conversaId: conversa.id, remetenteTipo: "operador", operadorId: atendente.id, conteudoTexto: e.operador },
    });
  }
  console.log("preview pronto:", exemplos.length, "conversas");
}

main().finally(() => prisma.$disconnect());
