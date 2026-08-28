import path from "path";
import express, { Router } from "express";
import twilio from "twilio";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { verifyTwilioSignature } from "../../middleware/verifyTwilioSignature.js";
import { enviarTemplateMeta, mensagemErroMeta } from "../../integrations/metaCloudApi.js";
import { emitirAtualizacaoCampanha } from "../../modules/campanhas/campanhas.service.js";
import type { StatusLigacao } from "@prisma/client";

const { VoiceResponse } = twilio.twiml;

const router = Router();

// Twilio manda os webhooks como application/x-www-form-urlencoded, diferente do
// resto da API (JSON) — parser escopado só a essas rotas.
router.use(express.urlencoded({ extended: false }));

router.post(
  "/voice",
  verifyTwilioSignature,
  asyncHandler(async (req, res) => {
    const campanhaNumeroId = req.query.campanhaNumeroId as string | undefined;
    const twiml = new VoiceResponse();

    const numero = campanhaNumeroId
      ? await prisma.campanhaNumero.findUnique({ where: { id: campanhaNumeroId }, include: { campanha: true } })
      : null;

    if (numero) {
      const audioUrl = `${env.PUBLIC_API_URL}/campanhas/audio/${path.basename(numero.campanha.audioPath)}`;
      const gather = twiml.gather({
        numDigits: 1,
        timeout: 6,
        action: `${env.PUBLIC_API_URL}/webhooks/twilio/gather?campanhaNumeroId=${campanhaNumeroId}`,
        method: "POST",
      });
      gather.play({}, audioUrl);
      // Se ninguém apertar nada, cai aqui fora do <Gather> e a ligação encerra sem conversão.
      twiml.hangup();
    } else {
      twiml.hangup();
    }

    res.type("text/xml").send(twiml.toString());
  }),
);

router.post(
  "/gather",
  verifyTwilioSignature,
  asyncHandler(async (req, res) => {
    const campanhaNumeroId = req.query.campanhaNumeroId as string | undefined;
    const digitos = req.body.Digits as string | undefined;
    const twiml = new VoiceResponse();

    const numero = campanhaNumeroId
      ? await prisma.campanhaNumero.findUnique({
          where: { id: campanhaNumeroId },
          include: { campanha: { include: { template: true, instancia: true } } },
        })
      : null;

    if (numero && digitos === "1" && !numero.hsmDisparado) {
      await prisma.campanhaNumero.update({ where: { id: numero.id }, data: { apertou1: true } });

      // Um HSM por conversão — nunca duplicar envio mesmo que o gather dispare mais de uma vez.
      if (numero.campanha.instancia.metaPhoneNumberId) {
        try {
          await enviarTemplateMeta(
            numero.campanha.instancia.metaPhoneNumberId,
            numero.numeroWhatsapp,
            numero.campanha.template.nome,
            [],
            numero.campanha.template.idioma,
          );
          await prisma.campanhaNumero.update({ where: { id: numero.id }, data: { hsmDisparado: true } });
        } catch (err) {
          console.error("Erro ao disparar HSM da discadora:", mensagemErroMeta(err));
        }
      }

      await emitirAtualizacaoCampanha(numero.campanhaId);
      twiml.say({ language: "pt-BR" }, "Obrigado! Você vai receber uma mensagem no WhatsApp em instantes.");
    } else {
      twiml.say({ language: "pt-BR" }, "Tudo bem. Até a próxima.");
    }
    twiml.hangup();

    res.type("text/xml").send(twiml.toString());
  }),
);

const STATUS_MAP: Record<string, StatusLigacao> = {
  "in-progress": "atendeu",
  "no-answer": "nao_atendeu",
  busy: "ocupado",
  failed: "erro",
  canceled: "erro",
};

// "in-progress" significa atendida, não encerrada — a ligação continua rolando. Tratar
// como terminal liberaria cedo demais o slot que segura o limite de simultâneas
// (ver aguardarFimDaLigacao em queues/discadoraQueue.ts).
const STATUS_TERMINAIS = new Set(["completed", "no-answer", "busy", "failed", "canceled"]);

router.post(
  "/status",
  verifyTwilioSignature,
  asyncHandler(async (req, res) => {
    const campanhaNumeroId = req.query.campanhaNumeroId as string | undefined;
    const callStatus = req.body.CallStatus as string | undefined;

    const numero = campanhaNumeroId
      ? await prisma.campanhaNumero.findUnique({ where: { id: campanhaNumeroId } })
      : null;

    if (numero && callStatus) {
      const statusLigacao = STATUS_MAP[callStatus];
      const ehTerminal = STATUS_TERMINAIS.has(callStatus);

      await prisma.campanhaNumero.update({
        where: { id: numero.id },
        data: {
          ...(statusLigacao ? { statusLigacao } : {}),
          ...(ehTerminal ? { finalizadoEm: new Date() } : {}),
        },
      });
      await emitirAtualizacaoCampanha(numero.campanhaId);
    }

    res.status(200).end();
  }),
);

export default router;
