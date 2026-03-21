import { NextRequest, NextResponse } from "next/server"

const PUBLIC_PATHS = ["/login"]
const SKIP_PREFIXES = ["/api/", "/backend/", "/_next/", "/favicon"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) {
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
    if (isPublic) return NextResponse.next()
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (!session && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (session && isPublic) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
