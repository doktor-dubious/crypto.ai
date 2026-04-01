import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const body = await request.text()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    })

    const data = await res.text()
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { detail: "Request timed out" },
        { status: 504 },
      )
    }
    return NextResponse.json(
      { detail: "Backend unavailable" },
      { status: 502 },
    )
  } finally {
    clearTimeout(timeout)
  }
}
