"use client"

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Plus, Search, Star, Trash2, Focus, ArrowUpDown,
  ChevronDown, ChevronUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
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
  predictionStrategiesApi, predictionEnginesApi, configurationApi, customerConfigurationApi,
  STRATEGY_TYPE_LABELS,
  type PredictionStrategyResponse, type PredictionStrategyUpdate,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "description" | "type" | "starred"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numField(val: number | null | undefined): string {
  return val == null ? "" : String(val)
}

function parseNum(s: string): number | null {
  const v = parseFloat(s)
  return isNaN(v) ? null : v
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function NumericInput({
  value,
  onChange,
  placeholder = "—",
  min,
  step,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  min?: number
  step?: number | "any"
}) {
  return (
    <Input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      step={step}
      className="h-8 text-sm max-w-[100px]"
    />
  )
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PredictionStrategiesPage() {
  const t = useTranslations("predictions.strategies")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()

  // ── Table state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state
  const [selectedStrategy, setSelectedStrategy] = useState<PredictionStrategyResponse | null>(null)
  const [activeTab, setActiveTab] = useState("tab1")
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  const [draft, setDraft] = useState<PredictionStrategyUpdate>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── New strategy dialog
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newType, setNewType] = useState(1)

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: strategies = [], isLoading } = useQuery({
    queryKey: ["prediction-strategies", activeCustomer?.id],
    queryFn: () => predictionStrategiesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  const { data: engines = [] } = useQuery({
    queryKey: ["prediction-engines"],
    queryFn: () => predictionEnginesApi.list(),
  })

  const { data: globalConfig } = useQuery({
    queryKey: ["configuration"],
    queryFn: () => configurationApi.get(),
  })

  const { data: customerConfig } = useQuery({
    queryKey: ["customer-configuration", activeCustomer?.id],
    queryFn: () => customerConfigurationApi.get(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  const defaultEngineId = customerConfig?.prediction_engine_id ?? globalConfig?.prediction_engine_id ?? null

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () =>
      predictionStrategiesApi.create({
        customer_id: activeCustomer!.id,
        name: newName,
        description: newDescription || null,
        type: newType,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["prediction-strategies"] })
      setNewDialogOpen(false)
      setNewName("")
      setNewDescription("")
      setNewType(1)
      setSelectedStrategy(created)
      toast.success(t("toastCreated", { name: created.name }))
    },
    onError: () => { toast.error(t("toastCreateError")) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PredictionStrategyUpdate }) =>
      predictionStrategiesApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["prediction-strategies"] })
      setSelectedStrategy(updated)
      toast.success(t("toastUpdated", { name: updated.name }))
    },
    onError: () => { toast.error(t("toastUpdateError")) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => predictionStrategiesApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["prediction-strategies"] })
      if (selectedStrategy?.id === id) setSelectedStrategy(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => { toast.error(t("toastDeleteError")) },
  })

  // ── Sync draft when selected strategy changes ──────────────────────────────

  useEffect(() => {
    if (selectedStrategy) {
      setDraft({
        name: selectedStrategy.name,
        description: selectedStrategy.description,
        type: selectedStrategy.type,
        prediction_engine_id: selectedStrategy.prediction_engine_id ?? defaultEngineId,
        increase_total_by_number: selectedStrategy.increase_total_by_number,
        increase_total_by_percentage: selectedStrategy.increase_total_by_percentage,
        increase_outlets_by_number: selectedStrategy.increase_outlets_by_number,
        increase_outlets_by_percentage: selectedStrategy.increase_outlets_by_percentage,
        fixed_total_draw: selectedStrategy.fixed_total_draw,
        total_return_percentage: selectedStrategy.total_return_percentage,
        outlet_return_percentage: selectedStrategy.outlet_return_percentage,
        ignore_fixed: selectedStrategy.ignore_fixed,
        ignore_minimum: selectedStrategy.ignore_minimum,
        ignore_maximum: selectedStrategy.ignore_maximum,
      })
    }
  }, [selectedStrategy?.id, defaultEngineId])

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selectedStrategy])

  const isDirty = useMemo(() => {
    if (!selectedStrategy) return false
    return (
      draft.name !== selectedStrategy.name ||
      draft.description !== selectedStrategy.description ||
      draft.type !== selectedStrategy.type ||
      draft.prediction_engine_id !== (selectedStrategy.prediction_engine_id ?? defaultEngineId) ||
      draft.increase_total_by_number !== selectedStrategy.increase_total_by_number ||
      draft.increase_total_by_percentage !== selectedStrategy.increase_total_by_percentage ||
      draft.increase_outlets_by_number !== selectedStrategy.increase_outlets_by_number ||
      draft.increase_outlets_by_percentage !== selectedStrategy.increase_outlets_by_percentage ||
      draft.fixed_total_draw !== selectedStrategy.fixed_total_draw ||
      draft.total_return_percentage !== selectedStrategy.total_return_percentage ||
      draft.outlet_return_percentage !== selectedStrategy.outlet_return_percentage ||
      draft.ignore_fixed !== selectedStrategy.ignore_fixed ||
      draft.ignore_minimum !== selectedStrategy.ignore_minimum ||
      draft.ignore_maximum !== selectedStrategy.ignore_maximum
    )
  }, [draft, selectedStrategy])

  function handleCancelDraft() {
    if (!selectedStrategy) return
    setDraft({
      name: selectedStrategy.name,
      description: selectedStrategy.description,
      type: selectedStrategy.type,
      prediction_engine_id: selectedStrategy.prediction_engine_id ?? defaultEngineId,
      increase_total_by_number: selectedStrategy.increase_total_by_number,
      increase_total_by_percentage: selectedStrategy.increase_total_by_percentage,
      increase_outlets_by_number: selectedStrategy.increase_outlets_by_number,
      increase_outlets_by_percentage: selectedStrategy.increase_outlets_by_percentage,
      fixed_total_draw: selectedStrategy.fixed_total_draw,
      total_return_percentage: selectedStrategy.total_return_percentage,
      outlet_return_percentage: selectedStrategy.outlet_return_percentage,
      ignore_fixed: selectedStrategy.ignore_fixed,
      ignore_minimum: selectedStrategy.ignore_minimum,
      ignore_maximum: selectedStrategy.ignore_maximum,
    })
  }

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? strategies.filter((s) => selectedIds.has(s.id))
      : strategies

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name": va = a.name; vb = b.name; break
        case "description": va = a.description ?? ""; vb = b.description ?? ""; break
        case "type": va = a.type; vb = b.type; break
        case "starred": va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [strategies, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

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

  function handleRowCheckbox(id: string, checked: boolean) {
    setSelectedIds((prev) => { const n = new Set(prev); checked ? n.add(id) : n.delete(id); return n })
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRowClick(strategy: PredictionStrategyResponse) {
    setSelectedStrategy(strategy)
    setActiveTab("tab1")
  }

  function handleRowRightClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    handleStar(id)
  }

  async function handleSave() {
    if (!selectedStrategy) return
    await updateMutation.mutateAsync({ id: selectedStrategy.id, data: draft })
  }

  function openDeleteDialog() {
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!selectedStrategy) return
    await deleteMutation.mutateAsync(selectedStrategy.id)
    setDeleteDialogOpen(false)
    setSelectedStrategy(null)
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

  function setDraftNum(key: keyof PredictionStrategyUpdate, val: string) {
    setDraft((prev) => ({ ...prev, [key]: parseNum(val) }))
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
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Top: Master table ── */}
      <div
        className="flex flex-col shrink-0"
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-background">
          <Button variant="default" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-3 w-3" />
            {t("newButton")}
          </Button>
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
        <div className="overflow-y-auto max-h-[45vh]">
          {isLoading || !activeCustomer ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
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
                          <button className="h-5 w-4 flex items-center justify-center hover:text-foreground transition-colors">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem
                            onClick={() => setSelectedIds(new Set(strategies.map((s) => s.id)))}
                          >
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setSelectedIds(
                                new Set(strategies.filter((s) => starredIds.has(s.id)).map((s) => s.id))
                              )
                            }
                          >
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="description" label={t("colDescription")} /></TableHead>
                  <TableHead><SortHeader field="type" label={t("colType")} /></TableHead>
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
                {pageItems.map((strategy) => (
                  <TableRow
                    key={strategy.id}
                    data-state={selectedStrategy?.id === strategy.id ? "selected" : undefined}
                    onClick={() => handleRowClick(strategy)}
                    onContextMenu={(e) => handleRowRightClick(e, strategy.id)}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(strategy.id)}
                        onCheckedChange={(c) => handleRowCheckbox(strategy.id, !!c)}
                      />
                    </TableCell>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {strategy.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-[240px] truncate">
                      {strategy.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {STRATEGY_TYPE_LABELS[strategy.type] ?? `Type ${strategy.type}`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStar(strategy.id)}
                        className="hover:text-amber-400 transition-colors"
                        aria-label="Toggle star"
                      >
                        <Star
                          className={cn(
                            "h-4 w-4",
                            starredIds.has(strategy.id)
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
                  title={showOnlySelected ? "Show all" : "Show only selected"}
                >
                  <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
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

      {/* ── Bottom: Detail pane ── */}
      {selectedStrategy && (
        <>
          <hr className="my-8" />

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Tabs */}
            <Tabs
              defaultValue="details"
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex-1 flex flex-col overflow-hidden gap-0"
            >
              <div className="relative w-full">

                <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabAdjustments")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabConstraints")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabOutletConstraints")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab5">{t("tabTechSpecs")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab6">{t("tabActions")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab7">{t("tabNotes")}</TabsTrigger>
                </TabsList>

                {/* <div className="flex-1 overflow-y-auto"> */}
                <div
                  className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                  style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
                />
              </div>

              {/* ─ Details ─ */}
              <TabsContent value="tab1" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <FieldRow label="ID">
                  <Input value={selectedStrategy.id} readOnly className="opacity-50 cursor-default select-all font-mono text-xs" />
                </FieldRow>
                <FieldRow label={t("fieldName")}>
                  <Input
                    value={draft.name ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="
                        px-4 
                        py-2.5 
                        focus:outline-none 
                        focus:ring-2 
                        focus:ring-neutral-600 
                        focus:border-transparent"
                  />
                </FieldRow>
                <FieldRow label={t("fieldDescription")}>
                  <Textarea
                    value={draft.description ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || null }))}
                    rows={4}
                    className="
                      space-y-6
                      w-full 
                      min-h-30 
                      px-4 
                      py-2.5 
                        resize-none 
                      focus:outline-none 
                      focus:ring-2 
                      focus:ring-neutral-600 
                      focus:border-transparent"
                  />
                </FieldRow>
              </TabsContent>

              {/* ─ Expand Strategies ─ */}
              <TabsContent value="tab2" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <FieldRow label={t("fieldIncreaseTotalByNumber")}>
                  <NumericInput
                    value={numField(draft.increase_total_by_number)}
                    onChange={(v) => setDraftNum("increase_total_by_number", v)}
                    min={0}
                    step={1}
                  />
                </FieldRow>
                <FieldRow label={t("fieldIncreaseTotalByPercentage")}>
                  <NumericInput
                    value={numField(draft.increase_total_by_percentage)}
                    onChange={(v) => setDraftNum("increase_total_by_percentage", v)}
                    min={0}
                    step="any"
                  />
                </FieldRow>
                <FieldRow label={t("fieldIncreaseOutletsByNumber")}>
                  <NumericInput
                    value={numField(draft.increase_outlets_by_number)}
                    onChange={(v) => setDraftNum("increase_outlets_by_number", v)}
                    min={0}
                    step={1}
                  />
                </FieldRow>
                <FieldRow label={t("fieldIncreaseOutletsByPercentage")}>
                  <NumericInput
                    value={numField(draft.increase_outlets_by_percentage)}
                    onChange={(v) => setDraftNum("increase_outlets_by_percentage", v)}
                    min={0}
                    step="any"
                  />
                </FieldRow>
              </TabsContent>

              {/* ─ Boundary Strategies ─ */}
              <TabsContent value="tab3" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <FieldRow label={t("fieldFixedTotalDraw")}>
                  <NumericInput
                    value={numField(draft.fixed_total_draw)}
                    onChange={(v) => setDraftNum("fixed_total_draw", v)}
                    min={0}
                    step={1}
                  />
                </FieldRow>
                <FieldRow label={t("fieldTotalReturnPercentage")}>
                  <NumericInput
                    value={numField(draft.total_return_percentage)}
                    onChange={(v) => setDraftNum("total_return_percentage", v)}
                    min={0}
                    step="any"
                  />
                </FieldRow>
                <FieldRow label={t("fieldOutletReturnPercentage")}>
                  <NumericInput
                    value={numField(draft.outlet_return_percentage)}
                    onChange={(v) => setDraftNum("outlet_return_percentage", v)}
                    min={0}
                    step="any"
                  />
                </FieldRow>
              </TabsContent>

              {/* ─ Outlet Controls ─ */}
              <TabsContent value="tab4" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <SwitchRow
                  label={t("fieldIgnoreFixedDraw")}
                  checked={!!draft.ignore_fixed}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, ignore_fixed: v }))}
                />
                <SwitchRow
                  label={t("fieldIgnoreMinimumDraw")}
                  checked={!!draft.ignore_minimum}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, ignore_minimum: v }))}
                />
                <SwitchRow
                  label={t("fieldIgnoreMaximumDraw")}
                  checked={!!draft.ignore_maximum}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, ignore_maximum: v }))}
                />
              </TabsContent>

              {/* ─ Tech Specs ─ */}
              <TabsContent value="tab5" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <FieldRow label={t("fieldEngine")}>
                  <select
                    value={draft.prediction_engine_id ?? defaultEngineId ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, prediction_engine_id: e.target.value || null }))}
                    className="flex h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    {engines.map((engine) => (
                      <option key={engine.id} value={engine.id}>{engine.name}</option>
                    ))}
                  </select>
                </FieldRow>
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="tab6" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <div className="rounded-md border border-destructive/30 p-4 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-destructive">{t("deleteButton")}</p>
                    <p className="text-xs text-muted-foreground">{t("deleteZoneDescription")}</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="shrink-0"
                    onClick={openDeleteDialog}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    {t("deleteButton")}
                  </Button>
                </div>
              </TabsContent>

              {/* ─ Notes ─ */}
              <TabsContent value="tab7" className="mt-6 pl-[2px] max-w-3xl space-y-6">

                {/* ── Strategy descriptions ── */}
                <div className="space-y-4">
                  {[
                    {
                      title: "Increase Total By Number",
                      body: "Adds a fixed number of extra copies to the total predicted delivery for the day. The additional copies are distributed greedily across outlets in order of highest expected return — outlets most likely to sell additional copies receive them first. Use this when you need to push a known absolute volume increase (e.g. a promotional print run of 500 extra copies).",
                    },
                    {
                      title: "Increase Total By Percentage",
                      body: "Increases the total predicted delivery by a percentage of the base predicted total. Like Increase Total By Number, the extra copies are distributed greedily by expected return. Use this for proportional uplifts — e.g. a 5% increase across the board during a high-demand period — where the uplift should scale with the size of the run.",
                    },
                    {
                      title: "Increase Outlets By Number",
                      body: "Adds a flat number of copies to every outlet individually, before delivery constraints are applied. Unlike the total-based adjustments, this affects all outlets equally regardless of their predicted demand. Use this when every outlet needs a guaranteed minimum uplift — for example, including a supplement or promotional insert that all outlets must carry.",
                    },
                    {
                      title: "Increase Outlets By Percentage",
                      body: "Increases each outlet's predicted delivery by a percentage of that outlet's own base prediction, before constraints are applied. Larger outlets receive more additional copies in absolute terms, but the relative uplift is equal across all outlets. Suitable for proportional outlet-level adjustments, such as accounting for a systematic under-prediction bias.",
                    },
                    {
                      title: "Fixed Total Delivery",
                      body: "Overrides the model's prediction entirely and delivers exactly this many copies in total, distributed across outlets via greedy allocation. Delivery constraints (minimum, maximum, fixed) are bypassed. Use this when the total print run is predetermined and must be fully distributed — for example, a fixed print-run contract where every copy must be placed.",
                    },
                    {
                      title: "Total Return Percentage",
                      body: "Targets a specific overall return rate across all outlets combined, using a Lagrange multiplier to find the profit-optimal per-outlet allocation. Outlets with better sell-through rates receive proportionally more copies. For example, a target of 15% means the strategy aims for roughly 85% of all delivered copies to be sold. Use this to balance distribution risk against revenue at the network level.",
                    },
                    {
                      title: "Outlet Return Percentage",
                      body: "Applies a uniform per-outlet return target: each outlet is delivered at the (100 − R)th percentile of its own historical demand distribution. For example, a 10% target delivers at the 90th percentile for each outlet individually — meaning each outlet is expected to sell out 90% of the time. This is more conservative than the total return approach as it protects every outlet equally, rather than concentrating risk on low-performers.",
                    },
                  ].map((item) => (
                    <div key={item.title}>
                      <p className="text-xs font-semibold mb-1">{item.title}</p>
                      <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{item.body}</p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border pt-6 space-y-4">
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2.5 text-left font-semibold text-xs text-[var(--muted-foreground)] whitespace-nowrap">Priority</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-xs text-[var(--muted-foreground)] whitespace-nowrap">Parameter</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-xs text-[var(--muted-foreground)]">Effect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[
                        {
                          priority: "1 (highest)",
                          param: "Fixed Total Delivery",
                          effect: "Ignores all base computation; distributes N copies from zero via heap",
                        },
                        {
                          priority: "2",
                          param: "Total Return Percentage",
                          effect: "Replaces eo/predicted as base with the (100−R)th percentile quantity",
                        },
                        {
                          priority: "3",
                          param: "Normal / Economic Optimal",
                          effect: "Uses eo if available, else predicted",
                        },
                        {
                          priority: "+after base",
                          param: "increase_outlets_by / _pct",
                          effect: "Applied to base before delivery constraints",
                        },
                        {
                          priority: "+after constraints",
                          param: "increase_total_by / _pct",
                          effect: "Distributed across outlets via heap after everything else",
                        },
                      ].map((row) => (
                        <tr key={row.priority} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)] whitespace-nowrap align-top">{row.priority}</td>
                          <td className={`px-4 py-2.5 text-xs whitespace-nowrap align-top ${row.param.startsWith("increase_") ? "font-mono opacity-70" : "font-medium"}`}>{row.param}</td>
                          <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)] align-top">{row.effect}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="space-y-2 text-xs text-[var(--muted-foreground)] list-disc pl-4">
                  <li>Delivery constraints (fixed, min, max, add, add_pct) always run after the base is determined.</li>
                  <li>Fixed Total Delivery will return a fixed total delivery quantity, but only if it does not conflict with fixed/minimum/maximum delivery constraints set at the outlet level.</li>
                  <li>Combining multiple strategies may have unpredictable results.</li>
                </ul>
                </div>
              </TabsContent>
            </Tabs>
          </div >

          {/* ── Shared save bar ── */}
          {isDirty && (
            <div className="shrink-0 border-t flex items-center justify-end gap-2 px-4 py-2 bg-background">
              <Button variant="secondary" size="sm" onClick={handleCancelDraft}>
                {t("deleteCancel")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("saving") : t("saveChanges")}
              </Button>
            </div>
          )}
        </>
      )
      }

      {/* ── New Strategy Dialog ── */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FieldRow label={t("fieldName")}>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("fieldNamePlaceholder")}
                autoFocus
              />
            </FieldRow>
            <FieldRow label={t("fieldDescription")}>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t("fieldDescriptionPlaceholder")}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setNewDialogOpen(false)}>
              {t("deleteCancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? t("creating") : t("createButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteAbsoluteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteAbsoluteDescription", { name: selectedStrategy?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox
                checked={deleteUnderstood}
                onCheckedChange={(v) => setDeleteUnderstood(!!v)}
                className="mt-0.5 shrink-0"
              />
              <span className="text-sm">{t("deleteUnderstand")}</span>
            </label>
            <FieldRow label={t("deleteTypeToConfirm")}>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t("deleteTypePlaceholder")}
              />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteDialogOpen(false)}>
              {t("deleteCancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={!deleteUnderstood || deleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
            >
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <FieldRow label={t("deleteTypeToConfirm")}>
              <Input
                value={bulkDeleteConfirmText}
                onChange={(e) => setBulkDeleteConfirmText(e.target.value)}
                placeholder={t("deleteTypePlaceholder")}
              />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)}>
              {t("deleteCancel")}
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

    </div >
  )
}
