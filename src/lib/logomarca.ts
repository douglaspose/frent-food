import "server-only";
import { db, dbSemRls } from "./db";
import { COR_DE_FUNDO_PADRAO, noEndereco, type FundoDaLogo, type Marca } from "./marca";

/**
 * A logomarca da casa, e onde ela pode ser lida.
 *
 * Quem já sabe de que restaurante é a tela lê pelo cliente de todo dia, com o
 * isolamento valendo. Só duas leituras saem dele, e por necessidade: o login,
 * que é anterior à sessão, e a rota que serve a imagem, aberta pelo navegador
 * sem cookie nenhum. Essas duas passam por `dbSemRls`.
 *
 * A saída do isolamento se justifica pelo que está sendo lido: logomarca é a
 * coisa mais pública que um restaurante tem — está na fachada e no guardanapo.
 * Nenhuma outra coluna sai por aqui, e a consulta é sempre por id ou por slug,
 * nunca uma listagem.
 *
 * O tipo e a cor padrão moram em `marca.ts`, e não aqui, porque a tela de
 * cadastro é componente de cliente: importar daqui levaria o `server-only`
 * junto — e a rota inteira deixa de compilar.
 */

/**
 * Os bytes ficam de fora de propósito: quem desenha a marca quer saber se ela
 * existe e de quando é, não carregar 50 KB de imagem no HTML de toda tela.
 */
const CAMPOS = {
  id: true,
  nome: true,
  logoCorFundo: true,
  logomarcas: { select: { fundo: true, criadoEm: true } },
} as const;

type TenantComMarca = {
  id: string;
  nome: string;
  logoCorFundo: string | null;
  logomarcas: { fundo: FundoDaLogo; criadoEm: Date }[];
};

/**
 * Escolhe a versão que a tela pede — e, não havendo, a que existir.
 *
 * A troca é assimétrica de propósito. Mostrar a versão do fundo errado sem
 * mais nada some com a logo; com o retângulo de cor atrás, ela se lê. Por isso
 * o resgate só é montado no caso de troca: quando a versão é a certa, pintar
 * um retângulo seria estragar a única coisa que a casa desenhou para ali.
 */
function montar(tenant: TenantComMarca, fundo: FundoDaLogo): Marca {
  const exata = tenant.logomarcas.find((l) => l.fundo === fundo);
  const escolhida = exata ?? tenant.logomarcas[0];

  if (!escolhida) return { src: null, corDeFundo: null, nome: tenant.nome };

  return {
    // O timestamp na URL é o que permite guardar a imagem para sempre e ainda
    // assim ver a troca no instante em que ela acontece.
    src: `/logo/${tenant.id}/${noEndereco(escolhida.fundo)}?v=${escolhida.criadoEm.getTime()}`,
    corDeFundo: exata ? null : (tenant.logoCorFundo ?? COR_DE_FUNDO_PADRAO),
    nome: tenant.nome,
  };
}

export async function logomarcaDoTenant(tenantId: string, fundo: FundoDaLogo) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: CAMPOS });
  return tenant ? montar(tenant, fundo) : null;
}

/**
 * A logomarca a mostrar numa tela sem sessão, a partir do endereço.
 *
 * O `slug` do tenant é o subdomínio — "lipao" em lipao.meusistema.com.br. Em
 * desenvolvimento não há subdomínio nenhum, e numa instalação de um
 * restaurante só também não haverá: por isso, não achando pelo endereço, cai
 * para o único tenant que existir. Com dois ou mais, sem subdomínio, não há
 * como saber de quem é a tela — e aí não mostra logo nenhuma, que é melhor do
 * que mostrar a do vizinho.
 */
export async function logomarcaPeloEndereco(host: string | null, fundo: FundoDaLogo) {
  const subdominio = host?.split(":")[0]?.split(".")[0];

  if (subdominio) {
    const porSlug = await dbSemRls.tenant.findUnique({
      where: { slug: subdominio },
      select: CAMPOS,
    });
    if (porSlug) return montar(porSlug, fundo);
  }

  const todos = await dbSemRls.tenant.findMany({ where: { ativo: true }, select: CAMPOS, take: 2 });
  return todos.length === 1 ? montar(todos[0]!, fundo) : null;
}

/** Os bytes, para a rota que serve a imagem. */
export async function bytesDaLogomarca(tenantId: string, fundo: FundoDaLogo) {
  return dbSemRls.logomarca.findUnique({
    where: { tenantId_fundo: { tenantId, fundo } },
    select: { bytes: true, tipo: true },
  });
}

/**
 * As duas versões e a cor, para a tela de cadastro.
 *
 * Aqui não há escolha a fazer — a tela mostra as duas lado a lado, cada uma
 * sobre o fundo a que se destina, que é o argumento inteiro dela.
 */
export async function versoesDaLogomarca(tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: CAMPOS });
  if (!tenant) return null;

  const endereco = (fundo: FundoDaLogo) => {
    const versao = tenant.logomarcas.find((l) => l.fundo === fundo);
    return versao ? `/logo/${tenant.id}/${noEndereco(fundo)}?v=${versao.criadoEm.getTime()}` : null;
  };

  return {
    nome: tenant.nome,
    corDeFundo: tenant.logoCorFundo ?? COR_DE_FUNDO_PADRAO,
    claro: endereco("CLARO"),
    escuro: endereco("ESCURO"),
  };
}
