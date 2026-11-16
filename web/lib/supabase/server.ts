import "server-only";
import { createServerClient } from "@supabase/ssr";
// O navegador nunca usa o Supabase direto: a sessão pode ficar só em cookie httpOnly.
const SECURE_COOKIE = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const };
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, { ...options, ...SECURE_COOKIE }));
          } catch {
            // Server Component: o proxy renova a sessão.
          }
        },
      },
    },
  );
}
