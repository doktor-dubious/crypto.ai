"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp,
  ArrowUpRight, ArrowDownRight, Minus, Loader2, Info,
} from "lucide-react"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
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
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip"
import { useCustomer } from "@/components/providers/customer-provider"
import { useLock } from "@/components/providers/lock-provider"
import {
  finetuneExaminationsApi,
  type FinetuneExaminationResponse, type AccuracyStatsResponse, type ZeroShotResponse,
  type FilteredOverviewResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "status" | "created_at" | "starred"

type ExamStatus = "pending" | "running_base" | "running_finetuned" | "computing" | "completed" | "failed"

const STATUS_BADGE: Record<ExamStatus, { variant: "muted" | "info" | "success" | "destructive" | "warning"; labelKey: string }> = {
  pending: { variant: "muted", labelKey: "statusPending" },
  running_base: { variant: "info", labelKey: "statusRunningBase" },
  running_finetuned: { variant: "info", labelKey: "statusRunningFinetuned" },
  computing: { variant: "info", labelKey: "statusComputing" },
  completed: { variant: "success", labelKey: "statusCompleted" },
  failed: { variant: "destructive", labelKey: "statusFailed" },
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

function formatDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "—"
  return v.toFixed(decimals)
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—"
  return `${v.toFixed(1)}%`
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4">
      <label className="text-xs font-medium text-[var(--muted-foreground)] pt-2.5">{label}</label>
      <div>{children}</div>
    </div>
  )
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORAGE_PREFIX = "gorm:ft-exam:"

function loadJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

// ─── Metric delta component ──────────────────────────────────────────────────

function MetricDelta({ base, finetuned, lowerIsBetter = true }: {
  base: number | null | undefined
  finetuned: number | null | undefined
  lowerIsBetter?: boolean
}) {
  if (base == null || finetuned == null) return <span className="text-[var(--muted-foreground)]">—</span>
  const diff = finetuned - base
  if (Math.abs(diff) < 0.001) return <Minus className="h-3.5 w-3.5 text-[var(--muted-foreground)] inline" />
  const improved = lowerIsBetter ? diff < 0 : diff > 0
  const pct = base !== 0 ? Math.abs(diff / base) * 100 : 0
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", improved ? "text-emerald-500" : "text-red-500")}>
      {improved ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
      {pct.toFixed(1)}%
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinetuneExaminationsPage() {
  const t = useTranslations("simulations.finetuned")
  const { activeCustomer } = useCustomer()
  const { isLocked } = useLock()
  const queryClient = useQueryClient()

  const cid = activeCustomer?.id ?? ""

  // ─── Selection / starred state ────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    new Set(loadJson<string[]>(cid, "checked", []))
  )
  const [starredIds, setStarredIds] = useState<Set<string>>(() =>
    new Set(loadJson<string[]>(cid, "starred", []))
  )

  useEffect(() => { if (cid) saveJson(cid, "checked", [...selectedIds]) }, [cid, selectedIds])
  useEffect(() => { if (cid) saveJson(cid, "starred", [...starredIds]) }, [cid, starredIds])

  // ─── Filters & sort ────────────────────────────────────────────────────────
  const [search, setSearch] = useState("")
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [currentPage, setCurrentPage] = useState(1)

  // ─── Detail pane ──────────────────────────────────────────────────────────
  const [selectedExamId, setSelectedExamId] = useState<string | null>(() =>
    loadJson<string | null>(cid, "selectedExam", null)
  )
  const [selected, setSelected] = useState<FinetuneExaminationResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadJson<string>(cid, "activeTab", "details"))

  useEffect(() => { if (cid) saveJson(cid, "selectedExam", selectedExamId) }, [cid, selectedExamId])
  useEffect(() => { if (cid) saveJson(cid, "activeTab", activeTab) }, [cid, activeTab])

  // ─── Delete dialog ────────────────────────────────────────────────────────
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FinetuneExaminationResponse | null>(null)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ─── Data fetching ────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["finetune-examinations", cid],
    queryFn: () => finetuneExaminationsApi.list(cid),
    enabled: !!cid,
    retry: false,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? []
      const hasRunning = items.some((e) => ["pending", "running_base", "running_finetuned", "computing"].includes(e.status))
      return hasRunning ? 10_000 : false
    },
  })

  const examinations = data?.items ?? []

  // Keep selected in sync
  useEffect(() => {
    if (selectedExamId && examinations.length) {
      const found = examinations.find((e) => e.id === selectedExamId)
      setSelected(found ?? null)
    }
  }, [selectedExamId, examinations])

  // ─── Filtering / sorting ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let items = examinations

    if (search) {
      const q = search.toLowerCase()
      items = items.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        e.base_engine?.toLowerCase().includes(q) ||
        e.finetuned_engine?.toLowerCase().includes(q)
      )
    }

    if (showOnlySelected && selectedIds.size > 0) {
      items = items.filter((e) => selectedIds.has(e.id))
    }

    items = [...items].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      if (sortField === "starred") {
        return ((starredIds.has(a.id) ? 1 : 0) - (starredIds.has(b.id) ? 1 : 0)) * dir
      }
      if (sortField === "name") return a.name.localeCompare(b.name) * dir
      if (sortField === "status") return (a.status ?? "").localeCompare(b.status ?? "") * dir
      if (sortField === "created_at") return a.created_at.localeCompare(b.created_at) * dir
      return 0
    })

    return items
  }, [examinations, search, showOnlySelected, selectedIds, starredIds, sortField, sortDir])

  useEffect(() => { setCurrentPage(1) }, [search, showOnlySelected])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const pageItems = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
  const allPageSelected = pageItems.length > 0 && pageItems.every((e) => selectedIds.has(e.id))
  const somePageSelected = pageItems.some((e) => selectedIds.has(e.id))

  // ─── Mutations ────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (id: string) => finetuneExaminationsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["finetune-examinations"] })
      if (selected?.id === id) { setSelected(null); setSelectedExamId(null) }
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  function handleHeaderCheckbox(checked: boolean | "indeterminate") {
    if (checked) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((e) => n.add(e.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((e) => n.delete(e.id)); return n })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRowClick(exam: FinetuneExaminationResponse) {
    setSelectedExamId(exam.id)
    setSelected(exam)
  }

  function openDeleteDialog(exam: FinetuneExaminationResponse) {
    setDeleteTarget(exam)
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id)
    setDeleteDialogOpen(false)
  }

  function openBulkDeleteDialog() {
    setBulkDeleteUnderstood(false)
    setBulkDeleteConfirmText("")
    setBulkDeleteDialogOpen(true)
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    for (const id of ids) {
      await deleteMutation.mutateAsync(id)
    }
    setBulkDeleteDialogOpen(false)
  }

  // ─── Sort header ──────────────────────────────────────────────────────────

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button onClick={() => handleSort(field)} className="flex items-center gap-1 cursor-pointer text-left">
        {label}
        {active ? (
          sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    )
  }

  // ─── Tab indicator ────────────────────────────────────────────────────────

  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  useEffect(() => {
    const list = tabsListRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>("[data-state=active]")
    if (active) setIndicatorStyle({ left: active.offsetLeft, width: active.offsetWidth })
  }, [activeTab, selected])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!activeCustomer) return null

  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-height))] overflow-hidden">
      {/* ─── Master list ──────────────────────────────────────────────────── */}
      <div className="flex flex-col min-h-0 overflow-hidden">
        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-y-auto max-h-[50vh]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-[var(--muted-foreground)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-1">
              <p className="text-sm text-[var(--muted-foreground)]">{t("noExaminations")}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{t("noExaminationsHint")}</p>
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
                          <button className="h-5 w-4 flex items-center justify-center cursor-pointer">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.map((e) => e.id)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(filtered.filter((e) => starredIds.has(e.id)).map((e) => e.id)))}>
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="status" label={t("colStatus")} /></TableHead>
                  <TableHead><SortHeader field="created_at" label={t("colRunDate")} /></TableHead>
                  <TableHead className="w-10 text-center">
                    <button onClick={() => handleSort("starred")} className="flex items-center gap-1 cursor-pointer">
                      <Star className="h-4 w-4" />
                      {sortField === "starred" && (
                        sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((exam) => {
                  const badge = STATUS_BADGE[exam.status as ExamStatus] ?? STATUS_BADGE.pending
                  return (
                    <TableRow
                      key={exam.id}
                      data-state={selected?.id === exam.id ? "selected" : undefined}
                      onClick={() => handleRowClick(exam)}
                      onContextMenu={(e) => { e.preventDefault(); handleStar(exam.id) }}
                      className="cursor-pointer"
                    >
                      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(exam.id)}
                          onCheckedChange={(c) =>
                            setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(exam.id) : n.delete(exam.id); return n })
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">{exam.name}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{t(badge.labelKey as Parameters<typeof t>[0])}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-[var(--muted-foreground)]">
                        {formatDateTime(exam.created_at)}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleStar(exam.id)} className="hover:text-amber-400 transition-colors cursor-pointer">
                          <Star className={cn("h-4 w-4", starredIds.has(exam.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-1.5 border-t text-xs text-[var(--muted-foreground)]">
            <span>
              {t("showing", {
                from: (currentPage - 1) * ITEMS_PER_PAGE + 1,
                to: Math.min(currentPage * ITEMS_PER_PAGE, filtered.length),
                total: filtered.length,
              })}
            </span>
            <Pagination>
              <PaginationContent className="gap-0.5">
                <PaginationItem>
                  <PaginationPrevious onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className={currentPage === 1 ? "pointer-events-none opacity-40" : "cursor-pointer"} />
                </PaginationItem>
                {buildPaginationPages(currentPage, totalPages).map((p, i) =>
                  p === "ellipsis" ? (
                    <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={p === currentPage} onClick={() => setCurrentPage(p)} className="cursor-pointer">{p}</PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className={currentPage === totalPages ? "pointer-events-none opacity-40" : "cursor-pointer"} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}

        {/* Selection action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-t bg-[var(--muted)]/30">
            <span className="text-xs text-[var(--muted-foreground)]">
              {t("selectedCount", { selected: selectedIds.size, total: filtered.length })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="sm" className="h-7 gap-1.5 px-2 cursor-pointer"
                onClick={() => setShowOnlySelected((v) => !v)}
              >
                <Focus className={cn("h-3.5 w-3.5", showOnlySelected && "text-primary")} />
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                onClick={openBulkDeleteDialog}
                disabled={isLocked}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Detail pane ──────────────────────────────────────────────────── */}
      {selected && (
        <div className="flex flex-col min-h-0 flex-1 overflow-hidden border-t">
          {/* Tab bar */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
            <div className="relative w-full">
              <TabsList ref={tabsListRef} className="w-full bg-transparent border-b rounded-none p-0 h-auto flex">
                {(["details", "report", "actions"] as const).map((tab) => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className="bg-transparent! rounded-none border-b-2 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer text-xs px-4 py-2"
                  >
                    {t(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}` as Parameters<typeof t>[0])}
                  </TabsTrigger>
                ))}
                <div className="flex-1" />
                <div
                  className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                  style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
                />
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* ─── Report tab ──────────────────────────────────────────── */}
              <TabsContent value="report" className="mt-0 px-4 py-4">
                <ReportTab exam={selected} t={t} />
              </TabsContent>

              {/* ─── Details tab ─────────────────────────────────────────── */}
              <TabsContent value="details" className="space-y-6 max-w-2xl mt-6 px-4">
                <FieldRow label="ID">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-xs opacity-70">{selected.id}</span>
                    <AnimateIcon animateOnHover className="cursor-pointer">
                      <CopyIcon
                        size={14}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText(selected.id)
                          toast.success(t("toastCopied"))
                        }}
                      />
                    </AnimateIcon>
                  </span>
                </FieldRow>
                <FieldRow label={t("fieldName")}><span className="text-sm">{selected.name}</span></FieldRow>
                <FieldRow label={t("fieldDescription")}><span className="text-sm text-[var(--muted-foreground)]">{selected.description || "—"}</span></FieldRow>
                <FieldRow label={t("fieldPeriod")}><span className="text-sm">{formatDate(selected.simulation_from)} — {formatDate(selected.simulation_to)}</span></FieldRow>
                <FieldRow label={t("fieldBaseEngine")}><span className="text-sm">{selected.base_engine || "—"}</span></FieldRow>
                <FieldRow label={t("fieldFtEngine")}><span className="text-sm">{selected.finetuned_engine || "—"}</span></FieldRow>
                <FieldRow label={t("fieldFtModel")}><span className="text-sm font-mono text-xs">{selected.finetuned_model || "—"}</span></FieldRow>
                <FieldRow label={t("fieldDelay")}><span className="text-sm">{selected.delay ?? "—"}</span></FieldRow>
                <FieldRow label={t("fieldStatus")}>
                  <Badge variant={STATUS_BADGE[selected.status as ExamStatus]?.variant ?? "muted"}>
                    {t(STATUS_BADGE[selected.status as ExamStatus]?.labelKey as Parameters<typeof t>[0] ?? "statusPending")}
                  </Badge>
                </FieldRow>
                <FieldRow label={t("fieldStartedAt")}><span className="text-sm">{formatDateTime(selected.started_at)}</span></FieldRow>
                <FieldRow label={t("fieldCompletedAt")}><span className="text-sm">{formatDateTime(selected.completed_at)}</span></FieldRow>
                {selected.error && (
                  <FieldRow label="Error"><span className="text-sm text-destructive">{selected.error}</span></FieldRow>
                )}
              </TabsContent>

              {/* ─── Actions tab ─────────────────────────────────────────── */}
              <TabsContent value="actions" className="space-y-6 max-w-2xl mt-6 px-4">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-destructive">{t("deleteButton")}</h3>
                  <p className="text-xs text-[var(--muted-foreground)]">{t("deleteZoneDescription")}</p>
                  <Button
                    variant="destructive" size="sm"
                    onClick={() => openDeleteDialog(selected)}
                    disabled
                    className="cursor-not-allowed"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    {t("deleteButton")}
                  </Button>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}

      {/* ─── Single delete dialog ─────────────────────────────────────────── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteAbsoluteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteAbsoluteDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} />
              <span>{t("deleteUnderstand")}</span>
            </label>
            <div>
              <p className="text-xs text-[var(--muted-foreground)] mb-1">{t("deleteTypeToConfirm")}</p>
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} className="h-8" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} className="cursor-pointer">{t("deleteCancel")}</Button>
            <Button
              variant="destructive"
              disabled={!deleteUnderstood || deleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
              onClick={handleDelete}
              className="cursor-pointer"
            >
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Bulk delete dialog ───────────────────────────────────────────── */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bulkDeleteTitle", { count: selectedIds.size })}</DialogTitle>
            <DialogDescription>{t("bulkDeleteDescription", { count: selectedIds.size })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={bulkDeleteUnderstood} onCheckedChange={(v) => setBulkDeleteUnderstood(!!v)} />
              <span>{t("bulkDeleteUnderstand")}</span>
            </label>
            <div>
              <p className="text-xs text-[var(--muted-foreground)] mb-1">{t("deleteTypeToConfirm")}</p>
              <Input value={bulkDeleteConfirmText} onChange={(e) => setBulkDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} className="h-8" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkDeleteDialogOpen(false)} className="cursor-pointer">{t("deleteCancel")}</Button>
            <Button
              variant="destructive"
              disabled={!bulkDeleteUnderstood || bulkDeleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
              onClick={handleBulkDelete}
              className="cursor-pointer"
            >
              {t("bulkDeleteConfirm", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Report Tab ──────────────────────────────────────────────────────────────

function ReportTab({ exam, t }: { exam: FinetuneExaminationResponse; t: ReturnType<typeof useTranslations<"simulations.finetuned">> }) {
  if (exam.status !== "completed") {
    if (exam.status === "failed") {
      return (
        <div className="space-y-4">
          <p className="text-sm text-destructive">{exam.error}</p>
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
        <p className="text-sm text-[var(--muted-foreground)]">{t("reportPending")}</p>
      </div>
    )
  }

  const bs = exam.base_stats as AccuracyStatsResponse | null
  const fs = exam.finetuned_stats as AccuracyStatsResponse | null
  const bz = exam.base_zero_shot as ZeroShotResponse | null
  const fz = exam.finetuned_zero_shot as ZeroShotResponse | null
  const bo = exam.base_overview as FilteredOverviewResponse | null
  const fo = exam.finetuned_overview as FilteredOverviewResponse | null

  // Build unified rows: [section, metric, base, finetuned, delta, change, lowerIsBetter]
  type Row = { section: string; metric: string; info?: string; base: string; ft: string; delta: string; baseNum: number | null | undefined; ftNum: number | null | undefined; lowerIsBetter: boolean; isFirstInSection: boolean; sectionRowCount: number }

  const rows: Row[] = []

  // 1. Overview
  if (bo || fo) {
    const overviewItems: [string, number | null | undefined, number | null | undefined][] = [
      ["Delivered", bo?.total_delivered, fo?.total_delivered],
      ["Sold", bo?.total_sold, fo?.total_sold],
      ["Returned", bo?.total_returned, fo?.total_returned],
      ["Sold Out %", bo?.sold_out_pct, fo?.sold_out_pct],
    ]
    overviewItems.forEach(([metric, bv, fv], i) => {
      rows.push({
        section: t("reportOverview"),
        metric,
        base: fmtNum(bv, metric === "Sold Out %" ? 1 : 0),
        ft: fmtNum(fv, metric === "Sold Out %" ? 1 : 0),
        delta: bv != null && fv != null ? fmtNum(fv - bv, metric === "Sold Out %" ? 1 : 0) : "—",
        baseNum: bv, ftNum: fv,
        lowerIsBetter: metric === "Returned",
        isFirstInSection: i === 0,
        sectionRowCount: overviewItems.length,
      })
    })
  }

  // 2. Zero Shot Accuracy
  if (bz || fz) {
    const zsItems: [string, number | undefined, number | undefined][] = [
      ["Exact (±0)", bz?.zero_shot, fz?.zero_shot],
      ["±1", bz?.zero_shot_plus_1, fz?.zero_shot_plus_1],
      ["±2", bz?.zero_shot_plus_2, fz?.zero_shot_plus_2],
    ]
    zsItems.forEach(([metric, bv, fv], i) => {
      const bPct = bv != null && bz?.total ? (bv / bz.total) * 100 : null
      const fPct = fv != null && fz?.total ? (fv / fz.total) * 100 : null
      rows.push({
        section: t("reportZeroShot"),
        metric,
        base: bPct != null ? fmtPct(bPct) : "—",
        ft: fPct != null ? fmtPct(fPct) : "—",
        delta: bPct != null && fPct != null ? fmtPct(fPct - bPct) : "—",
        baseNum: bPct, ftNum: fPct,
        lowerIsBetter: false,
        isFirstInSection: i === 0,
        sectionRowCount: zsItems.length,
      })
    })
  }

  // 3. Comparison Report (accuracy stats)
  if (bs || fs) {
    const compItems: { metric: string; info?: string; base: number | null | undefined; ft: number | null | undefined; lowerIsBetter: boolean; decimals: number }[] = [
      { metric: t("reportMAE"), info: t("reportMAEInfo"), base: bs?.mae, ft: fs?.mae, lowerIsBetter: true, decimals: 2 },
      { metric: t("reportRMSE"), info: t("reportRMSEInfo"), base: bs?.rmse, ft: fs?.rmse, lowerIsBetter: true, decimals: 2 },
      { metric: t("reportBias"), info: t("reportBiasInfo"), base: bs?.bias, ft: fs?.bias, lowerIsBetter: true, decimals: 2 },
      { metric: t("reportMAPE"), info: t("reportMAPEInfo"), base: bs?.mape, ft: fs?.mape, lowerIsBetter: true, decimals: 1 },
      { metric: t("reportR2"), info: t("reportR2Info"), base: bs?.r_squared, ft: fs?.r_squared, lowerIsBetter: false, decimals: 4 },
      { metric: t("reportN"), info: t("reportNInfo"), base: bs?.count, ft: fs?.count, lowerIsBetter: false, decimals: 0 },
    ]
    compItems.forEach((m, i) => {
      rows.push({
        section: t("reportTitle"),
        metric: m.metric,
        info: m.info,
        base: fmtNum(m.base, m.decimals),
        ft: fmtNum(m.ft, m.decimals),
        delta: m.base != null && m.ft != null ? fmtNum(m.ft - m.base, m.decimals) : "—",
        baseNum: m.base, ftNum: m.ft,
        lowerIsBetter: m.lowerIsBetter,
        isFirstInSection: i === 0,
        sectionRowCount: compItems.length,
      })
    })
  }

  return (
    <div className="space-y-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-40"></TableHead>
            <TableHead className="text-xs">{t("reportMetric")}</TableHead>
            <TableHead className="text-xs text-right">{t("reportBase")}</TableHead>
            <TableHead className="text-xs text-right">{t("reportFinetuned")}</TableHead>
            <TableHead className="text-xs text-right">{t("reportDelta")}</TableHead>
            <TableHead className="text-xs text-center">{t("reportImprovement")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={`${row.section}-${row.metric}-${i}`}>
              {row.isFirstInSection ? (
                <TableCell rowSpan={row.sectionRowCount} className="text-xs font-semibold align-top border-r border-[var(--border)]">
                  {row.section}
                </TableCell>
              ) : null}
              <TableCell className="text-xs font-medium">
                <span className="inline-flex items-center gap-1">
                  {row.metric}
                  {row.info && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-[var(--muted-foreground)] cursor-help shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        {row.info}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">{row.base}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">{row.ft}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">{row.delta}</TableCell>
              <TableCell className="text-center">
                <MetricDelta base={row.baseNum} finetuned={row.ftNum} lowerIsBetter={row.lowerIsBetter} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* ─── Conclusion ──────────────────────────────────────────────────── */}
      {exam.conclusion && (
        <div>
          <h3 className="text-sm font-semibold mb-2">{t("reportConclusion")}</h3>
          <div className="rounded-md bg-[var(--muted)]/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {exam.conclusion}
          </div>
        </div>
      )}
    </div>
  )
}
