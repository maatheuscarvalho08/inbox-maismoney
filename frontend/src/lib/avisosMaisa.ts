import { useState } from "react";
import { useSocketEvent } from "../hooks/useSocketEvent";

// Avisos da Maisa para a equipe: cliente que quer seguir depois de sair dela, mensagem
// que ela não conseguiu entregar e digitação com resultado incerto na Facta.
export type TipoAvisoMaisa = "aceite_apos_transferencia" | "entrega_falhou" | "digitacao_incerta" | "mensagem_apos_digitacao" | "digitacao_bloqueada";
export interface AvisoMaisa {
  tipo: TipoAvisoMaisa;
  conversaId: string;
  nome: string | null;
  detalhe?: string;
}

export const TEXTO_AVISO: Record<TipoAvisoMaisa, string> = {
  aceite_apos_transferencia: "disse que quer seguir, depois de sair da Maisa. Ela não fez nada: fale com o cliente.",
  entrega_falhou: "não recebeu a mensagem da Maisa. A conversa foi para a fila.",
  digitacao_incerta: "teve a digitação na Facta com resultado incerto. Confira no portal antes de digitar de novo.",
  mensagem_apos_digitacao: "mandou mensagem depois do ponto sem volta da digitação. A proposta foi feita com os dados de antes: confira.",
  digitacao_bloqueada: "teve a digitação bloqueada: já existe operação para este CPF. Confira no portal.",
};

// Fila dos avisos ainda não vistos, o mais novo primeiro. Um por conversa e tipo.
export function useAvisosMaisa() {
  const [avisos, setAvisos] = useState<AvisoMaisa[]>([]);
  useSocketEvent<AvisoMaisa>("maisa:aviso", (a) =>
    setAvisos((atual) => [a, ...atual.filter((x) => !(x.conversaId === a.conversaId && x.tipo === a.tipo))].slice(0, 20)),
  );
  return {
    avisos,
    dispensar: (a: AvisoMaisa) => setAvisos((atual) => atual.filter((x) => x !== a)),
  };
}
