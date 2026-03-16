"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Plus, Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp,
} from "lucide-react"
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
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
  simulationStrategiesApi, predictionStrategiesApi,
  SIMULATION_TYPE_LABELS,
  type SimulationStrategyResponse, type SimulationStrategyUpdate,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
const SIMULATION_TYPES = [1, 2, 3, 4] as const
type SortField = "strategy" | "type" | "delay" | "starred"

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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[var(--muted-foreground)]">{label}</label>
      {children}
    </div>
  )
}

// ─── localStorage helpers (scoped per customer) ─────────────────────────────

const SS_STORAGE_PREFIX = "gorm:simStrategies:"

function loadSsJson<T>(customerId: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${SS_STORAGE_PREFIX}${customerId}:${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveSsJson(customerId: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(`${SS_STORAGE_PREFIX}${customerId}:${key}`, JSON.stringify(value))
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SimulationStrategiesPage() {
  const t = useTranslations("simulations.strategies")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()
  const cid = activeCustomer?.id ?? ""

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadSsJson<string[]>(cid, "checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadSsJson<string[]>(cid, "starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("strategy")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state (persisted)
  const [selectedStratId, setSelectedStratId] = useState<string | null>(() => loadSsJson<string | null>(cid, "selectedStrat", null))
  const [selected, setSelected] = useState<SimulationStrategyResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadSsJson<string>(cid, "activeTab", "tab1"))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  const [draft, setDraft] = useState<SimulationStrategyUpdate>({})

  // ── Dialogs
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newType, setNewType] = useState(1)
  const [newDelay, setNewDelay] = useState(14)
  const [newPredictionStrategyId, setNewPredictionStrategyId] = useState<string | null>(null)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: strategies = [], isLoading } = useQuery({
    queryKey: ["simulation-strategies", activeCustomer?.id],
    queryFn: () => simulationStrategiesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  const { data: predictionStrategies = [] } = useQuery({
    queryKey: ["prediction-strategies", activeCustomer?.id],
    queryFn: () => predictionStrategiesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  // Map prediction strategy id → name for display
  const predictionStrategyNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of predictionStrategies) m[s.id] = s.name
    return m
  }, [predictionStrategies])

  // ── Persist state to localStorage ──────────────────────────────────────────

  useEffect(() => { if (cid) saveSsJson(cid, "checked", [...selectedIds]) }, [cid, selectedIds])
  useEffect(() => { if (cid) saveSsJson(cid, "starred", [...starredIds]) }, [cid, starredIds])
  useEffect(() => { if (cid) saveSsJson(cid, "activeTab", activeTab) }, [cid, activeTab])
  useEffect(() => { if (cid) saveSsJson(cid, "selectedStrat", selected?.id ?? null) }, [cid, selected?.id])

  // ── Restore selected strategy from persisted ID when list loads ────────────

  useEffect(() => {
    if (!strategies.length || selected) return
    if (selectedStratId) {
      const found = strategies.find((s) => s.id === selectedStratId)
      if (found) setSelected(found)
    }
  }, [strategies.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset persisted state when customer changes ───────────────────────────

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setSelectedIds(new Set(loadSsJson<string[]>(cid, "checked", [])))
      setStarredIds(new Set(loadSsJson<string[]>(cid, "starred", [])))
      setSelectedStratId(loadSsJson<string | null>(cid, "selectedStrat", null))
      setSelected(null)
      setActiveTab(loadSsJson<string>(cid, "activeTab", "tab1"))
    }
    prevCidRef.current = cid
  }, [cid])

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () =>
      simulationStrategiesApi.create({
        customer_id: activeCustomer!.id,
        prediction_strategy_id: newPredictionStrategyId,
        type: newType,
        delay: newDelay,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["simulation-strategies"] })
      setNewDialogOpen(false)
      setNewType(1)
      setNewDelay(14)
      setNewPredictionStrategyId(null)
      setSelected(created)
      toast.success(t("toastCreated"))
    },
    onError: () => { toast.error(t("toastCreateError")) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: SimulationStrategyUpdate }) =>
      simulationStrategiesApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["simulation-strategies"] })
      setSelected(updated)
      toast.success(t("toastUpdated"))
    },
    onError: () => { toast.error(t("toastUpdateError")) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => simulationStrategiesApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["simulation-strategies"] })
      if (selected?.id === id) setSelected(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => { toast.error(t("toastDeleteError")) },
  })

  // ── Sync draft when selection changes ─────────────────────────────────────

  useEffect(() => {
    if (selected) {
      setDraft({
        prediction_strategy_id: selected.prediction_strategy_id,
        type: selected.type,
        delay: selected.delay,
      })
    }
  }, [selected?.id])

  // ── Tab indicator ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selected])

  // ── isDirty ────────────────────────────────────────────────────────────────

  const isDirty = useMemo(() => {
    if (!selected) return false
    return (
      draft.prediction_strategy_id !== selected.prediction_strategy_id ||
      draft.type !== selected.type ||
      draft.delay !== selected.delay
    )
  }, [draft, selected])

  function handleCancelDraft() {
    if (!selected) return
    setDraft({
      prediction_strategy_id: selected.prediction_strategy_id,
      type: selected.type,
      delay: selected.delay,
    })
  }

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? strategies.filter((s) => selectedIds.has(s.id))
      : strategies

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((s) => {
        const stratName = s.prediction_strategy_id
          ? predictionStrategyNames[s.prediction_strategy_id]?.toLowerCase() ?? ""
          : ""
        const typeName = SIMULATION_TYPE_LABELS[s.type]?.toLowerCase() ?? ""
        return stratName.includes(q) || typeName.includes(q) || String(s.delay).includes(q)
      })
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "strategy":
          va = a.prediction_strategy_id ? (predictionStrategyNames[a.prediction_strategy_id] ?? "") : ""
          vb = b.prediction_strategy_id ? (predictionStrategyNames[b.prediction_strategy_id] ?? "") : ""
          break
        case "type": va = a.type; vb = b.type; break
        case "delay": va = a.delay; vb = b.delay; break
        case "starred": va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [strategies, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds, predictionStrategyNames])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((s) => selectedIds.has(s.id))
  const somePageSelected = pageItems.some((s) => selectedIds.has(s.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((s) => n.delete(s.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((s) => n.add(s.id)); return n })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function handleSave() {
    if (!selected) return
    await updateMutation.mutateAsync({ id: selected.id, data: draft })
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
    for (const id of selectedIds) await deleteMutation.mutateAsync(id)
    setSelectedIds(new Set())
    setBulkDeleteDialogOpen(false)
  }

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

  // ── Shared select style ────────────────────────────────────────────────────

  const selectCls = "flex h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className="flex flex-col shrink-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-background">
          <Button variant="default" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-3 w-3" />
            {t("newButton")}
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
        <div className="overflow-y-auto max-h-[45vh]">
          {isLoading || !activeCustomer ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--muted-foreground)]">
              <p className="text-sm">{t("noStrategies")}</p>
              <p className="text-xs opacity-60">{t("noStrategiesHint")}</p>
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
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(strategies.map((s) => s.id)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(strategies.filter((s) => starredIds.has(s.id)).map((s) => s.id)))}>
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="strategy" label={t("colStrategyName")} /></TableHead>
                  <TableHead><SortHeader field="type" label={t("colType")} /></TableHead>
                  <TableHead><SortHeader field="delay" label={t("colDelay")} /></TableHead>
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
                {pageItems.map((strategy) => (
                  <TableRow
                    key={strategy.id}
                    data-state={selected?.id === strategy.id ? "selected" : undefined}
                    onClick={() => { setSelected(strategy); setActiveTab("tab1") }}
                    onContextMenu={(e) => { e.preventDefault(); handleStar(strategy.id) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(strategy.id)}
                        onCheckedChange={(c) => setSelectedIds((prev) => {
                          const n = new Set(prev); c ? n.add(strategy.id) : n.delete(strategy.id); return n
                        })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {strategy.prediction_strategy_id
                        ? (predictionStrategyNames[strategy.prediction_strategy_id] ?? <span className="text-[var(--muted-foreground)] italic">Unknown</span>)
                        : <span className="text-[var(--muted-foreground)] italic">{t("fieldNoneStrategy")}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {SIMULATION_TYPE_LABELS[strategy.type] ?? `Type ${strategy.type}`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)]">{strategy.delay}d</TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleStar(strategy.id)} className="hover:text-amber-400 transition-colors cursor-pointer" aria-label="Toggle star">
                        <Star className={cn("h-4 w-4", starredIds.has(strategy.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
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
                  title={showOnlySelected ? "Show all" : "Show only selected"}
                >
                  <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
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
        <>
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-t">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
              <div className="relative w-full">
                <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabActions")}</TabsTrigger>
                </TabsList>
                <div
                  className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                  style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
                />
              </div>

              <div className="flex-1 overflow-y-auto">

                {/* ─ Details ─ */}
                <TabsContent value="tab1" className="space-y-6 max-w-2xl mt-6 px-4">
                  <FieldRow label={t("fieldId")}>
                    <Input value={selected.id} readOnly className="opacity-50 cursor-default select-all font-mono text-xs" />
                  </FieldRow>
                  <FieldRow label={t("fieldPredictionStrategy")}>
                    <select
                      value={draft.prediction_strategy_id ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, prediction_strategy_id: e.target.value || null }))}
                      className={selectCls}
                    >
                      <option value="">{t("fieldNoneStrategy")}</option>
                      {predictionStrategies.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </FieldRow>
                  <FieldRow label={t("fieldType")}>
                    <select
                      value={draft.type ?? 1}
                      onChange={(e) => setDraft((d) => ({ ...d, type: Number(e.target.value) }))}
                      className={selectCls}
                    >
                      {SIMULATION_TYPES.map((type) => (
                        <option key={type} value={type}>{SIMULATION_TYPE_LABELS[type]}</option>
                      ))}
                    </select>
                  </FieldRow>
                  <FieldRow label={t("fieldDelay")}>
                    <Input
                      type="number"
                      value={draft.delay ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, delay: Number(e.target.value) }))}
                      className="h-9 text-sm max-w-[120px]"
                    />
                  </FieldRow>
                </TabsContent>

                {/* ─ Actions ─ */}
                <TabsContent value="tab2" className="max-w-2xl mt-6 px-4">
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

          {/* ── Save bar ── */}
          {isDirty && (
            <div className="shrink-0 border-t flex items-center justify-end gap-2 px-4 py-2 bg-background">
              <Button variant="secondary" size="sm" onClick={handleCancelDraft}>
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("saving") : t("saveChanges")}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── New Strategy Dialog ── */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FieldRow label={t("fieldPredictionStrategy")}>
              <select
                value={newPredictionStrategyId ?? ""}
                onChange={(e) => setNewPredictionStrategyId(e.target.value || null)}
                className={selectCls}
              >
                <option value="">{t("fieldNoneStrategy")}</option>
                {predictionStrategies.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label={t("fieldType")}>
              <select
                value={newType}
                onChange={(e) => setNewType(Number(e.target.value))}
                className={selectCls}
              >
                {SIMULATION_TYPES.map((type) => (
                  <option key={type} value={type}>{SIMULATION_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label={t("fieldDelay")}>
              <Input
                type="number"
                value={newDelay}
                onChange={(e) => setNewDelay(Number(e.target.value))}
                className="h-9 text-sm max-w-[120px]"
              />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setNewDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? t("creating") : t("createButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Single Delete Dialog ── */}
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
            <FieldRow label={t("deleteTypeToConfirm")}>
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteDialogOpen(false)}>{t("cancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={handleDelete}
              disabled={!deleteUnderstood || deleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
            >
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Delete Dialog ── */}
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
            <FieldRow label={t("deleteTypeToConfirm")}>
              <Input value={bulkDeleteConfirmText} onChange={(e) => setBulkDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)}>{t("cancel")}</Button>
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
