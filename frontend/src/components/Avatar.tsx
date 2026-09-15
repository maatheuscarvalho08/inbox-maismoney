import { useState } from "react";

interface Props {
  nome: string;
  fotoUrl?: string | null;
  tamanho?: number;
}

export function Avatar({ nome, fotoUrl, tamanho = 32 }: Props) {
  const [erro, setErro] = useState(false);
  const inicial = nome.trim().charAt(0).toUpperCase();
  const estilo = { width: tamanho, height: tamanho, fontSize: tamanho * 0.4 };

  if (fotoUrl && !erro) {
    return (
      <img
        src={fotoUrl}
        alt={nome}
        style={estilo}
        className="shrink-0 rounded-full object-cover"
        // Foto de perfil pode falhar em carregar (URL da Meta/WhatsApp expirada,
        // por exemplo) — cai pra inicial em vez de mostrar um ícone quebrado.
        onError={() => setErro(true)}
      />
    );
  }

  return (
    <span
      style={estilo}
      className="flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-bg"
    >
      {inicial}
    </span>
  );
}
