import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { criarTokenDeOperador, unidadeDoAparelho } from "@/lib/maquininha";
import { limparFalhas, registrarFalha, verificar } from "@/lib/limite-tentativas";

export const dynamic = "force-dynamic";

/** Quem recebe pela maquininha precisa poder receber pagamento no salão. */
const PERMISSAO = "comanda.receberPagamento";

/**
 * POST /api/maquininha/entrar — o operador começa o turno no aparelho.
 *
 * Recebe o PIN, devolve o token do turno. O PIN nunca fica guardado na
 * maquininha: o que ela guarda é o token, que vence em doze horas.
 */
export async function POST(request: NextRequest) {
  const unidade = await unidadeDoAparelho(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token do aparelho inválido." }, { status: 401 });
  }
  declararTenant(unidade.tenantId);

  /*
   * O freio conta por aparelho, e não por IP: várias maquininhas saem pelo
   * mesmo IP do restaurante, e um garçom errando o PIN travaria o salão.
   */
  const chave = `maquininha:${unidade.id}`;
  const freio = await verificar(chave);
  if (freio.bloqueado) {
    const minutos = Math.ceil(freio.segundosRestantes / 60);
    return NextResponse.json(
      { erro: `Muitas tentativas. Tente de novo em ${minutos} minuto(s).` },
      { status: 429 }
    );
  }

  let corpo: { pin?: string };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }
  const pin = typeof corpo?.pin === "string" ? corpo.pin.trim() : "";
  if (!pin) return NextResponse.json({ erro: "Informe o PIN." }, { status: 400 });

  /*
   * O PIN é hash, então não dá para consultar por igualdade: compara contra a
   * equipe ativa desta unidade. É uma lista pequena (a escala de um
   * restaurante), e a mesma solução do login do salão.
   */
  const equipe = await db.usuario.findMany({
    where: {
      tenantId: unidade.tenantId,
      ativo: true,
      pinHash: { not: null },
      unidades: { some: { unidadeId: unidade.id } },
    },
    select: {
      id: true,
      nome: true,
      pinHash: true,
      unidades: {
        where: { unidadeId: unidade.id },
        select: {
          cargo: {
            select: {
              nome: true,
              permissoes: { where: { permitido: true }, select: { chave: true } },
            },
          },
        },
      },
    },
  });

  for (const usuario of equipe) {
    if (!(await bcrypt.compare(pin, usuario.pinHash!))) continue;

    const cargo = usuario.unidades[0]?.cargo;
    const permissoes = cargo?.permissoes.map((p) => p.chave) ?? [];
    const pode = permissoes.includes("*") || permissoes.includes(PERMISSAO);
    if (!pode) {
      // PIN certo, cargo errado: não conta como tentativa falha, e a mensagem
      // diz o que fazer — chamar quem opera o caixa.
      await limparFalhas(chave);
      return NextResponse.json(
        { erro: `${usuario.nome} (${cargo?.nome ?? "sem cargo"}) não recebe pagamento.` },
        { status: 403 }
      );
    }

    await limparFalhas(chave);
    const operador = {
      usuarioId: usuario.id,
      tenantId: unidade.tenantId,
      unidadeId: unidade.id,
      nome: usuario.nome,
      cargo: cargo!.nome,
      permissoes,
    };
    return NextResponse.json({
      token: await criarTokenDeOperador(operador),
      nome: operador.nome,
      cargo: operador.cargo,
      unidade: unidade.nome,
    });
  }

  const veredito = await registrarFalha(chave);
  const minutos = veredito.bloqueado ? Math.ceil(veredito.segundosRestantes / 60) : 0;
  return NextResponse.json(
    {
      erro: veredito.bloqueado
        ? `Muitas tentativas. Tente de novo em ${minutos} minuto(s).`
        : "PIN não reconhecido.",
    },
    { status: veredito.bloqueado ? 429 : 401 }
  );
}
