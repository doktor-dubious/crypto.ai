"use client"

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import {
  Plus, Search, Star, Trash2, Focus, ArrowUpDown,
  ChevronDown, ChevronUp, Info, Check,
} from "lucide-react"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
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
  predictionEnginesApi, finetuneApi,
  type PredictionEngineResponse, type PredictionEngineUpdate,
  type PredictionEngineParameterResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "description" | "starred"

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORAGE_PREFIX = "gorm:aiModels:"

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

export default function AIModelsPage() {
  const t = useTranslations("aiModels")
  const queryClient = useQueryClient()

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state (persisted)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => loadJson<string | null>("selectedModel", null))
  const [selectedModel, setSelectedModel] = useState<PredictionEngineResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadJson<string>("activeTab", "tab1"))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  const [detailMaximized, setDetailMaximized] = useState(() => loadJson<boolean>("maximized", false))
  const [draft, setDraft] = useState<PredictionEngineUpdate>({})

  // ── Delete dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── New model dialog
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newSlug, setNewSlug] = useState("")
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")

  // ── Delete parameter dialog
  const [deleteParamDialogOpen, setDeleteParamDialogOpen] = useState(false)
  const [pendingDeleteParam, setPendingDeleteParam] = useState<PredictionEngineParameterResponse | null>(null)

  // ── Reset finetune dialog
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetUnderstood, setResetUnderstood] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState("")

  // ── Finetune hyperparameter state (persisted)
  const [ftContextLength, setFtContextLength] = useState(() => loadJson<number>("ftContextLength", 512))
  const [ftHorizon, setFtHorizon] = useState(() => loadJson<number>("ftHorizon", 64))
  const [ftEpochs, setFtEpochs] = useState(() => loadJson<number>("ftEpochs", 50))
  const [ftEarlyStoppingPatience, setFtEarlyStoppingPatience] = useState(() => loadJson<number>("ftEarlyStoppingPatience", 0))
  const [ftLearningRate, setFtLearningRate] = useState(() => loadJson<number>("ftLearningRate", 0.001))
  const [ftBatchSize, setFtBatchSize] = useState(() => loadJson<number>("ftBatchSize", 32))

  // ── New parameter dialog
  const [newParamDialogOpen, setNewParamDialogOpen] = useState(false)
  const [newParamName, setNewParamName] = useState("")
  const [newParamValue, setNewParamValue] = useState("")
  const [newParamParameter, setNewParamParameter] = useState("")
  const [newParamDescription, setNewParamDescription] = useState("")
  const [newParamSortOrder, setNewParamSortOrder] = useState(0)

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: models = [], isLoading } = useQuery({
    queryKey: ["prediction-engines"],
    queryFn: () => predictionEnginesApi.list(),
  })

  const { data: parameters = [] } = useQuery({
    queryKey: ["prediction-engine-parameters", selectedModel?.id],
    queryFn: () => predictionEnginesApi.listParameters(selectedModel!.id),
    enabled: !!selectedModel,
  })

  // ── Finetune data ───────────────────────────────────────────────────────────

  const { data: ftCount } = useQuery({
    queryKey: ["finetune-count", selectedModel?.id],
    queryFn: () => finetuneApi.count(selectedModel!.id),
    enabled: !!selectedModel,
  })

  // ── Persist state to localStorage ──────────────────────────────────────────

  useEffect(() => { saveJson("checked", [...selectedIds]) }, [selectedIds])
  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson("activeTab", activeTab) }, [activeTab])
  useEffect(() => { saveJson("maximized", detailMaximized) }, [detailMaximized])
  useEffect(() => { saveJson("selectedModel", selectedModel?.id ?? null) }, [selectedModel?.id])
  useEffect(() => { saveJson("ftContextLength", ftContextLength) }, [ftContextLength])
  useEffect(() => { saveJson("ftHorizon", ftHorizon) }, [ftHorizon])
  useEffect(() => { saveJson("ftEpochs", ftEpochs) }, [ftEpochs])
  useEffect(() => { saveJson("ftEarlyStoppingPatience", ftEarlyStoppingPatience) }, [ftEarlyStoppingPatience])
  useEffect(() => { saveJson("ftLearningRate", ftLearningRate) }, [ftLearningRate])
  useEffect(() => { saveJson("ftBatchSize", ftBatchSize) }, [ftBatchSize])

  // ── Restore selected model from persisted ID when list loads ──────────────

  useEffect(() => {
    if (!models.length || selectedModel) return
    if (selectedModelId) {
      const found = models.find((m) => m.id === selectedModelId)
      if (found) setSelectedModel(found)
    }
  }, [models.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () =>
      predictionEnginesApi.create({
        slug: newSlug,
        name: newName,
        description: newDescription || null,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["prediction-engines"] })
      setNewDialogOpen(false)
      setNewSlug("")
      setNewName("")
      setNewDescription("")
      setSelectedModel(created)
      toast.success(t("toastCreated", { name: created.name }))
    },
    onError: () => { toast.error(t("toastCreateError")) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PredictionEngineUpdate }) =>
      predictionEnginesApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["prediction-engines"] })
      setSelectedModel(updated)
      toast.success(t("toastUpdated", { name: updated.name }))
    },
    onError: () => { toast.error(t("toastUpdateError")) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => predictionEnginesApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["prediction-engines"] })
      if (selectedModel?.id === id) setSelectedModel(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => { toast.error(t("toastDeleteError")) },
  })

  const createParamMutation = useMutation({
    mutationFn: ({ engineId, name, value, parameter, description, sort_order }: { engineId: string; name: string; value: string; parameter: string; description: string; sort_order: number }) =>
      predictionEnginesApi.createParameter(engineId, { name, value, parameter: parameter || null, description: description || null, sort_order }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prediction-engine-parameters", selectedModel?.id] })
      setNewParamDialogOpen(false)
      setNewParamName("")
      setNewParamValue("")
      setNewParamParameter("")
      setNewParamDescription("")
      setNewParamSortOrder(0)
      toast.success(t("toastParameterCreated"))
    },
    onError: () => { toast.error(t("toastParameterCreateError")) },
  })

  const toggleParamMutation = useMutation({
    mutationFn: (paramId: string) => predictionEnginesApi.toggleParameterSelected(paramId),
    onSuccess: (updated) => {
      queryClient.setQueryData(["prediction-engine-parameters", selectedModel?.id], updated)
    },
  })

  const deleteParamMutation = useMutation({
    mutationFn: (paramId: string) => predictionEnginesApi.deleteParameter(paramId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prediction-engine-parameters", selectedModel?.id] })
      toast.success(t("toastParameterDeleted"))
    },
    onError: () => { toast.error(t("toastParameterDeleteError")) },
  })

  const resetFinetuneMutation = useMutation({
    mutationFn: (engineId: string) => predictionEnginesApi.resetFinetune(engineId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finetune-count", selectedModel?.id] })
      queryClient.invalidateQueries({ queryKey: ["fine-tunes"] })
      setResetDialogOpen(false)
      setResetUnderstood(false)
      setResetConfirmText("")
      toast.success(t("toastFinetuneReset"))
    },
    onError: () => { toast.error(t("toastFinetuneResetError")) },
  })

  // ── Sync draft when selected model changes ────────────────────────────────

  useEffect(() => {
    if (selectedModel) {
      setDraft({
        name: selectedModel.name,
        description: selectedModel.description,
        notes: selectedModel.notes,
        finetuned_model_path: selectedModel.finetuned_model_path,
        finetune_sync_every: selectedModel.finetune_sync_every,
        finetune_sync_target: selectedModel.finetune_sync_target,
      })
    }
  }, [selectedModel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selectedModel])

  const isDirty = useMemo(() => {
    if (!selectedModel) return false
    return (
      draft.name !== selectedModel.name ||
      draft.description !== selectedModel.description ||
      draft.notes !== selectedModel.notes ||
      draft.finetuned_model_path !== selectedModel.finetuned_model_path ||
      draft.finetune_sync_every !== selectedModel.finetune_sync_every ||
      draft.finetune_sync_target !== selectedModel.finetune_sync_target
    )
  }, [draft, selectedModel])

  function handleCancelDraft() {
    if (!selectedModel) return
    setDraft({
      name: selectedModel.name,
      description: selectedModel.description,
      notes: selectedModel.notes,
      finetuned_model_path: selectedModel.finetuned_model_path,
      finetune_sync_every: selectedModel.finetune_sync_every,
      finetune_sync_target: selectedModel.finetune_sync_target,
    })
  }

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? models.filter((m) => selectedIds.has(m.id))
      : models

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (m) => m.name.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q)
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name": va = a.name; vb = b.name; break
        case "description": va = a.description ?? ""; vb = b.description ?? ""; break
        case "starred": va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [models, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((m) => selectedIds.has(m.id))
  const somePageSelected = pageItems.some((m) => selectedIds.has(m.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((m) => n.delete(m.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((m) => n.add(m.id)); return n })
    }
  }

  function handleRowCheckbox(id: string, checked: boolean) {
    setSelectedIds((prev) => { const n = new Set(prev); checked ? n.add(id) : n.delete(id); return n })
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRowClick(model: PredictionEngineResponse) {
    setSelectedModel(model)
    setActiveTab("tab1")
  }

  function handleRowRightClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    handleStar(id)
  }

  async function handleSave() {
    if (!selectedModel) return
    await updateMutation.mutateAsync({ id: selectedModel.id, data: draft })
  }

  function openDeleteDialog() {
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!selectedModel) return
    await deleteMutation.mutateAsync(selectedModel.id)
    setDeleteDialogOpen(false)
    setSelectedModel(null)
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
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── Top: Master table ── */}
      <div className={cn("flex flex-col shrink-0", detailMaximized && "hidden")}>
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
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <p className="text-sm">{t("noModels")}</p>
              <p className="text-xs opacity-60">{t("noModelsHint")}</p>
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
                            onClick={() => setSelectedIds(new Set(models.map((m) => m.id)))}
                          >
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setSelectedIds(
                                new Set(models.filter((m) => starredIds.has(m.id)).map((m) => m.id))
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
                {pageItems.map((model) => (
                  <TableRow
                    key={model.id}
                    data-state={selectedModel?.id === model.id ? "selected" : undefined}
                    onClick={() => handleRowClick(model)}
                    onContextMenu={(e) => handleRowRightClick(e, model.id)}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(model.id)}
                        onCheckedChange={(c) => handleRowCheckbox(model.id, !!c)}
                      />
                    </TableCell>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {model.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-[240px] truncate">
                      {model.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStar(model.id)}
                        className="hover:text-amber-400 transition-colors"
                        aria-label="Toggle star"
                      >
                        <Star
                          className={cn(
                            "h-4 w-4",
                            starredIds.has(model.id)
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
      {selectedModel && (
        <>
          {!detailMaximized && <hr className="my-8" />}

          <div className="flex-1 flex flex-col min-h-0">
            {/* Tabs */}
            <Tabs
              defaultValue="details"
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex-1 flex flex-col gap-0 min-h-0 overflow-y-auto"
            >
              <div className="relative w-full shrink-0">
                <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabParameters")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabFinetune")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabAction")}</TabsTrigger>
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

              {/* ─ Details ─ */}
              <TabsContent value="tab1" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <FieldRow label="ID">
                  <div className="relative">
                    <Input value={selectedModel.id} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono text-xs" />
                    <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                      <CopyIcon
                        size={16}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedModel.id)
                          toast.success(t("toastCopied"))
                        }}
                      />
                    </AnimateIcon>
                  </div>
                </FieldRow>
                <FieldRow label={t("fieldSlug")}>
                  <Input value={selectedModel.slug} readOnly className="opacity-50 cursor-default select-all font-mono text-xs" />
                </FieldRow>
                <FieldRow label={t("fieldName")}>
                  <Input
                    value={draft.name ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
                  />
                </FieldRow>
                <FieldRow label={t("fieldDescription")}>
                  <Textarea
                    value={draft.description ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || null }))}
                    rows={4}
                    className="space-y-6 w-full min-h-30 px-4 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
                  />
                </FieldRow>
                <FieldRow label={t("fieldNotes")}>
                  <Textarea
                    value={draft.notes ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value || null }))}
                    rows={4}
                    className="space-y-6 w-full min-h-30 px-4 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
                  />
                </FieldRow>
              </TabsContent>

              {/* ─ Parameters ─ */}
              <TabsContent value="tab2" className="mt-6 pl-[2px]">
              <TooltipProvider>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium">{t("tabParameters")}</h3>
                  <Button variant="default" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setNewParamDialogOpen(true)}>
                    <Plus className="h-3 w-3" />
                    {t("addParameter")}
                  </Button>
                </div>

                {parameters.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
                    <p className="text-sm">{t("noParameters")}</p>
                    <p className="text-xs opacity-60">{t("noParametersHint")}</p>
                  </div>
                ) : (
                  (() => {
                    const grouped = parameters.reduce<Record<string, PredictionEngineParameterResponse[]>>((acc, p) => {
                      ;(acc[p.name] ??= []).push(p)
                      return acc
                    }, {})
                    return (
                      <div className="space-y-4 max-w-2xl">
                        {Object.entries(grouped).map(([name, items]) => (
                          <div key={name} className="rounded-md border p-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2">{name}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {items.map((item) => (
                                <span
                                  key={item.id}
                                  onClick={() => toggleParamMutation.mutate(item.id)}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono group cursor-pointer transition-colors",
                                    item.selected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-muted hover:bg-muted/80"
                                  )}
                                >
                                  {item.value}
                                  {item.description && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="h-3 w-3 shrink-0 cursor-help opacity-60" onClick={(e) => e.stopPropagation()} />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-xs">
                                        {item.description}
                                      </TooltipContent>
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
                    )
                  })()
                )}
              </TooltipProvider>
              </TabsContent>

              {/* ─ Finetune ─ */}
              <TabsContent value="tab4" className="mt-6 pl-[2px] pb-4">
                <TooltipProvider>
                    <div className="grid grid-cols-4 gap-8 max-w-5xl">
                      {/* Column 0: Progress */}
                      <div className="flex flex-col gap-4">
                        <h3 className="text-sm font-medium">{t("finetuneProgress")}</h3>
                        <div className="flex flex-col items-center gap-2">
                          <p className="text-3xl font-bold tabular-nums">{ftCount?.outlet_count ?? 0}</p>
                          <p className="text-xs text-muted-foreground text-center">
                            {(ftCount?.outlet_count ?? 0) === 0
                              ? t("finetuneCountZero")
                              : t("finetuneCount", { accounts: ftCount?.customer_count ?? 0, outlets: ftCount?.outlet_count ?? 0 })}
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="w-full cursor-pointer"
                          disabled={(ftCount?.outlet_count ?? 0) === 0}
                          onClick={() => setResetDialogOpen(true)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                          {t("finetuneResetButton")}
                        </Button>
                      </div>
                      {/* Column 1: Hyperparameters */}
                      <div className="flex flex-col gap-4">
                        <h3 className="text-sm font-medium">{t("finetuneParameters")}</h3>
                        {([
                          { key: "finetuneContextLength", value: ftContextLength, set: (v: number) => setFtContextLength(v), type: "int" },
                          { key: "finetuneHorizon", value: ftHorizon, set: (v: number) => setFtHorizon(v), type: "int" },
                          { key: "finetuneEpochs", value: ftEpochs, set: (v: number) => setFtEpochs(v), type: "int" },
                          { key: "finetuneEarlyStoppingPatience", value: ftEarlyStoppingPatience, set: (v: number) => setFtEarlyStoppingPatience(v), type: "int" },
                          { key: "finetuneLearningRate", value: ftLearningRate, set: (v: number) => setFtLearningRate(v), type: "float" },
                          { key: "finetuneBatchSize", value: ftBatchSize, set: (v: number) => setFtBatchSize(v), type: "int" },
                        ] as const).map(({ key, value, set, type }) => (
                          <div key={key} className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1">
                              <label className="text-xs font-medium text-muted-foreground">{t(key)}</label>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs text-xs">
                                  {t(`${key}Info`)}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <Input
                              type="number"
                              step={type === "float" ? "0.0001" : "1"}
                              value={value}
                              onChange={(e) => set(type === "float" ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0)}
                              className="h-9 text-xs"
                            />
                          </div>
                        ))}
                      </div>

                      {/* Column 3: Sync Parameters */}
                      <div className="flex flex-col gap-4">
                        <h3 className="text-sm font-medium">{t("finetuneSyncParameters")}</h3>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium text-muted-foreground">{t("finetuneSyncModelPath")}</label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                {t("finetuneSyncModelPathInfo")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Input
                            value={draft.finetuned_model_path ?? ""}
                            placeholder={t("finetuneSyncModelPathPlaceholder")}
                            onChange={(e) => setDraft((d) => ({ ...d, finetuned_model_path: e.target.value || null }))}
                            className="h-9 text-xs"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium text-muted-foreground">{t("finetuneSyncEvery")}</label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                {t("finetuneSyncEveryInfo")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={draft.finetune_sync_every ?? ""}
                            placeholder="5"
                            onChange={(e) => {
                              const v = e.target.value
                              setDraft((d) => ({ ...d, finetune_sync_every: v === "" ? null : Math.max(1, Math.min(100, parseInt(v, 10) || 5)) }))
                            }}
                            className="h-9 text-xs"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium text-muted-foreground">{t("finetuneSyncTarget")}</label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                {t("finetuneSyncTargetInfo")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Input
                            value={draft.finetune_sync_target ?? ""}
                            placeholder={t("finetuneSyncTargetPlaceholder")}
                            onChange={(e) => setDraft((d) => ({ ...d, finetune_sync_target: e.target.value || null }))}
                            className="h-9 text-xs"
                          />
                        </div>
                      </div>

                      {/* Column 3: Rules */}
                      <div className="flex flex-col gap-4">
                        <h3 className="text-sm font-medium">{t("finetuneRules")}</h3>
                        <p className="text-xs text-muted-foreground">{t("finetunePathologicalDetection")}</p>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium text-muted-foreground">{t("finetuneSaneEpochs")}</label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                {t("finetuneSaneEpochsInfo")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            value={draft.finetune_sane_epochs ?? ""}
                            placeholder="5"
                            onChange={(e) => {
                              const v = e.target.value
                              setDraft((d) => ({ ...d, finetune_sane_epochs: v === "" ? null : Math.max(1, parseInt(v, 10) || 5) }))
                            }}
                            className="h-9 text-xs"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium text-muted-foreground">{t("finetuneMaxMae")}</label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                {t("finetuneMaxMaeInfo")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={draft.finetune_max_mae ?? ""}
                            placeholder="10"
                            onChange={(e) => {
                              const v = e.target.value
                              setDraft((d) => ({ ...d, finetune_max_mae: v === "" ? null : Math.max(0, parseFloat(v) || 10) }))
                            }}
                            className="h-9 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                </TooltipProvider>
              </TabsContent>

              {/* ─ Action ─ */}
              <TabsContent value="tab3" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                {/* Danger zone */}
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
            </Tabs>
          </div>

          {/* ── Shared save bar ── */}
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

      {/* ── New Model Dialog ── */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FieldRow label={t("fieldSlug")}>
              <Input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder={t("fieldSlugPlaceholder")}
                autoFocus
              />
            </FieldRow>
            <FieldRow label={t("fieldName")}>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("fieldNamePlaceholder")}
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
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={!newSlug.trim() || !newName.trim() || createMutation.isPending}
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
              {t("deleteAbsoluteDescription", { name: selectedModel?.name ?? "" })}
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
              {t("cancel")}
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

      {/* ── New Parameter Dialog ── */}
      <Dialog open={newParamDialogOpen} onOpenChange={setNewParamDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addParameterTitle")}</DialogTitle>
            <DialogDescription>{t("addParameterDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FieldRow label={t("paramName")}>
              <Input
                value={newParamName}
                onChange={(e) => setNewParamName(e.target.value)}
                placeholder={t("paramNamePlaceholder")}
                autoFocus
              />
            </FieldRow>
            <FieldRow label={t("paramValue")}>
              <Input
                value={newParamValue}
                onChange={(e) => setNewParamValue(e.target.value)}
                placeholder={t("paramValuePlaceholder")}
              />
            </FieldRow>
            <FieldRow label={t("fieldParameter")}>
              <Input
                value={newParamParameter}
                onChange={(e) => setNewParamParameter(e.target.value)}
                placeholder={t("fieldParameterPlaceholder")}
              />
            </FieldRow>
            <FieldRow label={t("fieldDescription")}>
              <Input
                value={newParamDescription}
                onChange={(e) => setNewParamDescription(e.target.value)}
                placeholder={t("fieldDescriptionPlaceholder")}
              />
            </FieldRow>
            <FieldRow label={t("fieldSortOrder")}>
              <Input
                type="number"
                value={newParamSortOrder}
                onChange={(e) => setNewParamSortOrder(parseInt(e.target.value) || 0)}
              />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setNewParamDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => selectedModel && createParamMutation.mutate({ engineId: selectedModel.id, name: newParamName, value: newParamValue, parameter: newParamParameter, description: newParamDescription, sort_order: newParamSortOrder })}
              disabled={!newParamName.trim() || !newParamValue.trim() || createParamMutation.isPending}
            >
              {createParamMutation.isPending ? t("creating") : t("addParameter")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Parameter Confirmation Dialog ── */}
      <Dialog open={deleteParamDialogOpen} onOpenChange={setDeleteParamDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteParamTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteParamDescription", { name: pendingDeleteParam?.name ?? "", value: pendingDeleteParam?.value ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteParamDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (pendingDeleteParam) {
                  deleteParamMutation.mutate(pendingDeleteParam.id)
                  setDeleteParamDialogOpen(false)
                  setPendingDeleteParam(null)
                }
              }}
              disabled={deleteParamMutation.isPending}
            >
              {t("deleteParamConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Finetune Dialog ── */}
      <Dialog open={resetDialogOpen} onOpenChange={(open) => { setResetDialogOpen(open); if (!open) { setResetUnderstood(false); setResetConfirmText("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("finetuneResetTitle")}</DialogTitle>
            <DialogDescription>
              {t("finetuneResetDescription", { name: selectedModel?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox
                checked={resetUnderstood}
                onCheckedChange={(v) => setResetUnderstood(!!v)}
                className="mt-0.5 shrink-0"
              />
              <span className="text-sm">{t("finetuneResetUnderstand")}</span>
            </label>
            <FieldRow label={t("finetuneResetTypeToConfirm")}>
              <Input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder={t("deleteTypePlaceholder")}
              />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setResetDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { if (selectedModel) resetFinetuneMutation.mutate(selectedModel.id) }}
              disabled={!resetUnderstood || resetConfirmText !== t("deleteTypePlaceholder") || resetFinetuneMutation.isPending}
            >
              {t("finetuneResetConfirm")}
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
