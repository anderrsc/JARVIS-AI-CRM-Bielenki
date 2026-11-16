import { createServerClient } from "@supabase/ssr";
// O navegador nunca usa o Supabase direto: a sessão pode ficar só em cookie httpOnly.
const SECURE_COOKIE = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const };
import { NextResponse, type NextRequest } from "next/server";

// Renova a sessão Supabase nos cookies. A autorização acontece no servidor (lib/auth.ts).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, ...SECURE_COOKIE }));
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
