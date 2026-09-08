import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return { url, key };
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const { url, key } = config();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot always write cookies. Middleware refreshes sessions.
        }
      },
    },
  });
}

export function createRequestSupabaseClient(request: Request, response: Response) {
  const { url, key } = config();
  const requestCookies = request.headers.get("cookie") ?? "";
  const parsed = requestCookies
    .split(";")
    .map((pair) => pair.trim().split("="))
    .filter(([name]) => Boolean(name))
    .map(([name, ...parts]) => ({ name, value: parts.join("=") }));
  return createServerClient(url, key, {
    cookies: {
      getAll: () => parsed,
      setAll(values) {
        values.forEach(({ name, value, options }) => {
          const serialized = `${name}=${value}; Path=${options?.path ?? "/"}${options?.httpOnly ? "; HttpOnly" : ""}${options?.secure ? "; Secure" : ""}`;
          response.headers.append("Set-Cookie", serialized);
        });
      },
    },
  });
}
