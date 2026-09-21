import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * O cliente do simulador: dono do banco, sem RLS e sem o guarda de consulta.
 *
 * Montar o restaurante e conferir o fim do dia exigem enxergar tudo — é o
 * papel de quem administra, não de quem opera. As server actions nunca passam
 * por aqui: elas usam o `db` de sempre, sob RLS, como em produção.
 */
const url = process.env.CARGA_ADMIN_URL;
if (!url) throw new Error("CARGA_ADMIN_URL ausente: rode pelo `npm run teste:dia`.");

export const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
