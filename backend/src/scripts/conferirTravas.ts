// Confere, no .env do servidor, se alguma versão do código conseguiria digitar na Facta
// sem autorização. Rodar antes de todo deploy e de todo rollback:
//   docker compose -f docker-compose.prod.yml run --rm --no-deps backend npx tsx src/scripts/conferirTravas.ts
// (ou, com o .env carregado: npx tsx src/scripts/conferirTravas.ts)
//
// Por que existe: a trava MAISA_DIGITACAO_LIBERADA só vale para o código novo. O código
// anterior digita com MAISA_DIGITA_PROPOSTA=true e o certificado preenchido. Esta checagem
// lê só o ambiente, então vale para qualquer versão que for subir.
// Saída 0: seguro. Saída 1: alguma versão do código digitaria; não suba.
import "dotenv/config";

const ligado = (v: string | undefined) => v === "true";
const preenchido = (v: string | undefined) => Boolean(v && v.trim());

const digitaCodigoAntigo = ligado(process.env.MAISA_DIGITA_PROPOSTA) && preenchido(process.env.FACTA_LOGIN_CERTIFICADO);
const liberadaNoCodigoNovo = ligado(process.env.MAISA_DIGITACAO_LIBERADA);

console.log(`MAISA_DIGITA_PROPOSTA=${process.env.MAISA_DIGITA_PROPOSTA ?? "(vazio)"}`);
console.log(`FACTA_LOGIN_CERTIFICADO=${preenchido(process.env.FACTA_LOGIN_CERTIFICADO) ? "(preenchido)" : "(vazio)"}`);
console.log(`FACTA_CODIGO_MASTER=${preenchido(process.env.FACTA_CODIGO_MASTER) ? "(preenchido)" : "(vazio)"}`);
console.log(`MAISA_DIGITACAO_LIBERADA=${process.env.MAISA_DIGITACAO_LIBERADA ?? "(vazio)"}`);

if (digitaCodigoAntigo && !liberadaNoCodigoNovo) {
  console.error(
    "INSEGURO: com MAISA_DIGITA_PROPOSTA=true e o certificado preenchido, o código anterior à fase 5 digita na Facta sem as travas novas. " +
      "Ponha MAISA_DIGITA_PROPOSTA=false (ou tire FACTA_LOGIN_CERTIFICADO) antes de subir qualquer versão.",
  );
  process.exit(1);
}
if (liberadaNoCodigoNovo) {
  console.warn("ATENÇÃO: MAISA_DIGITACAO_LIBERADA=true. A digitação automática está autorizada nesta configuração.");
}
console.log("OK: nenhuma versão do código digita na Facta com esta configuração, a não ser com a trava explicitamente liberada.");
