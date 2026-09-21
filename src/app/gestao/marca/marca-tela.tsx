"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { temErro } from "@/lib/erro-de-operacao";
import { COR_DE_FUNDO_PADRAO, noEndereco, type FundoDaLogo } from "@/lib/marca";
import { removerLogomarca, salvarCorDeFundo, salvarLogomarca } from "./actions";

/**
 * O cadastro da marca da casa.
 *
 * A tela é quase toda pré-visualização, e não formulário: logomarca se escolhe
 * olhando. Cada versão aparece sobre o fundo a que se destina, do tamanho em
 * que vai ser desenhada — é o único jeito de ver que a de letra branca some no
 * claro, que é exatamente o problema que as duas versões resolvem.
 */
export function MarcaTela({
  claro,
  escuro,
  corInicial,
  nome,
}: {
  /** A versão já salva para cada fundo, ou `null` enquanto não houver. */
  claro: string | null;
  escuro: string | null;
  corInicial: string;
  nome: string;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [cor, setCor] = useState(corInicial);
  const [salvandoCor, iniciarCor] = useTransition();
  const router = useRouter();

  /** Falta uma das duas: é o único caso em que a cor de resgate trabalha. */
  const faltaUma = !claro || !escuro;

  function guardarCor(nova: string) {
    setCor(nova);
    setErro(null);
    iniciarCor(async () => {
      const r = await salvarCorDeFundo(nova);
      if (temErro(r)) {
        setErro(r.erro);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Logomarca</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          A marca da casa aparece no topo da gestão, na tela de entrada da equipe e na tela que o
          cliente abre pelo QR da mesa. São duas versões porque esses fundos são opostos: a logo
          desenhada para o preto do salão não se lê na barra branca daqui.
        </p>
      </header>

      {erro && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Versao
          fundo="ESCURO"
          titulo="Para fundo escuro"
          onde="Tela de entrada da equipe e tela do QR da mesa."
          src={escuro}
          nome={nome}
          corDoQuadro="#0a0a0a"
          corDoTexto="#ffffff"
          avisarErro={setErro}
        />

        <Versao
          fundo="CLARO"
          titulo="Para fundo claro"
          onde="Topo do painel de gestão."
          src={claro}
          nome={nome}
          corDoQuadro="#ffffff"
          corDoTexto="#171717"
          avisarErro={setErro}
        />
      </div>

      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold">
          Cor de resgate
          <span className="ml-2 font-normal text-neutral-500">quando falta uma das versões</span>
        </h2>

        <p className="mt-1 max-w-2xl text-xs text-neutral-500">
          Com uma versão só cadastrada, ela acaba caindo também na tela do fundo contrário — e some.
          Nesse caso o sistema desenha um retângulo desta cor atrás dela.{" "}
          {faltaUma ? (
            <span className="font-semibold text-neutral-700">
              É o que está acontecendo agora: falta uma das duas.
            </span>
          ) : (
            <span>
              As duas estão cadastradas, então esta cor não está sendo usada em lugar nenhum.
            </span>
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="color"
            value={cor}
            disabled={salvandoCor}
            onChange={(e) => guardarCor(e.target.value)}
            aria-label="Cor de resgate da logomarca"
            className="h-10 w-16 cursor-pointer rounded-lg border border-neutral-200 bg-white p-1"
          />
          <span className="font-mono text-sm uppercase text-neutral-600">{cor}</span>

          {cor.toLowerCase() !== COR_DE_FUNDO_PADRAO && (
            <button
              onClick={() => guardarCor(COR_DE_FUNDO_PADRAO)}
              disabled={salvandoCor}
              className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline disabled:opacity-40"
            >
              voltar ao preto do sistema
            </button>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * Uma das duas versões: o quadro em que ela é vista e os botões que a trocam.
 *
 * O quadro vem antes do campo de arquivo porque é ele que responde a pergunta
 * da tela. O campo é só o meio de mudar o que está no quadro.
 */
function Versao({
  fundo,
  titulo,
  onde,
  src,
  nome,
  corDoQuadro,
  corDoTexto,
  avisarErro,
}: {
  fundo: FundoDaLogo;
  titulo: string;
  onde: string;
  src: string | null;
  nome: string;
  corDoQuadro: string;
  corDoTexto: string;
  avisarErro: (erro: string | null) => void;
}) {
  const [previa, setPrevia] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);
  const router = useRouter();

  /** O que o quadro mostra: o arquivo recém-escolhido ou o que já está salvo. */
  const mostrando = previa ?? src;

  function limpar() {
    setPrevia(null);
    if (campo.current) campo.current.value = "";
  }

  function escolheu(arquivo: File | undefined) {
    avisarErro(null);
    if (!arquivo) return;
    // `createObjectURL` para ver antes de enviar: a decisão é visual, e
    // esperar o envio para descobrir que a logo some no fundo é tarde.
    setPrevia(URL.createObjectURL(arquivo));
  }

  function salvar() {
    avisarErro(null);
    const arquivo = campo.current?.files?.[0];
    if (!arquivo) return;

    const dados = new FormData();
    dados.set("arquivo", arquivo);
    dados.set("fundo", noEndereco(fundo));

    iniciar(async () => {
      const r = await salvarLogomarca(dados);
      if (temErro(r)) {
        avisarErro(r.erro);
        return;
      }
      limpar();
      router.refresh();
    });
  }

  function remover() {
    avisarErro(null);
    iniciar(async () => {
      const r = await removerLogomarca(noEndereco(fundo));
      if (temErro(r)) {
        avisarErro(r.erro);
        return;
      }
      limpar();
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      <p className="mt-0.5 text-xs text-neutral-500">{onde}</p>

      <div
        className="mt-4 flex h-32 items-center justify-center rounded-lg px-5 ring-1 ring-inset ring-black/10"
        style={{ backgroundColor: corDoQuadro }}
      >
        {mostrando ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mostrando} alt={nome} className="max-h-24 max-w-full object-contain" />
        ) : (
          <span className="text-sm font-bold tracking-tight" style={{ color: corDoTexto }}>
            {nome}
          </span>
        )}
      </div>

      {!src && !previa && (
        <p className="mt-2 text-xs text-neutral-500">
          Sem esta versão, o nome da casa aparece no lugar — ou, se a outra estiver cadastrada, ela
          entra aqui sobre a cor de resgate.
        </p>
      )}

      <label className="mt-4 flex flex-col gap-1 text-xs text-neutral-600">
        Arquivo
        <input
          ref={campo}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={pendente}
          onChange={(e) => escolheu(e.target.files?.[0])}
          className="rounded-lg border border-neutral-200 bg-white p-2 text-sm text-neutral-900 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
        />
      </label>

      <p className="mt-2 text-xs text-neutral-500">
        PNG, JPG ou WebP, até 512 KB. PNG com fundo transparente é o que funciona aqui — uma imagem
        com fundo branco vai aparecer como um retângulo branco.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={salvar}
          disabled={pendente || !previa}
          className="realce-ao-toque touch-manipulation rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition duration-100 active:scale-95 disabled:opacity-40"
        >
          Salvar
        </button>

        {previa && (
          <button
            onClick={limpar}
            disabled={pendente}
            className="realce-ao-toque touch-manipulation rounded-lg px-3 py-2 text-sm text-neutral-600 ring-1 ring-neutral-200 transition duration-100 hover:bg-neutral-50 active:scale-95 disabled:opacity-40"
          >
            Cancelar
          </button>
        )}

        {src && !previa && (
          <button
            onClick={remover}
            disabled={pendente}
            className="realce-ao-toque touch-manipulation rounded-lg px-3 py-2 text-sm text-red-600 ring-1 ring-neutral-200 transition duration-100 hover:bg-red-50 active:scale-95 disabled:opacity-40"
          >
            Remover
          </button>
        )}
      </div>
    </section>
  );
}
