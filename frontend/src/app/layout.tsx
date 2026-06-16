import type { Metadata } from "next"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getMessages } from "next-intl/server"
import { ThemeProvider } from "next-themes"
import { QueryProvider } from "@/components/providers/query-provider"
import { Toaster } from "sonner"
import { roboto } from './fonts/fonts';
import { geistSans } from './fonts/fonts';
import { geistMono } from './fonts/fonts';
import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "CRYPT AI",
    template: "%s | CRYPT AI",
  },
  description: "Time series prediction system",
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={`${roboto.variable} ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>

      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider messages={messages}>
            <QueryProvider>{children}</QueryProvider>
            <Toaster richColors closeButton theme="dark" />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
