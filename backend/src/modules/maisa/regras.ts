// Regras da Mais Money para aceitar um vínculo CLT antes de simular.
// ATENÇÃO: valores provisórios, copiados do funil-clt-facta. Preencher com a política
// real da Facta antes de atender cliente de verdade.
import type { Vinculo } from "./facta.js";

export const REGRAS = {
  idadeMin: 18,
  idadeMax: 70,
  mesesAdmissaoMin: 6,
  margemMinReais: 30,
  // Usa 98% da margem para não estourar na averbação.
  folgaMargem: 0.98,
};

// Devolve o motivo da recusa, ou null se o vínculo serve. O motivo é só para a equipe.
export function avaliarVinculo(v: Vinculo, hoje = new Date()): string | null {
  if (!v.elegivel) return `Dataprev: não elegível${v.erroMensagem ? ` (${v.erroMensagem})` : ""}`;
  if (v.dataDesligamento) return "vínculo com data de desligamento";
  if (!v.dataNascimento || !v.dataAdmissao) return "dados incompletos na Dataprev";
  if (v.renda == null || v.margemDisponivel == null) return "renda ou margem não informadas";

  const idade = anosEntre(new Date(v.dataNascimento), hoje);
  if (idade < REGRAS.idadeMin || idade > REGRAS.idadeMax) return `idade fora da política (${idade})`;
  const meses = mesesEntre(new Date(v.dataAdmissao), hoje);
  if (meses < REGRAS.mesesAdmissaoMin) return `pouco tempo de empresa (${meses} meses)`;
  if (v.margemDisponivel < REGRAS.margemMinReais) return "margem insuficiente";
  return null;
}

function anosEntre(a: Date, b: Date) {
  const aniversarioPassou = b >= new Date(b.getFullYear(), a.getMonth(), a.getDate());
  return b.getFullYear() - a.getFullYear() - (aniversarioPassou ? 0 : 1);
}

function mesesEntre(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) - (b.getDate() < a.getDate() ? 1 : 0);
}
