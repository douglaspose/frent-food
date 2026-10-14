import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { ajusteBooleano } from "@/lib/parametros-servidor";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Abrir a mesa — a regra que o PDV e a maquininha compartilham.
 *
 * Nasceu dentro da action do PDV, e ficou lá enquanto só o tablet abria mesa.
 * Quando o garçom passou a atender com o aparelho na mão, a escolha era copiar
 * a numeração da comanda para a porta da maquininha ou trazer a regra para um
 * lugar só. Copiada, a segunda cópia seria a que esquece a trava — e o preço
 * disso já é conhecido: no dia simulado de 180 comandas, 50 de 222 aberturas
 * falhavam por número repetido antes de a trava existir.
 *
 * Quem chama confere quem é a pessoa e se ela pode abrir; aqui cuida-se do que
 * acontece com a mesa.
 */

/** Quem está abrindo. No PDV é a sessão; na maquininha, o operador do PIN. */
export type QuemAbre = {
  usuarioId: string;
  tenantId: string;
  unidadeId: string;
};

/**
 * O nome vai para a comanda, para o mapa e para o papel da impressora.
 * Caractere de controle sai (o byte zero derrubava a action, e o resto chegava
 * à térmica como comando); e um nome tem tamanho de nome — cinco mil
 * caracteres eram gravados e impressos inteiros.
 */
export function limparNomeDoCliente(nome: string | null | undefined) {
  const limpo = nome?.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!limpo) return null;
  if (limpo.length > 80) throw new ErroDeOperacao("O nome do cliente vai até 80 caracteres.");
  return limpo;
}

export async function abrirMesa(
  quem: QuemAbre,
  dados: { mesaId: string; pessoas: number; nomeCliente?: string | null }
) {
  // A mesma regra de `definirPessoas`: -3 pessoas abria a mesa e estragava a
  // divisão por pessoa na hora de pagar.
  if (!Number.isInteger(dados.pessoas) || dados.pessoas < 1 || dados.pessoas > 99) {
    throw new ErroDeOperacao("Informe de 1 a 99 pessoas.");
  }

  const nomeCliente = limparNomeDoCliente(dados.nomeCliente);

  const mesa = await db.mesa.findUniqueOrThrow({
    where: { id: dados.mesaId },
    include: { unidade: { select: { taxaServicoPct: true } } },
  });
  // Nem trocando o id na URL, nem mandando o id na porta aberta da maquininha.
  if (mesa.tenantId !== quem.tenantId) throw new ErroDeOperacao("Mesa de outro restaurante.");
  if (mesa.unidadeId !== quem.unidadeId) throw new ErroDeOperacao("Mesa de outra unidade.");

  /*
   * Mesa já aberta devolve a comanda que existe, e não um erro.
   *
   * Dois garçons chegando na mesma mesa é rotina no salão, e a maquininha
   * ainda reenvia o pedido quando a rede engasga: nos dois casos, o que se
   * quer é a conta daquela mesa — não uma segunda conta, nem uma recusa que
   * obrigue o garçom a descobrir qual das duas é a boa.
   */
  const jaAberta = await db.comanda.findFirst({
    where: { mesaId: mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
    select: { id: true },
  });
  if (jaAberta) return { comandaId: jaAberta.id, jaEstavaAberta: true };

  if (!nomeCliente && (await ajusteBooleano(mesa.unidadeId, "mesa.exigirIdentificacaoCliente"))) {
    throw new ErroDeOperacao("Esta unidade exige o nome do cliente para abrir a mesa.");
  }

  const comanda = await db.$transaction(async (tx) => {
    /**
     * Uma abertura por vez na unidade.
     *
     * O max+1 era lido fora da transação: no dia simulado de 180 comandas, 50
     * de 222 aberturas falharam por número repetido, e dois garçons na mesma
     * mesa podiam abrir duas comandas. A trava da linha da unidade (NO KEY
     * UPDATE, que não bloqueia quem só referencia a unidade) enfileira as
     * aberturas; dentro dela, a mesa é conferida de novo e o número lido é o
     * último de verdade.
     */
    await tx.$queryRaw`SELECT id FROM unidades WHERE id = ${mesa.unidadeId} FOR NO KEY UPDATE`;

    const aberta = await tx.comanda.findFirst({
      where: { mesaId: mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
    });
    if (aberta) return { id: aberta.id, jaEstavaAberta: true };

    const ultima = await tx.comanda.findFirst({
      where: { unidadeId: mesa.unidadeId },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });

    const criada = await tx.comanda.create({
      data: {
        tenantId: mesa.tenantId,
        unidadeId: mesa.unidadeId,
        numero: (ultima?.numero ?? 0) + 1,
        origem: "MESA",
        mesaId: mesa.id,
        pessoas: dados.pessoas,
        nomeCliente,
        taxaServicoPct: mesa.unidade.taxaServicoPct,
        abertaPorId: quem.usuarioId,
      },
    });
    await tx.mesa.update({ where: { id: mesa.id }, data: { status: "OCUPADA" } });
    return { id: criada.id, jaEstavaAberta: false };
  });

  // Fora da transação: avisar o salão é efeito externo, e uma falha no aviso
  // não pode desfazer a mesa que já está aberta.
  if (!comanda.jaEstavaAberta) await publicar(mesa.unidadeId, "mesa-aberta");
  return { comandaId: comanda.id, jaEstavaAberta: comanda.jaEstavaAberta };
}

/**
 * As mesas livres da unidade, para quem vai abrir uma.
 *
 * "Livre" é não ter comanda aberta, e não o campo `status` da mesa: o status é
 * cache do mapa do salão, e uma mesa que ficou OCUPADA por um fechamento
 * interrompido sumiria da lista do garçom que está de pé na frente dela.
 */
export async function mesasLivres(unidadeId: string) {
  const mesas = await db.mesa.findMany({
    where: {
      unidadeId,
      ativo: true,
      comandas: { none: { status: { in: ["ABERTA", "FECHANDO"] } } },
    },
    orderBy: [{ area: { ordem: "asc" } }],
    select: { id: true, numero: true, capacidade: true, area: { select: { nome: true } } },
  });

  /*
   * A ordem do número sai no JavaScript, como no mapa do salão: `numero` é
   * texto, porque a casa batiza mesa de "12A", e o banco ordenaria 1, 10, 11,
   * 2 — o garçom procurando a 2 a encontraria no fim da lista.
   */
  return mesas
    .sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero))
    .map((m) => ({
      mesaId: m.id,
      numero: m.numero,
      capacidade: m.capacidade,
      area: m.area?.nome ?? null,
    }));
}
