"use client"

import { useState, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, ArrowUpDown, ChevronDown, ChevronUp, Focus,
} from "lucide-react"
import { format, formatDistanceStrict } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { fineTunesApi, type FineTuneResponse } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── localStorage helpers ────────────────────────────────────────────────────

const STARRED_KEY = "gorm:ftCompleted:starred"

function loadStarred(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = localStorage.getItem(STARRED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function saveStarred(s: Set<string>) {
  localStorage.setItem(STARRED_KEY, JSON.stringify([...s]))
}

// ─── Status helpers ──────────────────────────────────────────────────────────

type StatusKey = "statusCompleted" | "statusStopped" | "statusCancelled" | "statusWorkerTerminated" | "statusError" | "statusRunning" | "statusPending"

function getStatusInfo(item: FineTuneResponse): { key: StatusKey; variant: "success" | "warning" | "destructive" | "info" | "muted" } {
  if (!item.end_condition) {
    if (!item.started_at) return { key: "statusPending", variant: "muted" }
    return { key: "statusRunning", variant: "info" }
  }
  switch (item.end_condition) {
    case "completed": return { key: "statusCompleted", variant: "success" }
    case "stopped": return { key: "statusStopped", variant: "warning" }
    case "cancelled": return { key: "statusCancelled", variant: "muted" }
    case "worker_terminated": return { key: "statusWorkerTerminated", variant: "destructive" }
    case "error": return { key: "statusError", variant: "destructive" }
    default: return { key: "statusCompleted", variant: "success" }
  }
}

function getDuration(item: FineTuneResponse): string {
  if (!item.started_at) return "—"
  const start = new Date(item.started_at)
  const end = item.ended_at ? new Date(item.ended_at) : new Date()
  return formatDistanceStrict(start, end)
}

// ─── Pagination helper ──────────────────────────────────────────────────────

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  if (current > 3) pages.push("ellipsis")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("ellipsis")
  pages.push(total)
  return pages
}

// ─── Sort types ──────────────────────────────────────────────────────────────

type SortField = "name" | "engine_name" | "end_condition" | "outlet_group_name" | "finetuned_outlets" | "pathological_outlets" | "worker_name" | "duration" | "created_at" | "starred"
type SortDir = "asc" | "desc"

const PAGE_SIZE = 10

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FineTuneCompletedPage() {
  const t = useTranslations("fineTuneCompleted")
  const queryClient = useQueryClient()

  // ── Data
  const { data, isLoading } = useQuery({
    queryKey: ["fine-tunes"],
    queryFn: () => fineTunesApi.list({ limit: 500 }),
    refetchInterval: 30_000,
  })

  const items = data?.items ?? []

  // ── Search
  const [search, setSearch] = useState("")

  // ── Sorting
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
  }

  // ── Stars
  const [starred, setStarred] = useState<Set<string>>(() => loadStarred())

  function toggleStar(id: string) {
    setStarred((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveStarred(next)
      return next
    })
  }

  // ── Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Pagination (1-based)
  const [currentPage, setCurrentPage] = useState(1)

  // ── Filtered & sorted items
  const filtered = useMemo(() => {
    let result = items
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.engine_name ?? "").toLowerCase().includes(q) ||
          (i.worker_name ?? "").toLowerCase().includes(q) ||
          (i.outlet_group_name ?? "").toLowerCase().includes(q),
      )
    }
    if (showOnlySelected) {
      result = result.filter((i) => selectedIds.has(i.id))
    }
    // sort
    result = [...result].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break
        case "engine_name": cmp = (a.engine_name ?? "").localeCompare(b.engine_name ?? ""); break
        case "end_condition": cmp = (a.end_condition ?? "").localeCompare(b.end_condition ?? ""); break
        case "outlet_group_name": cmp = (a.outlet_group_name ?? "").localeCompare(b.outlet_group_name ?? ""); break
        case "finetuned_outlets": cmp = a.finetuned_outlets - b.finetuned_outlets; break
        case "pathological_outlets": cmp = a.pathological_outlets - b.pathological_outlets; break
        case "worker_name": cmp = (a.worker_name ?? "").localeCompare(b.worker_name ?? ""); break
        case "duration": {
          const durA = a.started_at ? (a.ended_at ? new Date(a.ended_at).getTime() - new Date(a.started_at).getTime() : Date.now() - new Date(a.started_at).getTime()) : 0
          const durB = b.started_at ? (b.ended_at ? new Date(b.ended_at).getTime() - new Date(b.started_at).getTime() : Date.now() - new Date(b.started_at).getTime()) : 0
          cmp = durA - durB
          break
        }
        case "created_at": cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break
        case "starred": cmp = (starred.has(a.id) ? 1 : 0) - (starred.has(b.id) ? 1 : 0); break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return result
  }, [items, search, sortField, sortDir, showOnlySelected, selectedIds, starred])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Reset page when search changes
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val)
    setCurrentPage(1)
  }, [])

  // ── Check all on current page
  const allPageSelected = paged.length > 0 && paged.every((i) => selectedIds.has(i.id))
  const somePageSelected = paged.some((i) => selectedIds.has(i.id))

  function togglePageSelect() {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const i of paged) next.delete(i.id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const i of paged) next.add(i.id)
        return next
      })
    }
  }

  // ── Right-click handler
  function handleRowRightClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    toggleStar(id)
  }

  // ── Delete
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await fineTunesApi.delete(id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fine-tunes"] })
      setSelectedIds(new Set())
      setDeleteDialogOpen(false)
      setDeleteUnderstood(false)
      setDeleteConfirmText("")
      toast.success(t("toastDeleted"))
    },
    onError: () => { toast.error(t("toastDeleteError")) },
  })

  function handleDelete() {
    const deletable = [...selectedIds].filter((id) => {
      const item = items.find((i) => i.id === id)
      return item && item.end_condition !== null
    })
    if (deletable.length > 0) {
      deleteMutation.mutate(deletable)
    }
  }

  const canDeleteSelected = useMemo(() => {
    return [...selectedIds].some((id) => {
      const item = items.find((i) => i.id === id)
      return item && item.end_condition !== null
    })
  }, [selectedIds, items])

  // ── Sortable header helper
  function SortHeader({ field, label, className }: { field: SortField; label: string; className?: string }) {
    const active = sortField === field
    return (
      <TableHead className={cn("cursor-pointer select-none", className)} onClick={() => toggleSort(field)}>
        <span className="inline-flex items-center gap-1">
          {label}
          {active ? (
            sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-40" />
          )}
        </span>
      </TableHead>
    )
  }

  return (
    <div className="flex flex-col">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-background">
        <div />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-7 pl-8 w-52 text-s"
          />
        </div>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
          <p className="text-sm font-medium">{t("noResults")}</p>
          <p className="text-xs">{t("noResultsHint")}</p>
        </div>
      ) : (
        <div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-4">
                  <div className="flex items-center gap-0.5">
                    <Checkbox
                      checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                      onCheckedChange={togglePageSelect}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors">
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.map((i) => i.id)))}>
                          {t("selectAll")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.filter((i) => starred.has(i.id)).map((i) => i.id)))}>
                          {t("selectStarred")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <SortHeader field="name" label={t("colName")} />
                <SortHeader field="engine_name" label={t("colEngine")} />
                <SortHeader field="end_condition" label={t("colStatus")} />
                <SortHeader field="outlet_group_name" label={t("colGroup")} />
                <SortHeader field="finetuned_outlets" label={t("colFinetuned")} className="text-right" />
                <SortHeader field="pathological_outlets" label={t("colPathological")} className="text-right" />
                <SortHeader field="worker_name" label={t("colWorker")} />
                <SortHeader field="duration" label={t("colDuration")} />
                <SortHeader field="created_at" label={t("colCreated")} />
                <TableHead className="w-10 text-center">
                  <button
                    onClick={() => toggleSort("starred")}
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
              {paged.map((item) => {
                const status = getStatusInfo(item)
                const isSelected = selectedIds.has(item.id)
                const isStarred = starred.has(item.id)
                return (
                  <TableRow
                    key={item.id}
                    className={cn(isSelected && "bg-[var(--muted)]/50")}
                    onContextMenu={(e) => handleRowRightClick(e, item.id)}
                  >
                    <TableCell className="pl-4">
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelected(item.id)} />
                    </TableCell>
                    <TableCell className="font-medium text-xs max-w-[200px] truncate">{item.name}</TableCell>
                    <TableCell className="text-xs">{item.engine_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={status.variant} className="text-[10px]">
                        {t(status.key)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{item.outlet_group_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{item.finetuned_outlets}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{item.pathological_outlets}</TableCell>
                    <TableCell className="text-xs">{item.worker_name ?? "—"}</TableCell>
                    <TableCell className="text-xs tabular-nums">{getDuration(item)}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {format(new Date(item.created_at), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-center">
                      <button
                        onClick={() => toggleStar(item.id)}
                        className="hover:text-amber-400 transition-colors cursor-pointer"
                        aria-label="Toggle star"
                      >
                        <Star
                          className={cn(
                            "h-4 w-4",
                            isStarred
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground"
                          )}
                        />
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Bottom: pagination + selection bar ── */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t">
          <span className="text-s text-muted-foreground">
            {t("showing", {
              from: (safePage - 1) * PAGE_SIZE + 1,
              to: Math.min(safePage * PAGE_SIZE, filtered.length),
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
              title={showOnlySelected ? "Show all" : "Show only selected"}
            >
              <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
              disabled={!canDeleteSelected}
              onClick={() => { setDeleteDialogOpen(true); setDeleteUnderstood(false); setDeleteConfirmText("") }}
              title="Delete selected"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Delete dialog ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("deleteConfirm")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteInputPlaceholder")}</label>
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="delete" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={!deleteUnderstood || deleteConfirmText !== "delete" || deleteMutation.isPending}
            >
              {t("deleteButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
