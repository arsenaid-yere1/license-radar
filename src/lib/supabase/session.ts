import { authenticationRequired } from "@/lib/auth/operations";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          for (const { name, value } of values)
            request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of values)
            response.cookies.set(name, value, options);
        },
      },
    },
  );
  const { data, error } = await client.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  if (
    request.method !== "POST" &&
    !data?.claims &&
    !(error && !authenticationRequired(error.status)) &&
    request.nextUrl.pathname !== "/login"
  ) {
    const redirected = NextResponse.redirect(new URL("/login", request.url));
    for (const cookie of response.cookies.getAll())
      redirected.cookies.set(cookie);
    for (const name of ["cache-control", "pragma", "expires"])
      redirected.headers.set(name, response.headers.get(name)!);
    return redirected;
  }
  return response;
}
