import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Porteiro das rotas de operação. Só confere se o cookie é válido — a checagem
 * de permissão por cargo fica nas server actions, onde a ação realmente
 * acontece e não dá para burlar pela URL.
 */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get("sessao")?.value;
  let valido = false;

  if (token && process.env.AUTH_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET));
      valido = true;
    } catch {
      valido = false;
    }
  }

  if (!valido) {
    const login = new URL("/login", request.url);
    // Guarda para onde a pessoa ia, e devolve para lá depois do login.
    login.searchParams.set("de", request.nextUrl.pathname);
    const resposta = NextResponse.redirect(login);
    if (token) resposta.cookies.delete("sessao");
    return resposta;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/pdv/:path*", "/kds/:path*", "/gestao/:path*"],
};
