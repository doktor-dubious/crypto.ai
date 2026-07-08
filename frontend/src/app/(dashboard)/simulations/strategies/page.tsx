"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp, Plus, Info, Copy,
} from "lucide-react"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  klineStrategiesApi, predictionEnginesApi,
  type KlineStrategyResponse, type KlineStrategyUpdate, type KlineStrategyParameterResponse,
} from "@/lib/api"

const ITEMS_PER_PAGE = 10
const SELECT_CLASS = "h-9 w-full px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
type SortField = "name" | "simulation_strategy" | "forecast_engine" | "forecast_vol" | "starred"

const STRATEGY_OPTIONS = [
  { value: "price", label: "Price" },
  { value: "kline", label: "Kline" },
] as const

function strategyLabel(v: string | null | undefined) {
  return STRATEGY_OPTIONS.find((s) => s.value === v)?.label ?? (v || "—")
}

function buildPaginationPages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "ellipsis")[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push("ellipsis")
  for (let p = start; p <= end; p++) pages.push(p)
  if (end < total - 1) pages.push("ellipsis")
  pages.push(total)
  return pages
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

export default function StrategiesPage() {
  const queryClient = useQueryClient()

  // ── Master table state ──
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)

  // ── Detail pane state ──
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("details")
  const [draft, setDraft] = useState<KlineStrategyUpdate>({})
  const [detailMaximized, setDetailMaximized] = useState(false)
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Parameter dialogs ──
  const [newParamDialogOpen, setNewParamDialogOpen] = useState(false)
  const [newParamName, setNewParamName] = useState("")
  const [newParamValue, setNewParamValue] = useState("")
  const [newParamDescription, setNewParamDescription] = useState("")
  const [deleteParamDialogOpen, setDeleteParamDialogOpen] = useState(false)
  const [pendingDeleteParam, setPendingDeleteParam] = useState<KlineStrategyParameterResponse | null>(null)

  // ── Delete-strategy dialog (Actions tab) ──
  const [deleteStrategyDialogOpen, setDeleteStrategyDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")

  const { data: strategies = [], isLoading } = useQuery({
    queryKey: ["klineStrategies"],
    queryFn: () => klineStrategiesApi.list(),
  })

  const { data: engines = [] } = useQuery({
    queryKey: ["prediction-engines"],
    queryFn: () => predictionEnginesApi.list(),
  })

  const selected = useMemo(
    () => strategies.find((s) => s.id === selectedId) ?? null,
    [strategies, selectedId],
  )

  const { data: parameters = [] } = useQuery({
    queryKey: ["klineStrategyParams", selectedId],
    queryFn: () => klineStrategiesApi.listParameters(selectedId!),
    enabled: !!selectedId,
  })

  // Seed draft when selection changes
  useEffect(() => {
    if (selected) {
      setDraft({
        name: selected.name,
        description: selected.description,
        simulation_strategy: selected.simulation_strategy,
        finetuned_model: selected.finetuned_model,
        forecast_engine: selected.forecast_engine,
        forecast_vol: selected.forecast_vol,
        horizon: selected.horizon,
        covariate_mode: selected.covariate_mode,
      })
    }
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasChanges = useMemo(() => {
    if (!selected) return false
    return (
      draft.name !== selected.name ||
      (draft.description ?? null) !== selected.description ||
      draft.simulation_strategy !== selected.simulation_strategy ||
      (draft.finetuned_model ?? null) !== selected.finetuned_model ||
      (draft.forecast_engine ?? null) !== selected.forecast_engine ||
      draft.forecast_vol !== selected.forecast_vol ||
      (draft.horizon ?? 1) !== selected.horizon ||
      (draft.covariate_mode ?? "off") !== selected.covariate_mode
    )
  }, [draft, selected])

  // Animated tab underline
  useEffect(() => {
    const el = tabsListRef.current?.querySelector('[data-state="active"]') as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selected, detailMaximized])

  // ── Mutations ──
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["klineStrategies"] })
  const invalidateParams = () => queryClient.invalidateQueries({ queryKey: ["klineStrategyParams", selectedId] })

  const createMutation = useMutation({
    mutationFn: () => klineStrategiesApi.create({ name: "New strategy", simulation_strategy: "price" }),
    onSuccess: (s) => { invalidate(); setSelectedId(s.id); setActiveTab("details"); toast.success("Strategy created") },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: KlineStrategyUpdate }) => klineStrategiesApi.update(id, data),
    onSuccess: () => { invalidate(); toast.success("Saved") },
  })

  const starMutation = useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) => klineStrategiesApi.update(id, { starred }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => klineStrategiesApi.delete(id))),
    onSuccess: (_r, ids) => {
      invalidate()
      setSelectedIds(new Set())
      if (selectedId && ids.includes(selectedId)) setSelectedId(null)
      toast.success("Deleted")
    },
  })

  function openDeleteStrategyDialog() {
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteStrategyDialogOpen(true)
  }

  async function handleDeleteStrategy() {
    if (!selectedId) return
    await deleteMutation.mutateAsync([selectedId])
    setDeleteStrategyDialogOpen(false)
  }

  const addParamMutation = useMutation({
    mutationFn: () => klineStrategiesApi.addParameter(selectedId!, { name: newParamName.trim(), value: newParamValue.trim(), description: newParamDescription.trim() || null }),
    onSuccess: () => {
      invalidateParams()
      setNewParamDialogOpen(false)
      setNewParamName(""); setNewParamValue(""); setNewParamDescription("")
      toast.success("Parameter added")
    },
  })

  const toggleParamMutation = useMutation({
    mutationFn: ({ paramId, selected: sel }: { paramId: string; selected: boolean }) =>
      klineStrategiesApi.updateParameter(selectedId!, paramId, { selected: sel }),
    onSuccess: invalidateParams,
  })

  const deleteParamMutation = useMutation({
    mutationFn: (paramId: string) => klineStrategiesApi.deleteParameter(selectedId!, paramId),
    onSuccess: () => {
      invalidateParams()
      setDeleteParamDialogOpen(false)
      setPendingDeleteParam(null)
      toast.success("Parameter removed")
    },
  })

  const copyParamsMutation = useMutation({
    mutationFn: () => klineStrategiesApi.copyEngineParameters(selectedId!, draft.forecast_engine!),
    onSuccess: (added) => {
      invalidateParams()
      toast.success(added.length ? `Copied ${added.length} parameter${added.length === 1 ? "" : "s"}` : "No new parameters to copy")
    },
  })

  // ── Derived list ──
  const filtered = useMemo(() => {
    let items = showOnlySelected ? strategies.filter((s) => selectedIds.has(s.id)) : strategies
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (s) => s.name.toLowerCase().includes(q) ||
               s.description?.toLowerCase().includes(q) ||
               s.forecast_engine?.toLowerCase().includes(q),
      )
    }
    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name": va = a.name; vb = b.name; break
        case "simulation_strategy": va = a.simulation_strategy; vb = b.simulation_strategy; break
        case "forecast_engine": va = a.forecast_engine ?? ""; vb = b.forecast_engine ?? ""; break
        case "forecast_vol": va = a.forecast_vol ? 1 : 0; vb = b.forecast_vol ? 1 : 0; break
        case "starred": va = a.starred ? 1 : 0; vb = b.starred ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [strategies, search, sortField, sortDir, showOnlySelected, selectedIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  useEffect(() => { if (selectedIds.size === 0 && showOnlySelected) setShowOnlySelected(false) }, [selectedIds, showOnlySelected])

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button onClick={() => handleSort(field)} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors text-left">
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((s) => selectedIds.has(s.id))
  const somePageSelected = pageItems.some((s) => selectedIds.has(s.id))

  function saveDraft() {
    if (!selected) return
    updateMutation.mutate({ id: selected.id, data: draft })
  }

  function cancelDraft() {
    if (!selected) return
    setDraft({
      name: selected.name,
      description: selected.description,
      simulation_strategy: selected.simulation_strategy,
      finetuned_model: selected.finetuned_model,
      forecast_engine: selected.forecast_engine,
      forecast_vol: selected.forecast_vol,
      horizon: selected.horizon,
      covariate_mode: selected.covariate_mode,
    })
  }

  // Group parameters by name (crypto.ai-style)
  const paramGroups = useMemo(() => {
    const map = new Map<string, KlineStrategyParameterResponse[]>()
    for (const p of parameters) {
      const arr = map.get(p.name) ?? []
      arr.push(p)
      map.set(p.name, arr)
    }
    return [...map.entries()]
  }, [parameters])

  const triggerClass = "bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top: Master table ── */}
      <div className={cn("flex flex-col shrink-0", detailMaximized && selected && "hidden")}>
        <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-background">
          <Button size="sm" className="h-7 cursor-pointer" onClick={() => createMutation.mutate()}>
            <Plus className="h-4 w-4" /> New strategy
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search strategies..." value={search} onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }} className="h-7 pl-8 w-52 text-sm" />
          </div>
        </div>

        <div className="overflow-y-auto max-h-[45vh]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
              <p className="text-sm">No strategies yet</p>
              <p className="text-xs opacity-60">Click “New strategy” to create one.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-4">
                    <Checkbox
                      checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                      onCheckedChange={(c) => setSelectedIds(c ? new Set(pageItems.map((s) => s.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead><SortHeader field="name" label="Name" /></TableHead>
                  <TableHead><SortHeader field="simulation_strategy" label="Strategy" /></TableHead>
                  <TableHead><SortHeader field="forecast_engine" label="Engine" /></TableHead>
                  <TableHead><SortHeader field="forecast_vol" label="Vol" /></TableHead>
                  <TableHead className="w-10 text-center">
                    <button onClick={() => handleSort("starred")} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors mx-auto">
                      <Star className={cn("h-4 w-4", sortField === "starred" ? "" : "opacity-40")} />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((s) => (
                  <TableRow
                    key={s.id}
                    data-state={selectedId === s.id ? "selected" : undefined}
                    onClick={() => { setSelectedId(s.id); setActiveTab("details") }}
                    onContextMenu={(e) => { e.preventDefault(); starMutation.mutate({ id: s.id, starred: !s.starred }) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(s.id)}
                        onCheckedChange={(c) => {
                          setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(s.id) : n.delete(s.id); return n })
                          if (c) { setSelectedId(s.id); setActiveTab("details") }
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-sm max-w-[18rem] truncate">{s.name || <span className="text-muted-foreground italic">Untitled</span>}</TableCell>
                    <TableCell className="text-sm">{strategyLabel(s.simulation_strategy)}</TableCell>
                    <TableCell className="font-mono text-xs">{s.forecast_engine || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{s.forecast_vol ? "Yes" : <span className="text-muted-foreground">No</span>}</TableCell>
                    <TableCell className="text-center w-10" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => starMutation.mutate({ id: s.id, starred: !s.starred })} className="hover:text-amber-400 transition-colors" aria-label="Toggle star">
                        <Star className={cn("h-4 w-4", s.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="shrink-0 border-t bg-background">
          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-1.5">
              <span className="text-xs text-muted-foreground">
                Showing {(safePage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(safePage * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
              </span>
              {totalPages > 1 && (
                <Pagination className="w-auto mx-0">
                  <PaginationContent>
                    <PaginationItem><PaginationPrevious onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} /></PaginationItem>
                    {buildPaginationPages(safePage, totalPages).map((p, i) =>
                      p === "ellipsis" ? (
                        <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                      ) : (
                        <PaginationItem key={p}><PaginationLink isActive={safePage === p} onClick={() => setCurrentPage(p)}>{p}</PaginationLink></PaginationItem>
                      )
                    )}
                    <PaginationItem><PaginationNext onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} /></PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
              <span className="text-xs text-muted-foreground">Selected {selectedIds.size} of {filtered.length}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer" onClick={() => setShowOnlySelected((v) => !v)} title={showOnlySelected ? "Show all" : "Show only selected"}>
                  <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer" onClick={() => deleteMutation.mutate([...selectedIds])} title="Delete selected">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom: Detail pane ── */}
      {selected && (
        <>
          <hr className={cn("my-8", detailMaximized && "hidden")} />
          <div className="flex-1 flex flex-col min-h-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 gap-0">
              <div className="px-4">
                <div className="relative w-full">
                  <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex justify-start">
                    <TabsTrigger className={triggerClass} value="details">Details</TabsTrigger>
                    <TabsTrigger className={triggerClass} value="strategy">Strategy</TabsTrigger>
                    <TabsTrigger className={triggerClass} value="aimodel">AI Model</TabsTrigger>
                    <TabsTrigger className={triggerClass} value="actions">Actions</TabsTrigger>
                    <div
                      className="ml-auto flex items-center pr-2 pl-3 mb-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setDetailMaximized((v) => !v)}
                      aria-label={detailMaximized ? "Normalize" : "Maximize"}
                      title={detailMaximized ? "Normalize" : "Maximize"}
                    >
                      {detailMaximized ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
                    </div>
                  </TabsList>
                  <div
                    className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                    style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4">
                {/* ─ Details ─ */}
                <TabsContent value="details" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                  <FieldRow label="ID">
                    <div className="relative">
                      <Input value={selected.id} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono text-xs" />
                      <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                        <CopyIcon size={16} className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => { navigator.clipboard.writeText(selected.id); toast.success("Copied to clipboard") }} />
                      </AnimateIcon>
                    </div>
                  </FieldRow>
                  <FieldRow label="Name">
                    <Input value={draft.name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Strategy name" />
                  </FieldRow>
                  <FieldRow label="Description">
                    <Textarea value={draft.description ?? ""} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || null }))} placeholder="What is this strategy for?" rows={4} />
                  </FieldRow>
                </TabsContent>

                {/* ─ Strategy ─ */}
                <TabsContent value="strategy" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                  <FieldRow label="Simulation Strategy">
                    <select value={draft.simulation_strategy ?? "price"} onChange={(e) => setDraft((d) => ({ ...d, simulation_strategy: e.target.value }))} className={SELECT_CLASS}>
                      {STRATEGY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label="Finetuned model">
                    <select value={draft.finetuned_model ?? ""} onChange={(e) => setDraft((d) => ({ ...d, finetuned_model: e.target.value || null }))} className={SELECT_CLASS}>
                      <option value="">Base model (no finetuning)</option>
                    </select>
                  </FieldRow>
                  <FieldRow label="Forecast horizon">
                    <div className="flex flex-col gap-1.5 max-w-xl">
                      <Input
                        type="number"
                        min={1}
                        max={168}
                        value={draft.horizon ?? 1}
                        onChange={(e) => setDraft((d) => ({ ...d, horizon: Math.max(1, Math.min(168, parseInt(e.target.value, 10) || 1)) }))}
                        className="w-28"
                      />
                      <span className="text-xs text-muted-foreground">
                        Bars per forecast step. 1 = classic next-bar walk-forward. Higher values forecast the close H bars ahead over non-overlapping windows and score the H-bar move — calling the local trend while forgiving individual candles. Price strategy only.
                      </span>
                    </div>
                  </FieldRow>
                </TabsContent>

                {/* ─ AI Model ─ */}
                <TabsContent value="aimodel" className="space-y-6 max-w-2xl mt-6 pl-[2px] pb-8">
                  <FieldRow label="Forecast Engine">
                    <select value={draft.forecast_engine ?? ""} onChange={(e) => setDraft((d) => ({ ...d, forecast_engine: e.target.value || null }))} className={SELECT_CLASS}>
                      <option value="">{engines.length === 0 ? "Loading engines..." : "Select engine..."}</option>
                      {engines.map((eng) => <option key={eng.slug} value={eng.slug}>{eng.name}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label="Forecast volatility">
                    <label className="flex items-start gap-2 cursor-pointer max-w-xl">
                      <Checkbox checked={draft.forecast_vol ?? false} onCheckedChange={(c) => setDraft((d) => ({ ...d, forecast_vol: !!c }))} className="mt-0.5" />
                      <span className="text-xs text-muted-foreground">
                        Also run a second one-step forecast of realized volatility, so the Backtest tab’s vol-targeting / vol-breakout strategies can use a genuine volatility forecast instead of the price band width. Roughly doubles run time.
                      </span>
                    </label>
                  </FieldRow>
                  <FieldRow label="Signal covariates">
                    <div className="flex flex-col gap-1.5 max-w-xl">
                      <select
                        value={draft.covariate_mode ?? "off"}
                        onChange={(e) => setDraft((d) => ({ ...d, covariate_mode: e.target.value as "off" | "native" | "external" }))}
                        className={SELECT_CLASS}
                      >
                        <option value="off">Off</option>
                        <option value="native">Native — model-side covariate API</option>
                        <option value="external">External — trailing-Ridge walk-forward adjustment</option>
                      </select>
                      <span className="text-xs text-muted-foreground">
                        How the swing-signal series (volume/range/trade-count z-scores, taker tilt, streak, stretch, wicks — the same signals the Swings tab uses) reach the model. Native feeds them through the engine&apos;s own covariate API so the model can learn non-linear interactions — requires TimesFM or Chronos-2; other engines are refused at run time. External fits a Ridge on the run&apos;s own trailing (signals → residual) history and adjusts each forecast — strictly past-only, pooled across the whole walk-forward, and works with EVERY engine (orchestration groups included). Optional strategy parameters tune it: cov_window (trailing fit window in bars, default expanding), cov_alpha (Ridge penalty, 1.0), cov_warmup (unadjusted warm-up bars, 50), cov_refit (refit cadence, 50). Compare the same coin/timeframe across off / native / external on the Score/Sig columns to measure what the signals add.
                      </span>
                    </div>
                  </FieldRow>

                  {/* ── Parameters ── */}
                  <div className="border-t border-border pt-6">
                    <TooltipProvider>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium">Parameters</h3>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1.5"
                            disabled={!draft.forecast_engine || copyParamsMutation.isPending}
                            title={draft.forecast_engine ? "Copy this model's parameters from the ai-models catalog" : "Select a Forecast Engine first"}
                            onClick={() => copyParamsMutation.mutate()}
                          >
                            <Copy className="h-3 w-3" /> {copyParamsMutation.isPending ? "Copying…" : "Copy Parameters"}
                          </Button>
                          <Button variant="default" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setNewParamDialogOpen(true)}>
                            <Plus className="h-3 w-3" /> Add Parameter
                          </Button>
                        </div>
                      </div>

                      {paramGroups.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-28 gap-2 text-muted-foreground">
                          <p className="text-sm">No parameters yet</p>
                          <p className="text-xs opacity-60">Add tunable name→value pairs for the AI model.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {paramGroups.map(([name, items]) => (
                            <div key={name} className="rounded-md border p-3">
                              <p className="text-xs font-medium text-muted-foreground mb-2">{name}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {items.map((item) => (
                                  <span
                                    key={item.id}
                                    onClick={() => toggleParamMutation.mutate({ paramId: item.id, selected: !item.selected })}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono group cursor-pointer transition-colors",
                                      item.selected ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80",
                                    )}
                                  >
                                    {item.value}
                                    {item.description && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Info className="h-3 w-3 shrink-0 cursor-help opacity-60" onClick={(e) => e.stopPropagation()} />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-xs">{item.description}</TooltipContent>
                                      </Tooltip>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPendingDeleteParam(item); setDeleteParamDialogOpen(true) }}
                                      className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                                      aria-label="Remove"
                                    >
                                      &times;
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TooltipProvider>
                  </div>
                </TabsContent>

                {/* ─ Actions ─ */}
                <TabsContent value="actions" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                  <div className="rounded-md border border-destructive/30 p-4 flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-destructive">Delete Strategy</p>
                      <p className="text-xs text-muted-foreground">
                        Permanently delete this strategy and its parameters. This cannot be undone.
                      </p>
                    </div>
                    <Button variant="destructive" size="sm" className="shrink-0" onClick={openDeleteStrategyDialog}>
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete
                    </Button>
                  </div>
                </TabsContent>
              </div>
            </Tabs>

            {/* Sticky save bar */}
            {hasChanges && (
              <div className="shrink-0 border-t flex items-center justify-end gap-2 px-4 py-2 bg-background">
                <Button variant="secondary" size="sm" onClick={cancelDraft}>Cancel</Button>
                <Button size="sm" onClick={saveDraft} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Add parameter dialog */}
      <Dialog open={newParamDialogOpen} onOpenChange={setNewParamDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Parameter</DialogTitle>
            <DialogDescription>Add a tunable parameter for the AI model.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FieldRow label="Name"><Input value={newParamName} onChange={(e) => setNewParamName(e.target.value)} placeholder="e.g. context_len" /></FieldRow>
            <FieldRow label="Value"><Input value={newParamValue} onChange={(e) => setNewParamValue(e.target.value)} placeholder="e.g. 512" /></FieldRow>
            <FieldRow label="Description (optional)"><Input value={newParamDescription} onChange={(e) => setNewParamDescription(e.target.value)} placeholder="" /></FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setNewParamDialogOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!newParamName.trim() || !newParamValue.trim() || addParamMutation.isPending} onClick={() => addParamMutation.mutate()}>
              {addParamMutation.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete parameter confirm */}
      <Dialog open={deleteParamDialogOpen} onOpenChange={setDeleteParamDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove parameter?</DialogTitle>
            <DialogDescription>
              {pendingDeleteParam ? `Remove “${pendingDeleteParam.name}: ${pendingDeleteParam.value}”? This can’t be undone.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteParamDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" disabled={deleteParamMutation.isPending} onClick={() => { if (pendingDeleteParam) deleteParamMutation.mutate(pendingDeleteParam.id) }}>
              {deleteParamMutation.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete strategy confirm */}
      <Dialog open={deleteStrategyDialogOpen} onOpenChange={setDeleteStrategyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete strategy?</DialogTitle>
            <DialogDescription>
              This permanently deletes {selected?.name ? `“${selected.name}”` : "this strategy"} and its parameters. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">I understand this permanently deletes the strategy and its parameters.</span>
            </label>
            <FieldRow label="Type 'delete' to confirm">
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="delete" />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteStrategyDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteStrategy}
              disabled={!deleteUnderstood || deleteConfirmText !== "delete" || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete strategy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
