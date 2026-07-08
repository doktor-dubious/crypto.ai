import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/lib/auth"

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"

export const maxDuration = 300

export async function POST(request: NextRequest) {
  // This route is under /api/ (skipped by the auth middleware) and proxies to
  // the unauthenticated backend — so it must verify the session itself.
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 })
  }

  const body = await request.text()

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })

    if (!res.ok) {
      const text = await res.text()
      return new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } })
    }

    // Proxy the SSE stream directly
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (err) {
    return NextResponse.json({ detail: "Backend unavailable" }, { status: 502 })
  }
}
