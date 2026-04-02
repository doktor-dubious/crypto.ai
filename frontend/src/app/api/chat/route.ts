import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"

export const maxDuration = 300

export async function POST(request: NextRequest) {
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
