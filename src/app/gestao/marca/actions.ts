"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { auditoria } from "@/lib/auditoria-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";
import { doEndereco, type FundoDaLogo } from "@/lib/marca";

/**
 * A marca é da empresa, não da unidade: quem a troca é o dono.
 */
const PERMISSAO = "unidade.configurar";

/**
 * O que todo navegador desenha sem surpresa.
 *
 * SVG fica de fora de propósito. É XML executável — um `<script>` dentro do
 * arquivo rodaria no domínio do sistema, com a sessão de quem abriu. Para uma
 * logomarca, PNG com fundo transparente resolve o mesmo problema sem abrir
 * essa porta.
 */
type TipoDeImagem = "image/png" | "image/jpeg" | "image/webp";

/**
 * Meio mega.
 *
 * A imagem vive numa linha do banco e viaja em toda carga fria das telas que
 * a mostram. Meio mega é folgado para uma logo — as que se usa têm 20 a 80 KB
 * — e ainda assim impede alguém de subir a foto de 8 MB que veio do celular.
 */
const TAMANHO_MAXIMO = 512 * 1024;

/** `#0a0a0a`, sempre em seis dígitos: o `input type="color"` só devolve assim. */
const COR = /^#[0-9a-f]{6}$/i;

function comecaCom(bytes: Uint8Array, assinatura: number[], desde = 0) {
  return assinatura.every((b, i) => bytes[desde + i] === b);
}

/** "RIFF", "WEBP" — assinaturas escritas em texto viram números uma vez só. */
const emAscii = (texto: string) => [...texto].map((c) => c.charCodeAt(0));

/**
 * O tipo lido dos bytes, e não do que o navegador disse.
 *
 * `File.type` vem do cliente: um HTML renomeado chega aqui anunciado como PNG.
 * O `nosniff` da rota já impede o navegador de executá-lo, mas guardar no banco
 * um arquivo que não é imagem é sujeira que ninguém vai achar depois. Aqui a
 * assinatura decide, e o que o cliente disse não conta.
 */
function tipoReal(bytes: Uint8Array): TipoDeImagem | null {
  if (comecaCom(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (comecaCom(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (comecaCom(bytes, emAscii("RIFF")) && comecaCom(bytes, emAscii("WEBP"), 8)) return "image/webp";
  return null;
}

function revalidar() {
  revalidatePath("/gestao", "layout");
  revalidatePath("/login");
  revalidatePath("/mesa", "layout");
}

/** No diário, "claro" e "escuro" dizem mais do que CLARO e ESCURO. */
const porExtenso = (fundo: FundoDaLogo) => (fundo === "CLARO" ? "fundo claro" : "fundo escuro");

export async function salvarLogomarca(dados: FormData) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const fundo = doEndereco(String(dados.get("fundo") ?? ""));
    if (!fundo) throw new ErroDeOperacao("Versão desconhecida.");

    const arquivo = dados.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) {
      throw new ErroDeOperacao("Escolha um arquivo de imagem.");
    }

    // O tamanho é conferido antes de ler: não faz sentido carregar 8 MB na
    // memória para só então dizer que 8 MB é demais.
    if (arquivo.size > TAMANHO_MAXIMO) {
      throw new ErroDeOperacao(
        `A imagem tem ${Math.round(arquivo.size / 1024)} KB. O limite é 512 KB.`
      );
    }

    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const tipo = tipoReal(bytes);
    if (!tipo) throw new ErroDeOperacao("A logomarca precisa ser PNG, JPG ou WebP.");

    const antes = await db.logomarca.findUnique({
      where: { tenantId_fundo: { tenantId: sessao.tenantId, fundo } },
      select: { tipo: true },
    });

    await db.logomarca.upsert({
      where: { tenantId_fundo: { tenantId: sessao.tenantId, fundo } },
      create: { tenantId: sessao.tenantId, fundo, bytes, tipo },
      // `criadoEm` é o que muda a URL da imagem: sem ele, o navegador
      // continuaria mostrando a logo antiga que guardou para sempre.
      update: { bytes, tipo, criadoEm: new Date() },
    });

    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "Tenant",
        entidadeId: sessao.tenantId,
        acao: "MARCA_ALTERADA",
        antes: { versao: porExtenso(fundo), imagem: antes?.tipo ?? "nenhuma" },
        depois: { versao: porExtenso(fundo), imagem: tipo },
      }),
    });

    revalidar();
  });
}

export async function removerLogomarca(qual: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const fundo = doEndereco(qual);
    if (!fundo) throw new ErroDeOperacao("Versão desconhecida.");

    const antes = await db.logomarca.findUnique({
      where: { tenantId_fundo: { tenantId: sessao.tenantId, fundo } },
      select: { tipo: true },
    });
    if (!antes) throw new ErroDeOperacao("Não há logomarca para remover.");

    await db.logomarca.delete({
      where: { tenantId_fundo: { tenantId: sessao.tenantId, fundo } },
    });

    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "Tenant",
        entidadeId: sessao.tenantId,
        acao: "MARCA_ALTERADA",
        antes: { versao: porExtenso(fundo), imagem: antes.tipo },
        depois: { versao: porExtenso(fundo), imagem: "removida" },
      }),
    });

    revalidar();
  });
}

/**
 * A cor é da casa, não da versão: ela existe para resgatar a única logo
 * cadastrada quando ela cai na tela do fundo contrário.
 */
export async function salvarCorDeFundo(cor: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const escolhida = cor.trim();
    if (escolhida && !COR.test(escolhida)) throw new ErroDeOperacao("Cor inválida.");

    const antes = await db.tenant.findUniqueOrThrow({
      where: { id: sessao.tenantId },
      select: { logoCorFundo: true },
    });

    await db.tenant.update({
      where: { id: sessao.tenantId },
      data: { logoCorFundo: escolhida || null },
    });

    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "Tenant",
        entidadeId: sessao.tenantId,
        acao: "MARCA_ALTERADA",
        antes: { corDeFundo: antes.logoCorFundo },
        depois: { corDeFundo: escolhida || null },
      }),
    });

    revalidar();
  });
}
