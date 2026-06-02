import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const nextConfig: NextConfig = {
  output: "standalone",

  // Pricing-analytics endpoints can take 30–60s on customers with thousands
  // of outlets (bulk SQL + per-outlet loops). The default 30s rewrite proxy
  // timeout aborts these mid-flight, surfacing as ECONNRESET / "Failed to
  // load pricing analytics". 2 minutes leaves headroom for the slowest
  // current call (~45s viability on 7.2K outlets). Despite the top-level
  // schema accepting it, Next.js 16's router-server reads the value from
  // experimental.proxyTimeout.
  experimental: {
    proxyTimeout: 120_000,
  },

  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"
    return [
      {
        source: "/backend/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ]
  },
}

export default withNextIntl(nextConfig)
