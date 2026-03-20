"use client"

import { useState, useMemo, useRef, useEffect, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp,
} from "lucide-react"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  predictionsApi,
  type CompletedPredictionResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "strategy_name" | "date" | "created_at" | "status" | "starred"

type PredictionStatus = "success" | "failure" | "revoked"

function isDowngrade(p: { status: string; engine: string | null; requested_engine: string | null }) {
  return p.status === "success" && p.requested_engine != null && p.engine !== p.requested_engine
}

const STATUS_BADGE: Record<PredictionStatus, { variant: "success" | "destructive" | "warning"; label: string }> = {
  success: { variant: "success", label: "statusSuccess" },
  failure: { variant: "destructive", label: "statusFailure" },
  revoked: { variant: "warning", label: "statusRevoked" },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`
}

function formatExecutionPeriod(startedAt: string | null, completedAt: string | null) {
  if (!startedAt && !completedAt) return "—"
  const start = startedAt ? formatTime(startedAt) : "?"
  const end = completedAt ? formatTime(completedAt) : "?"
  const period = startedAt && completedAt
    ? ` (${formatDuration(new Date(completedAt).getTime() - new Date(startedAt).getTime())})`
    : ""
  return `${start} – ${end}${period}`
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—"
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
      <span className="text-sm font-medium">{value ?? "—"}</span>
    </div>
  )
}

// ─── localStorage helpers (scoped per customer) ─────────────────────────────

const PREDC_STORAGE_PREFIX = "gorm:predCompleted:"

function loadPredCJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${PREDC_STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function savePredCJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${PREDC_STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PredictionsCompletedPage() {
  const t = useTranslations("predictions.completed")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const deepLinkTaskId = searchParams.get("task_id")
  const cid = activeCustomer?.id ?? ""

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadPredCJson<string[]>(cid, "checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadPredCJson<string[]>(cid, "starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state (persisted)
  const [detailMaximized, setDetailMaximized] = useState(() => loadPredCJson<boolean>(cid, "detailMaximized", false))
  const [selectedPredId, setSelectedPredId] = useState<string | null>(() => loadPredCJson<string | null>(cid, "selectedPred", null))
  const [selected, setSelected] = useState<CompletedPredictionResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadPredCJson<string>(cid, "activeTab", "tab1"))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Delete dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: listData, isLoading } = useQuery({
    queryKey: ["predictions-completed", activeCustomer?.id],
    queryFn: () => predictionsApi.list(activeCustomer!.id, { limit: 500 }),
    enabled: !!activeCustomer,
    retry: false,
  })

  const predictions = listData?.items ?? []

  // ── Persist state to localStorage ──────────────────────────────────────────

  useEffect(() => { if (cid) savePredCJson(cid, "checked", [...selectedIds]) }, [cid, selectedIds])
  useEffect(() => { if (cid) savePredCJson(cid, "starred", [...starredIds]) }, [cid, starredIds])
  useEffect(() => { if (cid) savePredCJson(cid, "activeTab", activeTab) }, [cid, activeTab])
  useEffect(() => { if (cid) savePredCJson(cid, "detailMaximized", detailMaximized) }, [cid, detailMaximized])
  useEffect(() => { if (cid) savePredCJson(cid, "selectedPred", selected?.id ?? null) }, [cid, selected?.id])

  // ── Restore selected prediction from persisted ID when list loads ──────────

  useEffect(() => {
    if (!predictions.length || selected || deepLinkTaskId) return
    if (selectedPredId) {
      const found = predictions.find((p) => p.id === selectedPredId)
      if (found) setSelected(found)
    }
  }, [predictions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset persisted state when customer changes ───────────────────────────

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setSelectedIds(new Set(loadPredCJson<string[]>(cid, "checked", [])))
      setStarredIds(new Set(loadPredCJson<string[]>(cid, "starred", [])))
      setSelectedPredId(loadPredCJson<string | null>(cid, "selectedPred", null))
      setSelected(null)
      setActiveTab(loadPredCJson<string>(cid, "activeTab", "tab1"))
    }
    prevCidRef.current = cid
  }, [cid])

  // ── Deep-link: select and focus prediction from task_id query param ─────────
  const handledTaskIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!deepLinkTaskId || predictions.length === 0) return
    if (handledTaskIdRef.current === deepLinkTaskId) return
    const match = predictions.find((p) => p.task_id === deepLinkTaskId)
    if (!match) return
    setSelected(match)
    setSelectedIds(new Set([match.id]))
    setShowOnlySelected(true)
    setActiveTab(match.status === "failure" ? "tab0" : "tab1")
    handledTaskIdRef.current = deepLinkTaskId
  }, [deepLinkTaskId, predictions])

  const { data: analytics } = useQuery({
    queryKey: ["prediction-analytics", selected?.id],
    queryFn: () => predictionsApi.getAnalytics(selected!.id),
    enabled: !!selected && selected.status === "success",
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (id: string) => predictionsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["predictions-completed"] })
      if (selected?.id === id) setSelected(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => {
      toast.error(t("toastDeleteError"))
    },
  })

  // ── Tab indicator ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selected])

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? predictions.filter((p) => selectedIds.has(p.id))
      : predictions

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (p) => p.strategy_name?.toLowerCase().includes(q) ||
               p.engine?.toLowerCase().includes(q) ||
               (p.date ?? "").includes(q)
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "strategy_name": va = a.strategy_name ?? ""; vb = b.strategy_name ?? ""; break
        case "date":          va = a.date ?? "";          vb = b.date ?? "";          break
        case "created_at":    va = a.created_at;          vb = b.created_at;          break
        case "status":        va = a.status;              vb = b.status;              break
        case "starred":       va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [predictions, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((p) => selectedIds.has(p.id))
  const somePageSelected = pageItems.some((p) => selectedIds.has(p.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((p) => n.delete(p.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((p) => n.add(p.id)); return n })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function openDeleteDialog() {
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!selected) return
    await deleteMutation.mutateAsync(selected.id)
    setDeleteDialogOpen(false)
    setSelected(null)
  }

  function openBulkDeleteDialog() {
    setBulkDeleteUnderstood(false)
    setBulkDeleteConfirmText("")
    setBulkDeleteDialogOpen(true)
  }

  async function handleBulkDelete() {
    const ids = predictions.filter((p) => selectedIds.has(p.id)).map((p) => p.id)
    for (const id of ids) await deleteMutation.mutateAsync(id)
    setSelectedIds(new Set())
    setBulkDeleteDialogOpen(false)
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 font-medium hover:text-foreground transition-colors text-left"
      >
        {label}
        {active
          ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className={cn("flex flex-col shrink-0", detailMaximized && "hidden")}>
        {/* Toolbar */}
        <div className="flex items-center justify-end px-4 py-2 shrink-0 bg-background">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }}
              className="h-7 pl-8 w-52 text-xs"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-y-auto max-h-[45vh]">
          {isLoading || !activeCustomer ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--muted-foreground)]">
              <p className="text-sm">{t("noPredictions")}</p>
              <p className="text-xs opacity-60">{t("noPredictionsHint")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-4">
                    <div className="flex items-center gap-0.5">
                      <Checkbox
                        checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                        onCheckedChange={handleHeaderCheckbox}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors cursor-pointer">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predictions.map((p) => p.id)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predictions.filter((p) => p.status === "success").map((p) => p.id)))}>
                            {t("selectCompleted")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predictions.filter((p) => p.status === "revoked").map((p) => p.id)))}>
                            {t("selectCancelled")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predictions.filter((p) => p.status === "failure").map((p) => p.id)))}>
                            {t("selectFailed")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setSelectedIds(new Set(predictions.filter((p) => starredIds.has(p.id)).map((p) => p.id)))}
                          >
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="strategy_name" label={t("colStrategy")} /></TableHead>
                  <TableHead><SortHeader field="date" label={t("colPredictionDate")} /></TableHead>
                  <TableHead><SortHeader field="created_at" label={t("colRunDate")} /></TableHead>
                  <TableHead><SortHeader field="status" label={t("colStatus")} /></TableHead>
                  <TableHead className="w-10 text-center">
                    <button
                      onClick={() => handleSort("starred")}
                      className="flex items-center gap-1 font-medium hover:text-foreground transition-colors cursor-pointer"
                    >
                      <Star className={cn("h-4 w-4", sortField === "starred" ? "" : "opacity-40")} />
                      {sortField === "starred" && (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((prediction) => (
                  <TableRow
                    key={prediction.id}
                    data-state={selected?.id === prediction.id ? "selected" : undefined}
                    onClick={() => { setSelected(prediction); setActiveTab(prediction.status === "failure" ? "tab0" : "tab1") }}
                    onContextMenu={(e) => { e.preventDefault(); handleStar(prediction.id) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(prediction.id)}
                        onCheckedChange={(c) => setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(prediction.id) : n.delete(prediction.id); return n })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {prediction.strategy_name ?? <span className="text-[var(--muted-foreground)] italic">{t("noStrategy")}</span>}
                    </TableCell>
                    <TableCell className="text-sm">{prediction.date ? formatDate(prediction.date) : "—"}</TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)]">{formatExecutionPeriod(prediction.started_at, prediction.completed_at)}</TableCell>
                    <TableCell>
                      {isDowngrade(prediction)
                        ? <Badge variant="warning" className="text-xs">{t("statusDowngrade")}</Badge>
                        : (() => {
                            const s = STATUS_BADGE[prediction.status as PredictionStatus]
                            return s ? <Badge variant={s.variant} className="text-xs">{t(s.label as Parameters<typeof t>[0])}</Badge> : null
                          })()
                      }
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleStar(prediction.id)} className="hover:text-amber-400 transition-colors cursor-pointer" aria-label="Toggle star">
                        <Star className={cn("h-4 w-4", starredIds.has(prediction.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination + selection bar */}
        <div className="shrink-0 border-t bg-background mt-4">
          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-1.5">
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("showing", {
                  from: (safePage - 1) * ITEMS_PER_PAGE + 1,
                  to: Math.min(safePage * ITEMS_PER_PAGE, filtered.length),
                  total: filtered.length,
                })}
              </span>
              {totalPages > 1 && (
                <Pagination className="w-auto mx-0">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} />
                    </PaginationItem>
                    {buildPaginationPages(safePage, totalPages).map((p, i) =>
                      p === "ellipsis" ? (
                        <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink isActive={safePage === p} onClick={() => setCurrentPage(p)}>{p}</PaginationLink>
                        </PaginationItem>
                      )
                    )}
                    <PaginationItem>
                      <PaginationNext onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-[var(--muted)]/30">
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("selectedCount", { selected: selectedIds.size, total: filtered.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1.5 px-2 cursor-pointer"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  title={showOnlySelected ? "Show all" : "Show only selected"}
                >
                  <Focus className={cn("h-3.5 w-3.5", showOnlySelected && "text-primary")} />
                  {showOnlySelected && <span className="text-xs">Show all</span>}
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                  onClick={openBulkDeleteDialog}
                  title="Delete selected"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail pane ── */}
      {selected && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-t">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
            <div className="relative w-full">
              <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                {selected.status === "failure" && (
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 text-destructive data-[state=active]:text-destructive" value="tab0">{t("tabError")}</TabsTrigger>
                )}
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabAnalytics")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabSpecs")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabActions")}</TabsTrigger>
                <div
                  className="ml-auto flex items-center pr-2 pl-3 mb-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setDetailMaximized((v) => !v)}
                  aria-label={detailMaximized ? "Minimize" : "Maximize"}
                >
                  {detailMaximized ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
                </div>
              </TabsList>
              <div
                className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
              />
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ─ Error ─ */}
              {selected.status === "failure" && (
                <TabsContent value="tab0" className="max-w-2xl mt-6 px-4">
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-xs font-semibold text-destructive mb-2">{t("tabError")}</p>
                    <p className="text-xs text-[var(--muted-foreground)] font-mono whitespace-pre-wrap break-all">
                      {selected.error ?? "No error message available."}
                    </p>
                  </div>
                </TabsContent>
              )}

              {/* ─ Details ─ */}
              <TabsContent value="tab1" className="space-y-3 max-w-2xl mt-6 px-4">
                <StatRow label="ID" value={<span className="font-mono text-xs opacity-70">{selected.id}</span>} />
                <StatRow label={t("fieldOutletGroup")} value={selected.outlet_group_name ?? "—"} />
                <StatRow label={t("fieldStrategyName")} value={selected.strategy_name ?? <span className="italic text-[var(--muted-foreground)]">{t("noStrategy")}</span>} />
                <StatRow label={t("fieldPredictionDate")} value={selected.date ? formatDate(selected.date) : "—"} />
                <StatRow label={t("fieldRunDate")} value={formatExecutionPeriod(selected.started_at, selected.completed_at)} />
              </TabsContent>

              {/* ─ Analytics ─ */}
              <TabsContent value="tab2" className="space-y-3 max-w-2xl mt-6 px-4">
                {selected.status !== "success" ? (
                  <div className="text-sm text-[var(--muted-foreground)] italic">
                    Analytics are only available for completed predictions.
                  </div>
                ) : !analytics ? (
                  <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
                ) : (
                  <>
                    <StatRow label={t("fieldTotalOutlets")} value={formatNumber(analytics.outlet_count)} />
                    <StatRow label={t("fieldTotalDelivered")} value={formatNumber(analytics.total_delivered)} />
                    <StatRow label={t("fieldTotalEO")} value={formatNumber(analytics.total_eo)} />
                    <StatRow label={t("fieldTotalPredicted")} value={formatNumber(analytics.total_predicted)} />
                    <StatRow label={t("fieldTotalLowerBound")} value={formatNumber(analytics.total_lower_bound)} />
                    <StatRow label={t("fieldTotalUpperBound")} value={formatNumber(analytics.total_upper_bound)} />
                  </>
                )}
              </TabsContent>

              {/* ─ Specs ─ */}
              <TabsContent value="tab3" className="space-y-3 max-w-2xl mt-6 px-4">
                <StatRow label={t("fieldEngine")} value={selected.engine ?? "—"} />
                {selected.requested_engine != null && (
                  <StatRow
                    label={t("fieldRequestedEngine")}
                    value={
                      isDowngrade(selected)
                        ? <span className="text-amber-400">{selected.requested_engine}</span>
                        : selected.requested_engine
                    }
                  />
                )}
                <StatRow
                  label={t("fieldEngineParams")}
                  value={
                    selected.engine_params
                      ? <span className="font-mono text-xs opacity-70">{JSON.stringify(selected.engine_params)}</span>
                      : "—"
                  }
                />
                <StatRow label={t("fieldBatchSize")} value={selected.batch_size} />
                <StatRow label={t("fieldDelay")} value={selected.delay ?? "—"} />
                <StatRow label={t("fieldUseFinancials")} value={selected.use_financials == null ? "—" : selected.use_financials ? "Yes" : "No"} />
                <StatRow label={t("fieldUsePad")} value={selected.use_pad == null ? "—" : selected.use_pad ? "Yes" : "No"} />
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="tab4" className="max-w-2xl mt-6 px-4">
                <div className="rounded-md border border-destructive/30 p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-destructive">{t("deleteButton")}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{t("deleteZoneDescription")}</p>
                  </div>
                  <Button variant="destructive" size="sm" className="shrink-0 cursor-pointer" onClick={openDeleteDialog}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    {t("deleteButton")}
                  </Button>
                </div>
              </TabsContent>

            </div>
          </Tabs>
        </div>
      )}

      {/* ── Single delete dialog ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteAbsoluteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteAbsoluteDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("deleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm")}</label>
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteDialogOpen(false)}>{t("deleteCancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={handleDelete}
              disabled={!deleteUnderstood || deleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
            >
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete dialog ── */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("bulkDeleteTitle", { count: selectedIds.size })}</DialogTitle>
            <DialogDescription>{t("bulkDeleteDescription", { count: selectedIds.size })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={bulkDeleteUnderstood} onCheckedChange={(v) => setBulkDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("bulkDeleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm")}</label>
              <Input value={bulkDeleteConfirmText} onChange={(e) => setBulkDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)}>{t("deleteCancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={handleBulkDelete}
              disabled={!bulkDeleteUnderstood || bulkDeleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
            >
              {t("bulkDeleteConfirm", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
