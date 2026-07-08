"use client"

import { useState, useMemo, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { workersApi, liveIngestApi, type WorkerStatus, type ManagedWorker } from "@/lib/api"
import { WorkerDetailPane } from "@/components/workers/detail-pane"
import { WorkerStatusBadge, HealthDot, formatUptime } from "@/components/workers/worker-ui"
import { LiveIngestDetailPane, LIVE_INGEST_WORKER_NAME } from "@/components/workers/live-ingest-detail-pane"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "status" | "health" | "uptime" | "starred"

const STATUS_ORDER: Record<WorkerStatus, number> = { running: 0, stopped: 1, potential: 2 }

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

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORAGE_PREFIX = "crypto:workers:"

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value))
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SystemWorkersPage() {
  const t = useTranslations("workersPage")
  const queryClient = useQueryClient()

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(() => loadJson<boolean>("showOnlySelected", false))
  const [search, setSearch] = useState(() => loadJson<string>("search", ""))
  const [sortField, setSortField] = useState<SortField>(() => loadJson<SortField>("sortField", "status"))
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => loadJson<"asc" | "desc">("sortDir", "asc"))
  const [currentPage, setCurrentPage] = useState(() => loadJson<number>("page", 1))
  const [selectedName, setSelectedName] = useState<string | null>(() => loadJson<string | null>("selectedWorker", null))

  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: rawWorkers = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["workers"],
    queryFn: () => workersApi.list(),
    refetchInterval: 5000,
  })

  // The Live Data Ingester is controlled like a worker (docker start/stop), so it
  // appears as a row in this same table with its own detail pane.
  const { data: ingest } = useQuery({
    queryKey: ["liveIngestStatus"],
    queryFn: () => liveIngestApi.status(),
    refetchInterval: 5000,
  })

  const workers = useMemo<ManagedWorker[]>(() => {
    if (!ingest) return rawWorkers
    const ingestRow: ManagedWorker = {
      name: LIVE_INGEST_WORKER_NAME,
      status: ingest.container_status === "running" ? "running" : "stopped",
      health: null,
      models: [],
      gpu_name: null,
      gpu_vram_total_mb: null,
      gpu_count: null,
      gpu_index: null,
      uptime_s: ingest.uptime_s,
      container_name: ingest.container_name,
      service: "live-ingest",
      profile: null,
      is_remote: false,
      controllable: true,
      stats: {
        jobs_total: 0, jobs_instance: 0, jobs_running: 0, jobs_success: 0,
        jobs_failure: 0, last_job_at: null, avg_cpu_time_s: null, avg_peak_memory_mb: null,
      },
    }
    return [...rawWorkers, ingestRow]
  }, [rawWorkers, ingest])

  // ── Persist ──────────────────────────────────────────────────────────────

  useEffect(() => { saveJson("checked", [...selectedIds]) }, [selectedIds])
  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson("showOnlySelected", showOnlySelected) }, [showOnlySelected])
  useEffect(() => { saveJson("search", search) }, [search])
  useEffect(() => { saveJson("sortField", sortField) }, [sortField])
  useEffect(() => { saveJson("sortDir", sortDir) }, [sortDir])
  useEffect(() => { saveJson("page", currentPage) }, [currentPage])
  useEffect(() => { saveJson("selectedWorker", selectedName) }, [selectedName])

  // ── Mutations ─────────────────────────────────────────────────────────────

  const removeMutation = useMutation({
    mutationFn: (name: string) => workersApi.remove(name),
    onSuccess: (_res, name) => {
      queryClient.invalidateQueries({ queryKey: ["workers"] })
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(name); return n })
    },
  })

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected ? workers.filter((w) => selectedIds.has(w.name)) : workers

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((w) =>
        w.name.toLowerCase().includes(q) ||
        w.status.toLowerCase().includes(q) ||
        w.models.some((m) => m.toLowerCase().includes(q))
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name": va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break
        case "status": va = STATUS_ORDER[a.status]; vb = STATUS_ORDER[b.status]; break
        case "health": va = a.health ?? ""; vb = b.health ?? ""; break
        case "uptime": va = a.uptime_s ?? -1; vb = b.uptime_s ?? -1; break
        case "starred": va = starredIds.has(a.name) ? 1 : 0; vb = starredIds.has(b.name) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [workers, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((w) => selectedIds.has(w.name))
  const somePageSelected = pageItems.some((w) => selectedIds.has(w.name))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((w) => n.delete(w.name)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((w) => n.add(w.name)); return n })
    }
  }

  function handleStar(name: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })
  }

  function openBulkDeleteDialog() {
    setBulkDeleteUnderstood(false)
    setBulkDeleteConfirmText("")
    setBulkDeleteDialogOpen(true)
  }

  async function handleBulkDelete() {
    let ok = 0, failed = 0
    for (const name of selectedIds) {
      try {
        const res = await removeMutation.mutateAsync(name)
        res.status === "error" ? failed++ : ok++
      } catch { failed++ }
    }
    setSelectedIds(new Set())
    setBulkDeleteDialogOpen(false)
    if (selectedName && !workers.some((w) => w.name === selectedName)) setSelectedName(null)
    if (failed > 0) toast.error(t("toastRemoveError"))
    else if (ok > 0) toast.success(t("toastRemoved"))
  }

  // ── Sort header ────────────────────────────────────────────────────────────

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 font-medium hover:text-foreground transition-colors text-left cursor-pointer"
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
    <div className="relative flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className="flex flex-col shrink-0">
        {/* Toolbar */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 shrink-0 bg-background">
          <Button
            variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
            onClick={() => refetch()} title={t("refresh")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
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
        <div className="overflow-y-auto max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">
              {t("loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--muted-foreground)]">
              <p className="text-sm">{t("noWorkers")}</p>
              <p className="text-xs opacity-60">{t("noWorkersHint")}</p>
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
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(workers.map((w) => w.name)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(workers.filter((w) => starredIds.has(w.name)).map((w) => w.name)))}>
                            {t("selectStarred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="status" label={t("colStatus")} /></TableHead>
                  <TableHead><SortHeader field="health" label={t("colHealth")} /></TableHead>
                  <TableHead>{t("colModels")}</TableHead>
                  <TableHead><SortHeader field="uptime" label={t("colUptime")} /></TableHead>
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
                {pageItems.map((worker) => (
                  <TableRow
                    key={worker.name}
                    data-state={selectedName === worker.name ? "selected" : undefined}
                    onClick={() => setSelectedName(worker.name)}
                    onContextMenu={(e) => { e.preventDefault(); handleStar(worker.name) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(worker.name)}
                        onCheckedChange={(c) => setSelectedIds((prev) => {
                          const n = new Set(prev); c ? n.add(worker.name) : n.delete(worker.name); return n
                        })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {worker.name}
                      {worker.is_remote && <Badge variant="outline" className="ml-2 text-[10px]">{t("typeRemote")}</Badge>}
                    </TableCell>
                    <TableCell>
                      <WorkerStatusBadge
                        status={worker.status}
                        label={t(`status_${worker.status}`)}
                        spin={worker.status === "running" && worker.stats.jobs_running > 0}
                      />
                    </TableCell>
                    <TableCell>
                      <HealthDot health={worker.health} label={worker.health ? t(`health_${worker.health}`) : ""} />
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="flex flex-wrap gap-1">
                        {worker.models.length === 0
                          ? <span className="text-xs text-[var(--muted-foreground)]">—</span>
                          : worker.models.slice(0, 3).map((m) => (
                            <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                          ))}
                        {worker.models.length > 3 && (
                          <span className="text-[10px] text-[var(--muted-foreground)]">+{worker.models.length - 3}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-[var(--muted-foreground)]">{formatUptime(worker.uptime_s)}</TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleStar(worker.name)} className="hover:text-amber-400 transition-colors cursor-pointer" aria-label="Toggle star">
                        <Star className={cn("h-4 w-4", starredIds.has(worker.name) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
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
                  variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  title={showOnlySelected ? t("showAll") : t("showOnlySelected")}
                >
                  <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                  onClick={openBulkDeleteDialog}
                  title={t("removeSelected")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail pane ── */}
      {selectedName && filtered.some((w) => w.name === selectedName) && (
        selectedName === LIVE_INGEST_WORKER_NAME ? (
          <LiveIngestDetailPane key={selectedName} />
        ) : (
          <WorkerDetailPane
            key={selectedName}
            name={selectedName}
            onDeleted={() => setSelectedName(null)}
          />
        )
      )}

      {/* ── Bulk remove dialog ── */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("bulkRemoveTitle", { count: selectedIds.size })}</DialogTitle>
            <DialogDescription>{t("bulkRemoveDescription", { count: selectedIds.size })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={bulkDeleteUnderstood} onCheckedChange={(v) => setBulkDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("bulkRemoveUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm")}</label>
              <Input value={bulkDeleteConfirmText} onChange={(e) => setBulkDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)}>{t("cancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={handleBulkDelete}
              disabled={!bulkDeleteUnderstood || bulkDeleteConfirmText !== t("deleteTypePlaceholder") || removeMutation.isPending}
            >
              {t("bulkRemoveConfirm", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
