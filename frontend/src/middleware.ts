import { NextRequest, NextResponse } from "next/server"

const PUBLIC_PATHS = ["/login", "/share"]
const SKIP_PREFIXES = ["/api/", "/_next/", "/favicon"]
// Unauthenticated GETs allowed through the backend proxy: the public /share
// page reads its conversation through this endpoint without a session.
const PUBLIC_BACKEND_GETS = [/^\/backend\/api\/v1\/chat\/sessions\/[^/]+$/]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // The /backend/* rewrite proxies straight to FastAPI, which has no auth of
  // its own — every proxied call must carry a valid session (API traffic gets
  // a 401, not a login redirect).
  const isBackend = pathname.startsWith("/backend/")
  if (
    isBackend &&
    request.method === "GET" &&
    PUBLIC_BACKEND_GETS.some((re) => re.test(pathname))
  ) {
    return NextResponse.next()
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  let session = null
  try {
    const res = await fetch(new URL("/api/auth/get-session", request.url), {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    })
    const data = await res.json()
    session = data?.session ?? null
  } catch {
    if (isBackend) {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 })
    }
    if (isPublic) return NextResponse.next()
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (!session) {
    if (isBackend) {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 })
    }
    if (!isPublic) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
  }

  if (session && isPublic && !pathname.startsWith("/share")) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
