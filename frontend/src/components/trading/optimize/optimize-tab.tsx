"use client"

// The Optimize tab: every grid search run for this strategy, and what each one
// found. Same table shell as the rest of the app — search, sortable headers,
// checkbox column with a select menu, star column, pagination — plus a progress
// column with a live ETA while a search is running.
//
// Selecting one opens its variations underneath, ranked by TRAIN edge with the
// VALIDATION columns beside them. That layout is the whole point: a grid search
// ranked on the full range finds the best-fitting noise, so the half the search
// was allowed to see and the half it wasn't are always shown together.

import { Fragment, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  ArrowUpDown, ChevronDown, ChevronUp, Focus, Plus, Search, Star, Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"
import { CreateOptimizationDialog } from "@/components/trading/optimize/create-optimization-dialog"
import { OptimizationResults } from "@/components/trading/optimize/optimization-results"
import {
  strategyOptimizationsApi, type StrategyOptimization, type SwingScope,
} from "@/lib/api"

const PER_PAGE = 10
const STORAGE_PREFIX = "crypt:optimize:"

type SortField = "name" | "status" | "created" | "combos" | "range"

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value)) } catch { /* ignore */ }
}

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

/** "2m 14s" — ETAs are wrong often enough that a false precision of seconds
 *  would be its own kind of lie. */
function duration(seconds: number | null | undefined): string {
  if (seconds == null) return "—"
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function OptimizeTab({
  strategy,
  scope,
  params,
  onImplement,
}: {
  strategy: string
  // The page's current setup — seeds the create dialog and supplies the baseline.
  scope: SwingScope | null
  params: Record<string, unknown> | null
  // Apply a variation's market + knobs back onto the explorer.
  onImplement: (scopeOverride: { coin_id: string; quote_asset: string; interval: string }, params: Record<string, unknown>) => void
}) {
  const t = useTranslations("optimize")
  const queryClient = useQueryClient()

  const { data: optimizations = [] } = useQuery({
    queryKey: ["strategyOptimizations", strategy],
    queryFn: () => strategyOptimizationsApi.list(strategy),
    // Poll only while something is in flight — a finished list is static.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((o) => o.status === "running" || o.status === "pending") ? 3000 : false,
  })

  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>(() => loadJson<SortField>("sortField", "created"))
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => loadJson<"asc" | "desc">("sortDir", "desc"))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(() => loadJson<string | null>("selected", null))
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<StrategyOptimization | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson("sortField", sortField) }, [sortField])
  useEffect(() => { saveJson("sortDir", sortDir) }, [sortDir])
  useEffect(() => { saveJson("selected", selectedId) }, [selectedId])
  useEffect(() => { setPage(1) }, [search, showOnlySelected, sortField, sortDir])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => strategyOptimizationsApi.delete(id),
    onSuccess: (_r, id) => {
      queryClient.invalidateQueries({ queryKey: ["strategyOptimizations"] })
      if (selectedId === id) setSelectedId(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("deleted"))
    },
    onError: () => toast.error(t("deleteError")),
  })

  const filtered = useMemo(() => {
    let items = showOnlySelected ? optimizations.filter((o) => selectedIds.has(o.id)) : optimizations
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((o) =>
        [o.name, o.description ?? "", o.status, o.start_date, o.end_date].join(" ").toLowerCase().includes(q),
      )
    }
    return [...items].sort((a, b) => {
      let cmp: number
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break
        case "status": cmp = a.status.localeCompare(b.status); break
        case "combos": cmp = a.n_total - b.n_total; break
        case "range": cmp = a.start_date.localeCompare(b.start_date); break
        case "created": cmp = Date.parse(a.created_at) - Date.parse(b.created_at); break
      }
      if (cmp === 0) cmp = a.name.localeCompare(b.name)
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [optimizations, showOnlySelected, selectedIds, search, sortField, sortDir])

  const selected = useMemo(
    () => optimizations.find((o) => o.id === selectedId) ?? null,
    [optimizations, selectedId],
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }
  function toggleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelect(id: string) {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button onClick={() => toggleSort(field)} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors cursor-pointer">
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  const statusBadge = (o: StrategyOptimization) => {
    const tone =
      o.status === "success" ? "border-emerald-500/40 text-emerald-500"
      : o.status === "error" ? "border-red-500/40 text-red-500"
      : o.status === "running" ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
      : "text-[var(--muted-foreground)]"
    return <Badge variant="outline" className={cn("text-[10px] font-normal", tone)}>{t(`status_${o.status}`)}</Badge>
  }

  // Progress reads as a bar plus its own numbers while running, and collapses to
  // the elapsed time once done — an ETA on a finished search is noise.
  const progressCell = (o: StrategyOptimization) => {
    if (o.status === "pending") return <span className="text-[var(--muted-foreground)]">{t("queued")}</span>
    const pct = o.n_total > 0 ? Math.min(100, (100 * (o.n_done + o.n_skipped)) / o.n_total) : 0
    if (o.status === "running") {
      return (
        <span className="flex items-center gap-2 min-w-[11rem]">
          <span className="h-1.5 flex-1 rounded-full bg-[var(--muted)] overflow-hidden">
            <span className="block h-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
          </span>
          <span className="tabular-nums text-[10px] text-[var(--muted-foreground)] shrink-0">
            {o.n_done}/{o.n_total} · {t("eta")} {duration(o.eta_seconds)}
          </span>
        </span>
      )
    }
    return (
      <span className="tabular-nums text-[var(--muted-foreground)]">
        {o.n_done}/{o.n_total}
        {o.n_skipped > 0 && <span className="text-amber-500"> · {t("skipped", { n: o.n_skipped })}</span>}
        {o.elapsed_seconds != null && <span> · {duration(o.elapsed_seconds)}</span>}
      </span>
    )
  }

  return (
    <div className="space-y-4 py-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button
          size="sm" className="h-8 cursor-pointer"
          disabled={!scope || !params}
          title={scope && params ? t("newHint") : t("newNeedsScope")}
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />{t("new")}
        </Button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <Input placeholder={t("searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 w-56 text-xs" />
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 pl-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1 cursor-pointer text-[var(--muted-foreground)] hover:text-foreground">
                      <Checkbox checked={filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id))} />
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.map((o) => o.id)))}>{t("selectAll")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.filter((o) => starredIds.has(o.id)).map((o) => o.id)))}>{t("selectStarred")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.filter((o) => o.status === "running").map((o) => o.id)))}>{t("selectRunning")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedIds(new Set())}>{t("clearSelection")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
              <TableHead><SortHeader field="status" label={t("colStatus")} /></TableHead>
              <TableHead><SortHeader field="combos" label={t("colCombos")} /></TableHead>
              <TableHead>{t("colProgress")}</TableHead>
              <TableHead><SortHeader field="range" label={t("colRange")} /></TableHead>
              <TableHead><SortHeader field="created" label={t("colCreated")} /></TableHead>
              <TableHead className="w-10 text-center" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-sm text-[var(--muted-foreground)]">
                  {optimizations.length === 0 ? t("empty") : t("emptyNoMatch")}
                </TableCell>
              </TableRow>
            ) : pageItems.map((o) => (
              <Fragment key={o.id}>
                <TableRow
                  data-state={selectedId === o.id ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(o.id === selectedId ? null : o.id)}
                  onContextMenu={(e) => { e.preventDefault(); toggleStar(o.id) }}
                >
                  <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedIds.has(o.id)} onCheckedChange={() => toggleSelect(o.id)} />
                  </TableCell>
                  <TableCell className="font-medium">
                    {o.name}
                    {o.sampled && (
                      <Badge variant="outline" className="ml-2 text-[10px] font-normal" title={t("sampledHint", { cartesian: o.n_cartesian.toLocaleString("en-US") })}>
                        {t("sampled")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(o)}</TableCell>
                  <TableCell className="tabular-nums">{o.n_total.toLocaleString("en-US")}</TableCell>
                  <TableCell>{progressCell(o)}</TableCell>
                  <TableCell className="tabular-nums text-[var(--muted-foreground)]">{o.start_date} → {o.end_date}</TableCell>
                  <TableCell className="tabular-nums text-[var(--muted-foreground)]">{new Date(o.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-center" onClick={(e) => { e.stopPropagation(); toggleStar(o.id) }}>
                    <button className="cursor-pointer" aria-label={t("star")}>
                      <Star className={cn("h-4 w-4", starredIds.has(o.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                    </button>
                  </TableCell>
                </TableRow>
                {o.status === "error" && o.error && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-1.5 text-[11px] text-red-500 bg-red-500/5">{o.error}</TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t">
            <span className="text-xs text-[var(--muted-foreground)]">
              {t("showing", { from: (safePage - 1) * PER_PAGE + 1, to: Math.min(safePage * PER_PAGE, filtered.length), total: filtered.length })}
            </span>
            {totalPages > 1 && (
              <Pagination className="w-auto mx-0">
                <PaginationContent>
                  <PaginationItem><PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} /></PaginationItem>
                  {buildPaginationPages(safePage, totalPages).map((p, i) =>
                    p === "ellipsis"
                      ? <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                      : <PaginationItem key={p}><PaginationLink isActive={safePage === p} onClick={() => setPage(p)}>{p}</PaginationLink></PaginationItem>
                  )}
                  <PaginationItem><PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} /></PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t bg-[var(--muted)]/30">
            <span className="text-xs text-[var(--muted-foreground)]">{t("selectedCount", { selected: selectedIds.size, total: filtered.length })}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer" onClick={() => setShowOnlySelected((v) => !v)} title={showOnlySelected ? t("showAll") : t("showOnlySelected")}>
                <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                title={t("removeSelected")}
                onClick={() => setBulkDeleting(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── The selected search's variations ── */}
      {selected && (
        <OptimizationResults
          key={selected.id}
          optimization={selected}
          onImplement={onImplement}
          onDelete={() => setDeleting(selected)}
        />
      )}

      <CreateOptimizationDialog
        open={creating}
        strategy={strategy}
        scope={scope}
        params={params}
        onClose={() => setCreating(false)}
        onCreated={(o) => {
          queryClient.invalidateQueries({ queryKey: ["strategyOptimizations"] })
          setSelectedId(o.id)
          setCreating(false)
        }}
      />

      <Dialog open={bulkDeleting} onOpenChange={(o) => !o && setBulkDeleting(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("bulkDeleteTitle", { count: selectedIds.size })}</DialogTitle>
            <DialogDescription>{t("bulkDeleteBody", { count: selectedIds.size })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleting(false)}>{t("cancel")}</Button>
            <Button
              variant="destructive" size="sm"
              onClick={() => {
                ;[...selectedIds].forEach((id) => deleteMutation.mutate(id))
                setSelectedIds(new Set())
                setBulkDeleting(false)
              }}
            >
              {t("bulkDeleteConfirm", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody", { name: deleting?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>{t("cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null) }}>{t("delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
