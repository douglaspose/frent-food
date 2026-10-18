"use client";

import { useState, useTransition } from "react";
import { receberBalcao } from "./balcao-actions";
import { PainelAutorizacao } from "./painel-autorizacao";
import { precisaAutorizacao } from "@/lib/autorizacao";
import { temErro } from "@/lib/erro-de-operacao";
import type { ComandaSemMesa, FormaDePagamentoView } from "./mapa-mesas";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Receber à mão a venda de balcão que a maquininha não conseguiu registrar.
 *
 * O caminho do fim: a venda existe na adquirente, o cartão do cliente foi
 * debitado, e o sistema recusou aquele envio — valor acima do que a coluna
 * guarda, conta que sumiu, referência repetida. A comanda ficou aberta, fora
 * do mapa do salão, travando o fechamento do caixa.
 *
 * Três passos de propósito, e não um: abrir, escolher a forma, confirmar. O
 * primeiro evita o toque sem querer numa faixa de aviso; o segundo é a única
 * decisão que a casa precisa tomar (onde o dinheiro caiu e qual a taxa); o
 * terceiro mostra o valor que vai entrar, porque depois disso ele é
 * faturamento do dia.
 */
export function ReceberBalcao({
  comanda,
  formas,
}: {
  comanda: ComandaSemMesa;
  formas: FormaDePagamentoView[];
}) {
  const [aberto, setAberto] = useState(false);
  const [forma, setForma] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindoPin, setPedindoPin] = useState(false);
  const [pendente, iniciar] = useTransition();

  function receber(autorizacaoId?: string) {
    if (!forma) return;
    setErro(null);
    iniciar(async () => {
      const r = await receberBalcao(comanda.id, forma, autorizacaoId);
      if (precisaAutorizacao(r)) {
        setPedindoPin(true);
        return;
      }
      if (temErro(r)) {
        setPedindoPin(false);
        setErro(r.erro);
        return;
      }
      // Deu certo: a faixa some sozinha quando a página se refaz.
      setPedindoPin(false);
      setAberto(false);
    });
  }

  if (pedindoPin) {
    return (
      <PainelAutorizacao
        tipo="RECEBER_BALCAO"
        referenciaId={comanda.id}
        motivo={`Venda de balcão #${comanda.numero} · ${brl.format(comanda.falta)}`}
        aoLiberar={(autorizacaoId) => receber(autorizacaoId)}
        aoDesistir={() => setPedindoPin(false)}
      />
    );
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="ml-2 rounded px-2 py-1 text-xs font-semibold text-amber-200 underline underline-offset-2 hover:text-amber-100"
      >
        receber pela retaguarda
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-900/60 bg-neutral-950 p-3">
      <p className="text-xs text-neutral-400">
        {comanda.falta > 0 ? (
          <>
            Registra {brl.format(comanda.falta)} como recebido e fecha a comanda. Faça com o
            comprovante da maquininha na frente — o sistema não tem como conferir esta venda.
          </>
        ) : (
          <>
            Esta venda já recebeu {brl.format(comanda.recebido)} e ficou aberta: nada entra, só
            o fechamento que faltou. Enquanto ela estiver aberta, o caixa não fecha.
          </>
        )}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {formas.map((f) => (
          <button
            key={f.id}
            onClick={() => setForma(f.id)}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
              forma === f.id
                ? "bg-amber-700 text-white"
                : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {f.nome}
          </button>
        ))}
      </div>

      {erro && <p className="mt-2 text-xs text-red-400">{erro}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => receber()}
          disabled={!forma || pendente}
          className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {pendente
            ? "Recebendo..."
            : comanda.falta > 0
              ? `Receber ${brl.format(comanda.falta)}`
              : "Fechar esta venda"}
        </button>
        <button
          onClick={() => {
            setAberto(false);
            setErro(null);
          }}
          className="rounded-lg px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
