"use client"

import { useState, useMemo, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown,
  ChevronDown, ChevronUp, Loader2,
} from "lucide-react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { orchestrationsApi } from "@/lib/api"
import { OrchestrationDetailPane } from "@/components/orchestration/detail-pane"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "description" | "metric" | "grain" | "lastCalibrated" | "starred"

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

const STATUS_KEY: Record<string, string> = {
  draft: "statusDraft",
  selecting: "statusSelecting",
  reweighting: "statusReweighting",
  ready: "statusReady",
  failed: "statusFailed",
}

const IN_PROGRESS = ["selecting", "reweighting"]

function StatusBadge({ status, label }: { status: string; label: string }) {
  const cls =
    status === "draft"
      ? "bg-gray-100 text-gray-700 border-gray-200"
      : status === "ready"
      ? "bg-green-100 text-green-800 border-green-200"
      : status === "failed"
        ? "bg-red-100 text-red-800 border-red-200"
        : "bg-blue-100 text-blue-800 border-blue-200"
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", cls)}>
      {IN_PROGRESS.includes(status) && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </span>
  )
}

function formatGrain(target: string | null): string {
  return (target ?? "pooled")
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ")
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORAGE_PREFIX = "crypt:orchestration:"

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

export default function OrchestrationPage() {
  const t = useTranslations("orchestrationsPage")
  const to = useTranslations("orchestrations")
  const queryClient = useQueryClient()

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(() => loadJson<boolean>("showOnlySelected", false))
  const [search, setSearch] = useState(() => loadJson<string>("search", ""))
  const [sortField, setSortField] = useState<SortField>(() => loadJson<SortField>("sortField", "name"))
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => loadJson<"asc" | "desc">("sortDir", "asc"))
  const [currentPage, setCurrentPage] = useState(() => loadJson<number>("page", 1))
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => loadJson<string | null>("selectedGroup", null))

  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["orchestration-groups"],
    queryFn: () => orchestrationsApi.list(),
    // Poll while any group is selecting/reweighting so the badge updates live.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((g) => IN_PROGRESS.includes(g.status)) ? 4000 : false,
  })

  // ── Persist state to localStorage ──────────────────────────────────────────

  useEffect(() => { saveJson("checked", [...selectedIds]) }, [selectedIds])
  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson("showOnlySelected", showOnlySelected) }, [showOnlySelected])
  useEffect(() => { saveJson("search", search) }, [search])
  useEffect(() => { saveJson("sortField", sortField) }, [sortField])
  useEffect(() => { saveJson("sortDir", sortDir) }, [sortDir])
  useEffect(() => { saveJson("page", currentPage) }, [currentPage])
  useEffect(() => { saveJson("selectedGroup", selectedGroupId) }, [selectedGroupId])

  // ── Mutations ─────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (id: string) => orchestrationsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["orchestration-groups"] })
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
    },
  })

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? groups.filter((g) => selectedIds.has(g.id))
      : groups

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (g) => g.name.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q)
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name": va = a.name; vb = b.name; break
        case "description": va = a.description ?? ""; vb = b.description ?? ""; break
        case "metric": va = a.calibration_metric ?? ""; vb = b.calibration_metric ?? ""; break
        case "grain": va = formatGrain(a.prediction_target); vb = formatGrain(b.prediction_target); break
        case "lastCalibrated": va = a.last_calibrated_at ?? ""; vb = b.last_calibrated_at ?? ""; break
        case "starred": va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [groups, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((g) => selectedIds.has(g.id))
  const somePageSelected = pageItems.some((g) => selectedIds.has(g.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((g) => n.delete(g.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((g) => n.add(g.id)); return n })
    }
  }

  function handleRowCheckbox(id: string, checked: boolean) {
    setSelectedIds((prev) => { const n = new Set(prev); checked ? n.add(id) : n.delete(id); return n })
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRowRightClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    handleStar(id)
  }

  function openBulkDeleteDialog() {
    setBulkDeleteUnderstood(false)
    setBulkDeleteConfirmText("")
    setBulkDeleteDialogOpen(true)
  }

  async function handleBulkDelete() {
    let ok = 0
    let failed = 0
    for (const id of selectedIds) {
      try {
        await deleteMutation.mutateAsync(id)
        ok++
      } catch {
        failed++
      }
    }
    setSelectedIds(new Set())
    setBulkDeleteDialogOpen(false)
    if (failed > 0) toast.error(t("toastDeleteError"))
    else if (ok > 0) toast.success(t("toastDeleted"))
  }

  // ── Sort header ────────────────────────────────────────────────────────────

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 font-medium hover:text-foreground transition-colors text-left"
      >
        {label}
        {active ? (
          sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className="flex flex-col shrink-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-background">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }}
              className="h-7 pl-8 w-52 text-s"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-y-auto max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              {t("loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <p className="text-sm">{t("noGroups")}</p>
              <p className="text-xs opacity-60">{t("noGroupsHint")}</p>
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
                          <button className="h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem
                            onClick={() => setSelectedIds(new Set(groups.map((g) => g.id)))}
                          >
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setSelectedIds(
                                new Set(groups.filter((g) => starredIds.has(g.id)).map((g) => g.id))
                              )
                            }
                          >
                            {t("selectStarred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead>{to("statusLabel")}</TableHead>
                  <TableHead><SortHeader field="description" label={t("colDescription")} /></TableHead>
                  <TableHead><SortHeader field="metric" label={t("colMetric")} /></TableHead>
                  <TableHead><SortHeader field="grain" label={to("calibrationGrain")} /></TableHead>
                  <TableHead><SortHeader field="lastCalibrated" label={t("colLastCalibrated")} /></TableHead>
                  <TableHead className="w-10 text-center">
                    <button
                      onClick={() => handleSort("starred")}
                      className="flex items-center gap-1 font-medium hover:text-foreground transition-colors"
                    >
                      <Star className={cn("h-4 w-4", sortField === "starred" ? "" : "opacity-40")} />
                      {sortField === "starred" && (
                        sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((group) => (
                  <TableRow
                    key={group.id}
                    onContextMenu={(e) => handleRowRightClick(e, group.id)}
                    data-state={selectedGroupId === group.id ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(group.id)}
                        onCheckedChange={(c) => handleRowCheckbox(group.id, !!c)}
                      />
                    </TableCell>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {group.name}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={group.status} label={to(STATUS_KEY[group.status] ?? "statusReady")} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-[240px] truncate">
                      {group.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs uppercase">
                      {group.calibration_metric}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatGrain(group.prediction_target)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {group.last_calibrated_at
                        ? format(new Date(group.last_calibrated_at), "MMM dd, yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStar(group.id)}
                        className="hover:text-amber-400 transition-colors"
                        aria-label="Toggle star"
                      >
                        <Star
                          className={cn(
                            "h-4 w-4",
                            starredIds.has(group.id)
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground"
                          )}
                        />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Bottom: pagination + selection bar */}
        <div className="shrink-0 border-t bg-background mt-4">
          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-1.5">
              <span className="text-s text-muted-foreground">
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
                      <PaginationPrevious
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={safePage === 1}
                      />
                    </PaginationItem>
                    {buildPaginationPages(safePage, totalPages).map((p, i) =>
                      p === "ellipsis" ? (
                        <PaginationItem key={`e${i}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            isActive={safePage === p}
                            onClick={() => setCurrentPage(p)}
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    )}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={safePage === totalPages}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
              <span className="text-xs text-muted-foreground">
                {t("selectedCount", { selected: selectedIds.size, total: filtered.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 cursor-pointer"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  title={showOnlySelected ? t("showAll") : t("showOnlySelected")}
                >
                  <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                  onClick={openBulkDeleteDialog}
                  title={t("deleteSelected")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Inline detail pane ── */}
      {selectedGroupId && filtered.some((g) => g.id === selectedGroupId) && (
        <OrchestrationDetailPane
          key={selectedGroupId}
          groupId={selectedGroupId}
          onDeleted={() => setSelectedGroupId(null)}
        />
      )}

      {/* ── Bulk Delete Confirmation Dialog ── */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {t("bulkDeleteTitle", { count: selectedIds.size })}
            </DialogTitle>
            <DialogDescription>
              {t("bulkDeleteDescription", { count: selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox
                checked={bulkDeleteUnderstood}
                onCheckedChange={(v) => setBulkDeleteUnderstood(!!v)}
                className="mt-0.5 shrink-0"
              />
              <span className="text-sm">{t("bulkDeleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("deleteTypeToConfirm")}</label>
              <Input
                value={bulkDeleteConfirmText}
                onChange={(e) => setBulkDeleteConfirmText(e.target.value)}
                placeholder={t("deleteTypePlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
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
