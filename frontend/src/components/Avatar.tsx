export function Avatar({ nome }: { nome: string }) {
  const inicial = nome.trim().charAt(0).toUpperCase();

  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-bg">
      {inicial}
    </span>
  );
}
