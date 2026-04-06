"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Star, Plus, Minus } from "lucide-react"
import { toast } from "sonner"
import { configurationCovariatesApi, type ConfigurationCovariateResponse } from "@/lib/api"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface CovariatesTabProps {
  customerId: string | null
  draft: Record<string, unknown>
  setDraft: (fn: (d: Record<string, unknown>) => Record<string, unknown>) => void
  isGorm: boolean
  t: ReturnType<typeof useTranslations<"configuration">>
}

const STORAGE_PREFIX = "gorm:covariates:"

export function CovariatesTab({ customerId, draft, setDraft, isGorm, t }: CovariatesTabProps) {
  const queryClient = useQueryClient()
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }))

  const resolvedId = isGorm ? null : customerId
  const queryKey = ["configuration-covariates", resolvedId]

  const { data: covariates = [] } = useQuery({
    queryKey,
    queryFn: () => configurationCovariatesApi.list(resolvedId ?? undefined),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      configurationCovariatesApi.update(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
    onError: () => {
      toast.error("Failed to update covariate")
    },
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set()
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}starred`)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  const selected = covariates.find((c) => c.id === selectedId) ?? null

  const toggleStar = (id: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(`${STORAGE_PREFIX}starred`, JSON.stringify([...next]))
      return next
    })
  }

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setCheckedIds(new Set(covariates.map((c) => c.id)))
  const selectStarred = () => setCheckedIds(new Set(covariates.filter((c) => starredIds.has(c.id)).map((c) => c.id)))

  const handleToggleActive = (cov: ConfigurationCovariateResponse) => {
    if (isGorm) {
      toggleMutation.mutate({ id: cov.id, active: !cov.active })
    } else if (resolvedId) {
      // For customer mode, ensure customer-specific rows exist first, then toggle
      configurationCovariatesApi.ensure(resolvedId).then(() => {
        // Re-fetch to get customer-specific IDs, then toggle
        configurationCovariatesApi.list(resolvedId).then((rows) => {
          const row = rows.find((r) => r.type === cov.type)
          if (row) {
            toggleMutation.mutate({ id: row.id, active: !cov.active })
          }
        })
      })
    }
  }

  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const

  const selectClassName = "flex h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer"

  return (
    <div className="space-y-4">
      {/* Covariate Handling dropdown (moved from Core tab) */}
      <div className="flex flex-col gap-1.5 max-w-2xl">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("covariateHandling")}</label>
        </div>
        <select
          value={String(draft.covariate_handling ?? (isGorm ? "external" : ""))}
          onChange={(e) => set("covariate_handling", e.target.value === "" ? null : e.target.value)}
          className={selectClassName}
        >
          {!isGorm && <option value="">{t("covariateExternal")}</option>}
          <option value="none">{t("covariateNone")}</option>
          <option value="native">{t("covariateNative")}</option>
          <option value="external">{t("covariateExternal")}</option>
        </select>
      </div>

      {/* Covariates table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Checkbox
                      checked={checkedIds.size === covariates.length && covariates.length > 0}
                      className="cursor-pointer"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={selectAll}>Select All</DropdownMenuItem>
                    <DropdownMenuItem onClick={selectStarred}>Select Starred</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-24 text-center">Applied</TableHead>
              <TableHead className="w-14 text-center">+/-</TableHead>
              <TableHead className="w-10 text-center">
                <Star className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {covariates.map((cov) => (
              <TableRow
                key={cov.id}
                data-state={selectedId === cov.id ? "selected" : undefined}
                onClick={() => setSelectedId(cov.id)}
                className="cursor-pointer"
                onContextMenu={(e) => {
                  e.preventDefault()
                  toggleStar(cov.id)
                }}
              >
                <TableCell className="pl-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={checkedIds.has(cov.id)}
                    onCheckedChange={() => toggleCheck(cov.id)}
                  />
                </TableCell>
                <TableCell className="font-medium text-sm">{cov.name}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={cov.active ? "default" : "secondary"} className="text-xs">
                    {cov.active ? t("covariateActive") : t("covariateInactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleToggleActive(cov)}
                    className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
                  >
                    {cov.active ? (
                      <Minus className="h-4 w-4 text-red-500" />
                    ) : (
                      <Plus className="h-4 w-4 text-green-500" />
                    )}
                  </button>
                </TableCell>
                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => toggleStar(cov.id)}
                    className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
                  >
                    <Star
                      className={`h-3.5 w-3.5 ${
                        starredIds.has(cov.id)
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground"
                      }`}
                    />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Detail pane */}
      {selected ? (
        <div className="border rounded-lg p-4">
          <Tabs defaultValue="description">
            <TabsList>
              <TabsTrigger value="description">{t("covariateTabDescription")}</TabsTrigger>
              <TabsTrigger value="details">{t("covariateTabDetails")}</TabsTrigger>
              <TabsTrigger value="action">{t("covariateTabAction")}</TabsTrigger>
            </TabsList>

            <TabsContent value="description" className="mt-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {selected.description ?? "No description available."}
              </p>
            </TabsContent>

            <TabsContent value="details" className="mt-4">
              {selected.type === 1 ? (
                <div>
                  <h4 className="text-sm font-semibold mb-1">{t("covariateWeekdayDetailsTitle")}</h4>
                  <p className="text-xs text-muted-foreground mb-3">{t("covariateWeekdayDetailsDesc")}</p>
                  <div className="space-y-1">
                    {DAYS.map((day) => {
                      const key = `weekday_correction_${day}` as string
                      const labelKey = `weekdayCorrection${day.charAt(0).toUpperCase()}${day.slice(1)}` as Parameters<typeof t>[0]
                      return (
                        <div key={key} className="flex items-center justify-between py-1">
                          <span className="text-sm">{t(labelKey)}</span>
                          <Switch
                            checked={draft[key] as boolean ?? false}
                            onCheckedChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                            disabled={!selected.active}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No additional settings for this covariate type.
                </p>
              )}
            </TabsContent>

            <TabsContent value="action" className="mt-4">
              <Button
                variant={selected.active ? "destructive" : "default"}
                size="sm"
                onClick={() => handleToggleActive(selected)}
              >
                {selected.active ? t("covariateDeactivate") : t("covariateActivate")}
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
          {t("covariateNoSelection")}
        </div>
      )}
    </div>
  )
}
