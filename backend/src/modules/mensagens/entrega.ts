import path from "path";
import type { Mensagem, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { assinarMidia } from "../../lib/signedUrl.js";
import { enviarMidiaEvolution, enviarTextoEvolution, mensagemErroEvolution } from "../../integrations/evolutionApi.js";
import { enviarMidiaMeta, enviarTextoMeta, mensagemErroMeta } from "../../integrations/metaCloudApi.js";

type TipoMidiaWhatsapp = "image" | "audio" | "video" | "document";

function tipoMidiaWhatsapp(mimetype: string): TipoMidiaWhatsapp {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("audio/")) return "audio";
  if (mimetype.startsWith("video/")) return "video";
  return "document";
}

export type ConversaComEnvio = Prisma.ConversaGetPayload<{ include: { contato: true; instancia: true } }>;

// Manda pro WhatsApp uma mensagem de operador já salva no banco e grava o
// resultado nela. Usado no envio normal e no botão "Reenviar".
export async function entregarMensagem(
  mensagem: Mensagem,
  conversa: ConversaComEnvio,
  original: Mensagem | null,
  // digitandoMs: espera antes de mandar. No Evolution o cliente vê "digitando..." nesse tempo.
  opts: { filename?: string; voiceNote?: boolean; digitandoMs?: number } = {},
) {
  const { instancia, contato } = conversa;
  const texto = mensagem.conteudoTexto ?? undefined;
  let entregue = false;
  let erroEntrega: string | undefined;
  let idEnvio: string | undefined;

  // Só dá pra citar se a original tiver o id que o provedor reconhece — mensagem
  // recém-criada por um operador sem confirmação de envio ainda não tem isso.
  const citacaoEvolution =
    original?.externalId
      ? { externalId: original.externalId, fromMe: original.remetenteTipo !== "cliente", conteudoTexto: original.conteudoTexto }
      : undefined;
  const citacaoMetaId = original?.externalId ?? undefined;

  try {
    if (mensagem.midiaPath && mensagem.tipoMidia) {
      // Mídia (e legenda, se houver) viajam juntas numa mensagem só — igual ao
      // comportamento normal do WhatsApp ao anexar arquivo com texto.
      const tipo = tipoMidiaWhatsapp(mensagem.tipoMidia);
      const { exp, sig } = assinarMidia(mensagem.id, 600);
      const link = `${env.PUBLIC_API_URL}/midia/${mensagem.id}?exp=${exp}&sig=${sig}`;

      if (instancia.tipoConexao === "evolution" && instancia.evolutionInstanceId) {
        idEnvio = await enviarMidiaEvolution(instancia.evolutionInstanceId, contato.numeroWhatsapp, link, tipo, texto, citacaoEvolution);
        entregue = true;
      } else if (instancia.tipoConexao === "meta_cloud" && instancia.metaPhoneNumberId) {
        idEnvio = await enviarMidiaMeta(instancia.metaPhoneNumberId, contato.numeroWhatsapp, tipo, link, {
          caption: texto,
          filename: opts.filename ?? path.basename(mensagem.midiaPath),
          voiceNote: opts.voiceNote,
          contextMessageId: citacaoMetaId,
        });
        entregue = true;
      }
    } else if (texto) {
      if (instancia.tipoConexao === "evolution" && instancia.evolutionInstanceId) {
        idEnvio = await enviarTextoEvolution(instancia.evolutionInstanceId, contato.numeroWhatsapp, texto, citacaoEvolution, opts.digitandoMs);
        entregue = true;
      } else if (instancia.tipoConexao === "meta_cloud" && instancia.metaPhoneNumberId) {
        // A Meta não tem "digitando" com tempo: só espera.
        if (opts.digitandoMs) await new Promise((r) => setTimeout(r, opts.digitandoMs));
        idEnvio = await enviarTextoMeta(instancia.metaPhoneNumberId, contato.numeroWhatsapp, texto, citacaoMetaId);
        entregue = true;
      }
    }
  } catch (err) {
    erroEntrega = instancia.tipoConexao === "evolution" ? mensagemErroEvolution(err) : mensagemErroMeta(err);
    console.error("Falha ao entregar mensagem via WhatsApp:", erroEntrega);
  }

  // Guarda o wamid/key.id de retorno como externalId da própria mensagem — é isso que
  // o webhook "statuses" da Meta usa pra dizer "essa mensagem foi entregue/lida".
  // O motivo da falha fica salvo pro operador ver no ícone da mensagem.
  if (idEnvio || erroEntrega) {
    await prisma.mensagem.update({
      where: { id: mensagem.id },
      data: {
        externalId: idEnvio ?? undefined,
        statusEntrega: idEnvio ? "enviado" : "falhou",
        erroEntrega: idEnvio ? null : erroEntrega,
      },
    });
    mensagem.externalId = idEnvio ?? null;
    mensagem.statusEntrega = idEnvio ? "enviado" : "falhou";
    mensagem.erroEntrega = idEnvio ? null : erroEntrega ?? null;
  }

  return { entregue, erroEntrega };
}
