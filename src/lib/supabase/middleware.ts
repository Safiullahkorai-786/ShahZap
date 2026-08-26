import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Page HTML must always revalidate — prevents stale cached shells from
  // referencing outdated builds. RSC/data payloads are left untouched so
  // client-side navigations stay cheap on slow connections.
  const accept = request.headers.get('accept') ?? ''
  const isHtmlDoc = accept.includes('text/html')
  if (isHtmlDoc) response.headers.set('Cache-Control', 'no-cache, must-revalidate');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}
