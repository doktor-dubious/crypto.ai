"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Coins, Sparkles, Brain } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useCustomer } from "@/components/providers/customer-provider"
import { tokenApi } from "@/lib/api"

export default function ProfilePage() {
  const t = useTranslations("profile")
  const { activeCustomer } = useCustomer()
  const customerId = activeCustomer?.id

  const { data: token, isLoading } = useQuery({
    queryKey: ["token-usage", customerId],
    queryFn: () => tokenApi.get(customerId!),
    enabled: !!customerId,
    staleTime: 30 * 1000,
  })

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1000px]">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-xs text-[var(--muted-foreground)]">{t("description")}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">
          {t("loading")}
        </div>
      ) : !token ? (
        <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">
          {t("noTokenData")}
        </div>
      ) : (
        <>
          {/* Summary */}
          <section>
            <h3 className="text-sm font-medium mb-3">{t("summary")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <TokenCard
                icon={<Coins className="h-5 w-5 text-[var(--muted-foreground)]" />}
                label={t("totalUsed")}
                value={token.used.toLocaleString()}
              />
              <TokenCard
                icon={<Coins className="h-5 w-5 text-emerald-500" />}
                label={t("totalAvailable")}
                value={token.available.toLocaleString()}
              />
              <TokenCard
                icon={<Coins className="h-5 w-5 text-amber-500" />}
                label={t("remaining")}
                value={(token.available - token.used).toLocaleString()}
                warn={token.available > 0 && token.used >= token.available}
              />
            </div>
            {token.available > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)] mb-1">
                  <span>{t("usage")}</span>
                  <span className="tabular-nums">
                    {Math.min(100, token.available > 0 ? (token.used / token.available * 100) : 0).toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--accent)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--foreground)] transition-all"
                    style={{ width: `${Math.min(100, token.available > 0 ? (token.used / token.available * 100) : 0)}%` }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* LLM breakdown */}
          {token.llms.length > 0 && (
            <section>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                {t("llmUsage")}
              </h3>
              <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs">{t("provider")}</TableHead>
                      <TableHead className="text-xs text-right">{t("used")}</TableHead>
                      <TableHead className="text-xs text-right">{t("available")}</TableHead>
                      <TableHead className="text-xs text-right">{t("remaining")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {token.llms.map((llm) => (
                      <TableRow key={llm.llm_id}>
                        <TableCell className="text-xs font-medium">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                            {llm.llm_name}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{llm.used.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{llm.available.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {(llm.available - llm.used).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          {/* Model breakdown */}
          {token.models.length > 0 && (
            <section>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Brain className="h-4 w-4" />
                {t("modelUsage")}
              </h3>
              <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs">{t("engine")}</TableHead>
                      <TableHead className="text-xs text-right">{t("used")}</TableHead>
                      <TableHead className="text-xs text-right">{t("available")}</TableHead>
                      <TableHead className="text-xs text-right">{t("remaining")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {token.models.map((m) => (
                      <TableRow key={m.prediction_engine_id}>
                        <TableCell className="text-xs font-medium">
                          <div className="flex items-center gap-2">
                            <Brain className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                            {m.engine_name}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{m.used.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{m.available.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {(m.available - m.used).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          {/* Empty state if no breakdown data */}
          {token.llms.length === 0 && token.models.length === 0 && (
            <div className="text-xs text-[var(--muted-foreground)] text-center py-8">
              {t("noBreakdown")}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TokenCard(
  { icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: boolean },
) {
  return (
    <div className="border border-[var(--border)] rounded-lg p-4 flex items-center gap-3">
      {icon}
      <div>
        <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
        <div className="text-lg font-semibold tabular-nums">
          {value}
          {warn && (
            <Badge variant="destructive" className="ml-2 text-[10px]">Exhausted</Badge>
          )}
        </div>
      </div>
    </div>
  )
}
