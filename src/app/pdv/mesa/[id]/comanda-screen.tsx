"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { useTemTeclado } from "../../teclado";
import { BotaoVoltar } from "../../botao-voltar";
import { TEXTO_DE_CAMPO } from "@/lib/campo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { enviarCarrinho } from "../../actions";
import { iniciarFechamento, reabrirComanda } from "../../pagamento-actions";
import {
  adicionarAoCarrinho,
  alterarQuantidade,
  atenderChamado,
  definirPontoCarne,
  limparCarrinho,
} from "../../carrinho-actions";
import { cancelarItem } from "../../cancelamento-actions";
import { precisaAutorizacao } from "@/lib/autorizacao";
import { PainelAutorizacao } from "../../painel-autorizacao";
import { Transferir } from "./transferir";
import { decorrido, useAgora } from "../../use-agora";
import type { CardapioItemView } from "./page";

type ItemComanda = {
  id: string;
  titulo: string;
  quantidade: number;
  precoUnitario: number;
  precoTotal: number;
  status: string;
  pontoCarne: string | null;
  observacao: string | null;
  exigePontoCarne: boolean;
  lancadoEm: string;
  lancadoPor: string;
};

type Categoria = { id: string; nome: string; itens: CardapioItemView[] };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PONTOS = ["MAL PASSADO", "AO PONTO", "BEM PASSADO"];

const CORES_STATUS: Record<string, string> = {
  ENVIADO: "text-sky-400",
  EM_PREPARO: "text-amber-400",
  PRONTO: "text-emerald-400",
  // Entregue é o estado morto do ticket, mas ainda precisa ser lido sobre o
  // cinza do cartão.
  ENTREGUE: "text-neutral-400",
};

function horaCurta(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ComandaScreen({
  mesa,
  comanda,
  categorias,
  podeCancelar,
  podeTransferir,
  ajustes,
}: {
  podeCancelar: boolean;
  podeTransferir: boolean;
  ajustes: { exibirNomeGarcom: boolean; limparBuscaAposLancar: boolean };
  mesa: { id: string; numero: string; area: string | null };
  comanda: {
    id: string;
    numero: number;
    pessoas: number;
    nomeCliente: string | null;
    abertaEm: string;
    taxaServicoPct: number;
    chamadoEm: string | null;
    status: string;
    itens: ItemComanda[];
  };
  categorias: Categoria[];
}) {
  const [categoriaAtiva, setCategoriaAtiva] = useState(categorias[0]?.id ?? "");

  /**
   * Qual painel está aberto por cima do cardápio, no celular.
   *
   * No desktop as quatro colunas convivem e isto não é usado. No celular elas
   * viravam quatro faixas de 245px — o cardápio inteiro lido por uma janela de
   * quatro linhas, com três rolagens disputando o mesmo dedo. Aqui o cardápio
   * fica com a tela toda e carrinho e comanda sobem sob demanda.
   */
  const [painel, setPainel] = useState<null | "carrinho" | "comanda">(null);
  const temTeclado = useTemTeclado();

  /**
   * A linha do cardápio que acabou de entrar no carrinho.
   *
   * Lançar um item não mudava nada na tela além de um contador lá embaixo: no
   * meio do salão, com a mesa falando, não dá para ter certeza de que o toque
   * pegou — e a dúvida custa um item lançado duas vezes.
   *
   * O aviso fica na própria linha, e não numa caixa flutuante, porque é ali
   * que o dedo encostou e o olho já está. Um aviso noutro canto obriga a
   * procurar a confirmação de algo que aconteceu debaixo da mão — e, numa
   * tela em que se toca dezenas de vezes por mesa, algo que aparece e some
   * dezenas de vezes cansa.
   */
  const [itemAceso, setItemAceso] = useState<string | null>(null);
  const relogioDoAviso = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sair da tela com o relógio armado deixaria um `setState` procurando um
  // componente que não existe mais.
  useEffect(() => () => {
    if (relogioDoAviso.current) clearTimeout(relogioDoAviso.current);
  }, []);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  // Qual item está com o campo de motivo aberto. Um de cada vez: cancelar é
  // decisão individual, e abrir vários formulários convida ao erro.
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  // Item esperando o PIN de quem pode cancelar.
  const [autorizando, setAutorizando] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const buscaRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const agora = useAgora();

  // O carrinho agora é estado do servidor: itens PENDENTE da própria comanda.
  const carrinho = comanda.itens.filter((i) => i.status === "PENDENTE");
  const lancados = comanda.itens.filter((i) => i.status !== "PENDENTE");
  const fechando = comanda.status === "FECHANDO";

  const todosItens = useMemo(() => categorias.flatMap((c) => c.itens), [categorias]);

  /**
   * A busca é por código, não por nome: o garçom decora os números e digita
   * "63 Enter" muito mais rápido do que caça o produto na lista.
   */
  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return categorias.find((c) => c.id === categoriaAtiva)?.itens ?? [];
    return todosItens.filter(
      (i) => i.codigo.startsWith(termo) || i.titulo.toLowerCase().includes(termo)
    );
  }, [busca, categoriaAtiva, categorias, todosItens]);

  function agir(fn: () => Promise<unknown>, aoConcluir?: () => void) {
    setErro(null);
    iniciar(async () => {
      try {
        // Regra de negócio violada volta como valor, não como exceção: a
        // mensagem de uma exceção não atravessa a server action em produção.
        const r = await fn();
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        aoConcluir?.();
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Algo deu errado.");
      }
    });
  }

  function confirmarCancelamento(itemId: string, autorizacaoId?: string) {
    const texto = motivo.trim();
    if (!texto) return;
    agir(async () => {
      const r = await cancelarItem(itemId, texto, autorizacaoId);
      // Devolver o resultado com erro faz o `agir` mostrar a mensagem.
      if (temErro(r)) return r;
      if (precisaAutorizacao(r)) {
        // Não é erro: é o sistema pedindo a assinatura de quem pode.
        setAutorizando(itemId);
        return;
      }
      setCancelando(null);
      setAutorizando(null);
      setMotivo("");
    });
  }

  function adicionar(item: CardapioItemView) {
    if (item.esgotado) return;
    agir(
      () =>
        adicionarAoCarrinho({
          comandaId: comanda.id,
          produtoId: item.produtoId,
          cardapioItemId: item.id,
          precoUnitario: item.preco,
          exigePontoCarne: item.exigePontoCarne,
        }),
      () => {
        setItemAceso(item.id);
        if (relogioDoAviso.current) clearTimeout(relogioDoAviso.current);
        // Mais curto que um aviso flutuante: está no campo de visão, não
        // precisa de tempo para ser encontrado.
        relogioDoAviso.current = setTimeout(() => setItemAceso(null), 1200);
      }
    );
  }

  function enviar() {
    if (carrinho.length === 0) return;
    agir(() => enviarCarrinho(comanda.id));
  }

  /** Acende a mesa em laranja no mapa antes de abrir a tela de pagamento. */
  function fecharConta() {
    setErro(null);
    iniciar(async () => {
      /**
       * O único lugar que descarta o resultado de propósito.
       *
       * `iniciarFechamento` só acende a mesa em laranja no mapa. Falhar nisso
       * não pode impedir de receber o dinheiro — e uma mensagem de erro aqui
       * pararia o garçom no caminho da tela de pagamento por causa de uma cor.
       */
      try {
        const r = await iniciarFechamento(comanda.id);
        if (temErro(r)) console.error("Não foi possível marcar a comanda como fechando:", r.erro);
      } catch (e) {
        console.error("Não foi possível marcar a comanda como fechando", e);
      }
      router.push(`/pdv/mesa/${mesa.id}/fechar`);
    });
  }

  // F4 busca, F2 envia, F3 fecha, Esc limpa — o turno inteiro passa por esses.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F4") {
        e.preventDefault();
        buscaRef.current?.focus();
        buscaRef.current?.select();
      }
      if (e.key === "F2") {
        e.preventDefault();
        enviar();
      }
      if (e.key === "F3") {
        e.preventDefault();
        fecharConta();
      }
      // "63 Enter" lança o produto. Com a limpeza ligada o campo volta a
      // zero; desligada, o resultado fica na tela e quem lança o mesmo
      // produto várias vezes seguidas só aperta Enter de novo.
      if (e.key === "Enter" && busca.trim() && resultados.length > 0) {
        e.preventDefault();
        adicionar(resultados[0]);
        if (ajustes.limparBuscaAposLancar) setBusca("");
      }
      if (e.key === "Escape") {
        setBusca("");
        buscaRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const totalCarrinho = carrinho.reduce((s, i) => s + i.precoTotal, 0);
  const subtotal = lancados.reduce((s, i) => s + i.precoTotal, 0);
  const taxa = subtotal * (comanda.taxaServicoPct / 100);
  const tempoNaMesa = decorrido(agora, comanda.abertaEm);

  return (
    <div className="flex h-tela flex-col">
      <header className="relative flex shrink-0 items-center gap-4 border-b border-neutral-900 px-4 py-3">
        <BotaoVoltar href="/pdv" />
        <div>
          <h1 className="font-bold leading-tight">
            Mesa {mesa.numero}
            {comanda.nomeCliente && (
              <span className="ml-2 font-normal text-neutral-400">· {comanda.nomeCliente}</span>
            )}
          </h1>
          <p className="texto-apoio text-neutral-500">
            Comanda #{comanda.numero} · {comanda.pessoas}p
            {tempoNaMesa && ` · ${tempoNaMesa}`}
            {mesa.area && ` · ${mesa.area}`}
          </p>
        </div>

        {podeTransferir && (
          <Transferir
            comandaId={comanda.id}
            mesaAtual={mesa.numero}
            aoTransferir={(mesaId) => router.push(`/pdv/mesa/${mesaId}`)}
          />
        )}

        {comanda.chamadoEm && (
          <button
            onClick={() => agir(() => atenderChamado(comanda.id))}
            disabled={pendente}
            className="ml-auto animate-pulse rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            Cliente chamou há {decorrido(agora, comanda.chamadoEm) || "pouco"} · atender
          </button>
        )}
      </header>

      {fechando && (
        // Sem este aviso, o garçom tentaria lançar e só descobriria o motivo
        // pela mensagem de erro, depois de já ter clicado no produto.
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-orange-900/60 bg-orange-950/50 px-4 py-2.5 text-sm">
          <span className="font-semibold text-orange-300">
            Conta em fechamento — o carrinho está travado.
          </span>
          <button
            onClick={() => agir(() => reabrirComanda(comanda.id))}
            disabled={pendente}
            className="rounded-lg bg-orange-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-orange-600 disabled:opacity-50"
          >
            Reabrir mesa
          </button>
          <Link
            href={`/pdv/mesa/${mesa.id}/fechar`}
            className="text-xs text-orange-300/80 underline hover:text-orange-200"
          >
            ir para o pagamento
          </Link>
        </div>
      )}

      {/*
        `grid-rows-[auto_1fr]` no celular: a faixa de categorias toma a altura
        que precisa e o cardápio fica com todo o resto. Sem isso as linhas se
        dividem em partes iguais e sobra um vazio embaixo das categorias — o
        espaço que o cardápio deveria estar usando.
      */}
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[11rem_1fr_20rem_20rem]">
        {/* Categorias */}
        {/*
          No celular isto não existia — era `hidden lg:block`. Como a lista
          mostra só a categoria ativa, e a ativa começava fixa na primeira, o
          garçom pelo telefone via um pedaço do cardápio e mais nada: o resto
          só chegava decorando o código na busca.
        */}
        <nav className="sem-barra-de-rolagem flex shrink-0 gap-2 overflow-x-auto border-b border-neutral-900 px-3 py-2 lg:block lg:gap-0 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-0">
          {categorias.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCategoriaAtiva(c.id);
                setBusca("");
              }}
              className={`h-11 shrink-0 rounded-lg px-4 text-xs font-semibold uppercase tracking-wide transition lg:block lg:h-auto lg:w-full lg:rounded-none lg:border-l-4 lg:px-3 lg:py-3 lg:text-left lg:leading-tight ${
                categoriaAtiva === c.id && !busca
                  ? "bg-orange-700 text-white lg:border-orange-500 lg:bg-neutral-900 lg:text-orange-400"
                  : "bg-neutral-900 text-neutral-400 lg:border-transparent lg:bg-transparent lg:text-neutral-500 lg:hover:bg-neutral-900/60 lg:hover:text-neutral-300"
              }`}
            >
              {c.nome}
            </button>
          ))}
        </nav>

        {/* Produtos */}
        <section className="flex min-h-0 flex-1 flex-col border-r border-neutral-900 lg:flex-none">
          <div className="shrink-0 p-3">
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              /* O campo sempre buscou pelos dois, e o texto só falava do código:
                 quem não decorou o número achava que precisava decorar. */
              placeholder={temTeclado ? "código ou nome do produto (F4)" : "código ou nome do produto"}
              className={`campo-de-busca w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none ${TEXTO_DE_CAMPO}`}
            />
          </div>
          {/* O espaço embaixo é a altura da barra fixa: sem ele o último
              produto da lista nasce atrás dela e não dá para tocar. */}
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 lg:pb-3">
            {resultados.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => adicionar(item)}
                  disabled={item.esgotado || pendente || fechando}
                  /* O traço verde vai por sombra interna, não por borda: uma
                     borda de verdade empurraria a linha 3px para a direita
                     toda vez que alguém tocasse nela. */
                  className={`flex w-full items-center gap-3 border-b border-neutral-900 px-1 py-3 text-left transition disabled:opacity-40 ${
                    itemAceso === item.id
                      ? "bg-emerald-500/10 shadow-[inset_3px_0_0_var(--color-emerald-500)]"
                      : "hover:bg-neutral-900"
                  }`}
                >
                  <span className="w-10 shrink-0 text-xs tabular-nums text-neutral-500">
                    {item.codigo}
                  </span>
                  <span className="flex-1 text-sm leading-tight">
                    {item.titulo}
                    {item.esgotado && (
                      <span className="ml-2 text-[10px] font-bold text-red-500">ESGOTADO</span>
                    )}
                  </span>
                  {itemAceso === item.id && (
                    <span className="shrink-0 text-sm font-bold text-emerald-400" aria-hidden>
                      ✓
                    </span>
                  )}
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-orange-400">
                    {brl.format(item.preco)}
                  </span>
                </button>
              </li>
            ))}
            {resultados.length === 0 && (
              <li className="py-10 text-center text-sm text-neutral-500">Nada encontrado.</li>
            )}
          </ul>
        </section>

        {/* Carrinho — o que ainda não foi para a cozinha */}
        <section className={`flex min-h-0 flex-col bg-neutral-950 ${
          painel === "carrinho" ? "fixed inset-0 z-50" : "hidden"
        } lg:static lg:z-auto lg:flex` + " lg:border-r lg:border-neutral-900"}>
          <h2 className="titulo-de-folha flex shrink-0 items-center gap-2 border-b border-neutral-900 px-3 py-4 text-neutral-100 lg:border-b-0 lg:py-3 lg:text-neutral-400">
            Carrinho
            {carrinho.length > 0 && (
              <span className="rounded-md bg-sky-500 px-2 py-0.5 text-xs font-bold text-white lg:px-1.5 lg:text-[10px]">
                {carrinho.length}
              </span>
            )}
            <BotaoFechar aoFechar={() => setPainel(null)} />
          </h2>
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 lg:pt-0">
            {carrinho.length === 0 && (
              <li className="py-10 text-center text-sm text-neutral-500">
                Nenhum pedido no carrinho
              </li>
            )}
            {carrinho.map((item) => (
              /*
                No celular cada item é um cartão com degradê. A linha de
                `neutral-900` que separava some no preto do salão, e o que
                sobrava era um bloco contínuo de nomes, preços e botões — com
                o risco de somar quantidade no item errado. O degradê clareia
                no topo e escurece na base: dá a borda sem precisar desenhar
                uma. No desktop a coluna é estreita e densa, e continua como
                estava.
              */
              <li
                key={item.id}
                className="mb-2 rounded-xl bg-neutral-900 p-3 lg:mb-0 lg:rounded-none lg:bg-transparent lg:p-0 lg:py-3 lg:border-b lg:border-neutral-900"
              >
                <div className="flex items-start gap-2">
                  <span className="flex-1 text-base font-semibold leading-tight lg:text-sm lg:font-normal">
                    {item.titulo}
                  </span>
                  <span className="shrink-0 text-base font-semibold tabular-nums lg:text-sm">
                    {brl.format(item.precoTotal)}
                  </span>
                </div>
                <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-950 p-1">
                  <button
                    onClick={() => agir(() => alterarQuantidade(item.id, -1))}
                    disabled={pendente || fechando}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-lg leading-none text-neutral-100 transition active:bg-neutral-700 disabled:opacity-40 lg:h-7 lg:w-7 lg:text-base lg:text-neutral-300"
                  >
                    −
                  </button>
                  <span className="w-7 text-center text-base font-semibold tabular-nums lg:w-6 lg:text-sm">
                    {item.quantidade}
                  </span>
                  <button
                    onClick={() => agir(() => alterarQuantidade(item.id, 1))}
                    disabled={pendente || fechando}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-lg leading-none text-neutral-100 transition active:bg-neutral-700 disabled:opacity-40 lg:h-7 lg:w-7 lg:text-base lg:text-neutral-300"
                  >
                    +
                  </button>
                </div>
                {item.exigePontoCarne && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {PONTOS.map((p) => (
                      <button
                        key={p}
                        onClick={() => agir(() => definirPontoCarne(item.id, p))}
                        disabled={pendente || fechando}
                        className={`h-10 rounded-lg px-3 text-xs font-bold tracking-wide transition disabled:opacity-40 lg:h-auto lg:rounded-md lg:px-2 lg:py-1 lg:text-[10px] ${
                          item.pontoCarne === p
                            ? "bg-red-600 text-white"
                            : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {erro && <p className="px-3 pb-2 text-xs text-red-400">{erro}</p>}

          <div className="shrink-0 space-y-2 border-t border-neutral-900 p-3">
            {/* Mesmo peso do total da comanda: é dinheiro que vai para a
                conta assim que o pedido sair daqui, e estava escrito como
                nota de rodapé. O rótulo é "Total" porque o cabeçalho da
                folha já diz que se trata do carrinho. */}
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span className="tabular-nums text-orange-400">{brl.format(totalCarrinho)}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => agir(() => limparCarrinho(comanda.id))}
                disabled={carrinho.length === 0 || pendente || fechando}
                className="rounded-lg bg-neutral-800 px-4 py-3 text-neutral-400 transition hover:bg-neutral-700 disabled:opacity-30"
              >
                Limpar
              </button>
              <button
                onClick={enviar}
                disabled={carrinho.length === 0 || pendente || fechando}
                className="flex-1 rounded-lg bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-30"
              >
                {pendente ? (
                  "Enviando..."
                ) : (
                  <>
                    Enviar para cozinha
                    <span className="hidden lg:inline"> (F2)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Comanda — o que já foi lançado */}
        <section className={`flex min-h-0 flex-col bg-neutral-950 ${
          painel === "comanda" ? "fixed inset-0 z-50" : "hidden"
        } lg:static lg:z-auto lg:flex`}>
          <h2 className="titulo-de-folha flex shrink-0 items-center gap-2 border-b border-neutral-900 px-3 py-4 text-neutral-100 lg:border-b-0 lg:py-3 lg:text-neutral-400">
            Comanda
            <BotaoFechar aoFechar={() => setPainel(null)} />
          </h2>
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 lg:pt-0">
            {lancados.length === 0 && (
              <li className="py-10 text-center text-sm text-neutral-500">Nada lançado ainda</li>
            )}
            {lancados.map((item) => (
              /* Mesmo cartão do carrinho, e aqui pesa mais: cada linha carrega
                 horário, status, ponto da carne e o link de cancelar. Sem uma
                 borda que feche o bloco, é fácil ler o status de um item e o
                 preço do de baixo. */
              <li
                key={item.id}
                className="mb-2 rounded-xl bg-neutral-900 p-3 lg:mb-0 lg:rounded-none lg:bg-transparent lg:p-0 lg:py-3 lg:border-b lg:border-neutral-900"
              >
                <div className="flex items-start gap-2">
                  <span className="flex-1 text-base font-semibold leading-tight lg:text-sm lg:font-medium">
                    {item.quantidade > 1 && (
                      <span className="mr-1 text-neutral-400">{item.quantidade}×</span>
                    )}
                    {item.titulo}
                  </span>
                  <span className="shrink-0 text-base font-semibold tabular-nums lg:text-sm">
                    {brl.format(item.precoTotal)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                  <span className="tabular-nums">{horaCurta(item.lancadoEm)}</span>
                  {ajustes.exibirNomeGarcom && <span>{item.lancadoPor}</span>}
                  <span className={`font-bold ${CORES_STATUS[item.status] ?? "text-neutral-400"}`}>
                    {item.status}
                  </span>
                </div>
                {item.pontoCarne && (
                  <span className="mt-1 inline-block rounded-md bg-red-600/20 px-2 py-0.5 text-[10px] font-bold text-red-400">
                    {item.pontoCarne}
                  </span>
                )}

                {cancelando !== item.id && (
                  <button
                    onClick={() => {
                      setCancelando(item.id);
                      setAutorizando(null);
                      setMotivo("");
                    }}
                    disabled={pendente}
                    /* Aparece para todo mundo agora: quem não tem a permissão
                       segue pelo PIN do gerente, então o botão deixou de ser
                       um caminho sem saída. Discreto porque é exceção, não
                       algo para se esbarrar com o dedo no meio do serviço. */
                    className="mt-1 text-[11px] text-neutral-400 transition hover:text-red-400 disabled:opacity-40"
                  >
                    cancelar item{podeCancelar ? "" : " (com autorização)"}
                  </button>
                )}

                {autorizando === item.id && (
                  <div className="mt-2">
                    <PainelAutorizacao
                      tipo="CANCELAMENTO_ITEM"
                      referenciaId={item.id}
                      motivo={motivo.trim()}
                      aoLiberar={(id) => confirmarCancelamento(item.id, id)}
                      aoDesistir={() => {
                        setAutorizando(null);
                        setCancelando(null);
                      }}
                    />
                  </div>
                )}

                {cancelando === item.id && autorizando !== item.id && (
                  <div className="mt-2 space-y-2 rounded-lg bg-neutral-900 p-2">
                    <input
                      autoFocus
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmarCancelamento(item.id);
                        if (e.key === "Escape") setCancelando(null);
                      }}
                      placeholder="Motivo (obrigatório)"
                      className={`w-full rounded-md bg-neutral-950 px-2 py-2 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-red-500 ${TEXTO_DE_CAMPO}`}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCancelando(null)}
                        className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition hover:bg-neutral-700"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={() => confirmarCancelamento(item.id)}
                        disabled={!motivo.trim() || pendente}
                        className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-30"
                      >
                        Cancelar {item.titulo}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="shrink-0 space-y-1 border-t border-neutral-900 p-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Subtotal</span>
              <span className="tabular-nums">{brl.format(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Taxa {comanda.taxaServicoPct}%</span>
              <span className="tabular-nums">{brl.format(taxa)}</span>
            </div>
            <div className="flex justify-between border-t border-neutral-800 pt-2 text-lg font-bold">
              <span>Total</span>
              <span className="tabular-nums text-orange-400">{brl.format(subtotal + taxa)}</span>
            </div>
            <button
              onClick={fecharConta}
              disabled={pendente}
              className="mt-2 w-full rounded-lg bg-orange-700 py-3 text-center font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
            >
              Fechar conta
              <span className="hidden lg:inline"> (F3)</span>
            </button>
          </div>
        </section>
      </div>

      {/*
        O resumo mora no rodapé, no alcance do polegar, e o carrinho sobe só
        quando é hora de conferir. Assim o cardápio fica com a tela inteira em
        vez de dividi-la com dois painéis quase sempre vazios — antes o
        "Nenhum pedido no carrinho" reservava 241px enquanto o cardápio se
        espremia em 247px.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-2 border-t border-neutral-800 bg-neutral-900 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden">
        <button
          onClick={() => setPainel("comanda")}
          className="flex h-16 flex-1 flex-col items-start justify-center rounded-lg bg-neutral-950 px-4 transition active:bg-neutral-800"
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            Comanda
          </span>
          <span className="text-base font-bold tabular-nums text-orange-400">
            {brl.format(subtotal + taxa)}
          </span>
        </button>

        <button
          onClick={() => setPainel("carrinho")}
          className={`flex h-16 flex-1 flex-col items-start justify-center rounded-lg px-4 transition ${
            carrinho.length > 0
              ? "bg-emerald-600 text-white active:bg-emerald-700"
              : "bg-neutral-950 text-neutral-500 active:bg-neutral-800"
          }`}
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest opacity-80">
            Carrinho{carrinho.length > 0 ? ` · ${carrinho.length}` : ""}
          </span>
          <span className="text-base font-bold tabular-nums">{brl.format(totalCarrinho)}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Fecha a folha aberta. Só existe no celular — no desktop carrinho e comanda
 * são colunas fixas, que não abrem nem fecham.
 */
function BotaoFechar({ aoFechar }: { aoFechar: () => void }) {
  return (
    <button
      onClick={aoFechar}
      aria-label="Fechar"
      className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-900 text-neutral-400 transition active:bg-neutral-800 lg:hidden"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      </svg>
    </button>
  );
}
