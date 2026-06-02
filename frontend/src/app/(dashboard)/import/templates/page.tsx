"use client"

import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, ArrowUpDown, ChevronDown, ChevronUp, Plus,
  Settings, ListFilter, X, Copy, GripVertical, Focus,
} from "lucide-react"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
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
  importTemplatesApi,
  type ImportTemplateResponse,
  type ImportTemplateElementResponse,
  type ImportTemplateUpdate,
  type ImportTemplateElementUpdate,
  type ImportTemplateElementCreate,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "separator" | "starred"

type Section =
  | "miscellaneous"
  | "distribution"
  | "outletDetails"
  | "outletInstructions"
  | "userDefined"

interface AvailableField {
  type: string
  labelKey: string
  section: Section
  weekdayStart?: number
}

const WEEKDAYS: [string, string, string][] = [
  // [day-english, Open-key, Fixed-key, Min-key] — 4 entries, handled below
  ["Monday", "elementMondayOpen", "elementMondayFixed"],
  ["Tuesday", "elementTuesdayOpen", "elementTuesdayFixed"],
  ["Wednesday", "elementWednesdayOpen", "elementWednesdayFixed"],
  ["Thursday", "elementThursdayOpen", "elementThursdayFixed"],
  ["Friday", "elementFridayOpen", "elementFridayFixed"],
  ["Saturday", "elementSaturdayOpen", "elementSaturdayFixed"],
  ["Sunday", "elementSundayOpen", "elementSundayFixed"],
]

function buildWeekdayFields(): AvailableField[] {
  const out: AvailableField[] = []
  const openKeys = [
    "elementMondayOpen", "elementTuesdayOpen", "elementWednesdayOpen",
    "elementThursdayOpen", "elementFridayOpen", "elementSaturdayOpen", "elementSundayOpen",
  ]
  const fixedKeys = [
    "elementMondayFixed", "elementTuesdayFixed", "elementWednesdayFixed",
    "elementThursdayFixed", "elementFridayFixed", "elementSaturdayFixed", "elementSundayFixed",
  ]
  const minKeys = [
    "elementMondayMinimum", "elementTuesdayMinimum", "elementWednesdayMinimum",
    "elementThursdayMinimum", "elementFridayMinimum", "elementSaturdayMinimum", "elementSundayMinimum",
  ]
  for (let d = 1; d <= 7; d++) {
    out.push({ type: "weekday_open", labelKey: openKeys[d - 1], section: "outletInstructions", weekdayStart: d })
  }
  for (let d = 1; d <= 7; d++) {
    out.push({ type: "weekday_fixed", labelKey: fixedKeys[d - 1], section: "outletInstructions", weekdayStart: d })
  }
  for (let d = 1; d <= 7; d++) {
    out.push({ type: "weekday_minimum", labelKey: minKeys[d - 1], section: "outletInstructions", weekdayStart: d })
  }
  return out
}
void WEEKDAYS

const AVAILABLE_FIELDS: AvailableField[] = [
  // Miscellaneous
  { type: "unused", labelKey: "elementUnused", section: "miscellaneous" },
  { type: "account_id", labelKey: "elementAccountId", section: "miscellaneous" },

  // Distribution
  { type: "date", labelKey: "elementDate", section: "distribution" },
  { type: "quantity", labelKey: "elementQuantity", section: "distribution" },
  { type: "quantity_adjustment", labelKey: "elementQuantityAdjustment", section: "distribution" },
  { type: "sold_net", labelKey: "elementSoldNet", section: "distribution" },
  { type: "sold_scan", labelKey: "elementSoldScan", section: "distribution" },
  { type: "return", labelKey: "elementReturn", section: "distribution" },
  { type: "shrinkage", labelKey: "elementShrinkage", section: "distribution" },
  { type: "quantity_sequence", labelKey: "elementQuantitySequence", section: "distribution" },

  // Outlet Details
  { type: "name", labelKey: "elementName", section: "outletDetails" },
  { type: "description", labelKey: "elementDescription", section: "outletDetails" },
  { type: "address", labelKey: "elementAddress", section: "outletDetails" },
  { type: "zip", labelKey: "elementZip", section: "outletDetails" },
  { type: "city", labelKey: "elementCity", section: "outletDetails" },
  { type: "state", labelKey: "elementState", section: "outletDetails" },
  { type: "country", labelKey: "elementCountry", section: "outletDetails" },
  { type: "start_date", labelKey: "elementStartDate", section: "outletDetails" },
  { type: "end_date", labelKey: "elementEndDate", section: "outletDetails" },

  // Outlet Instructions
  { type: "weekday", labelKey: "elementWeekday", section: "outletInstructions" },
  { type: "open", labelKey: "elementOpen", section: "outletInstructions" },
  { type: "cost", labelKey: "elementCost", section: "outletInstructions" },
  { type: "profit", labelKey: "elementProfit", section: "outletInstructions" },
  { type: "revenue", labelKey: "elementRevenue", section: "outletInstructions" },
  { type: "fixed_quantity", labelKey: "elementFixedQuantity", section: "outletInstructions" },
  { type: "minimum_quantity", labelKey: "elementMinimumQuantity", section: "outletInstructions" },
  { type: "maximum_quantity", labelKey: "elementMaximumQuantity", section: "outletInstructions" },
  ...buildWeekdayFields(),
]

const SECTION_ORDER: Section[] = [
  "miscellaneous", "distribution", "outletDetails", "outletInstructions", "userDefined",
]

const SECTION_LABEL_KEY: Record<Section, string> = {
  miscellaneous: "sectionMiscellaneous",
  distribution: "sectionDistribution",
  outletDetails: "sectionOutletDetails",
  outletInstructions: "sectionOutletInstructions",
  userDefined: "sectionUserDefined",
}

// ─── Config field visibility per element type ────────────────────────────────

type ConfigField = "allow_empty" | "maximum_value" | "date_format" | "add_subtract"
  | "empty_is_zero" | "allow_positive" | "allow_negative" | "value_type"

function configFieldsForType(type: string): ConfigField[] {
  if (type === "unused") return []
  if (type === "account_id" || type === "zip") return ["value_type", "allow_empty"]
  if (type === "date" || type === "start_date" || type === "end_date") return ["date_format", "allow_empty"]
  if (type === "quantity_adjustment") return ["allow_empty", "add_subtract", "maximum_value"]
  if (type === "return") {
    return ["allow_empty", "empty_is_zero", "allow_positive", "allow_negative", "maximum_value"]
  }
  if (
    ["quantity", "sold_net", "sold_scan", "shrinkage", "quantity_sequence",
     "open", "cost", "profit", "revenue", "fixed_quantity", "minimum_quantity", "maximum_quantity",
     "weekday_open", "weekday_fixed", "weekday_minimum", "weekday"].includes(type)
  ) return ["allow_empty", "maximum_value"]
  // outlet details text fields
  return ["allow_empty"]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFieldInUse(field: AvailableField, elements: ImportTemplateElementResponse[]): boolean {
  if (field.type === "unused") return false
  return elements.some(
    (e) =>
      e.type === field.type &&
      (field.weekdayStart === undefined || e.weekday_start === field.weekdayStart)
  )
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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (c: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

// ─── localStorage helpers ────────────────────────────────────────────────────

const IT_PREFIX = "gorm:importTemplates:"
function loadItJson<T>(cid: string, k: string, fb: T): T { if (typeof window === "undefined") return fb; try { const r = localStorage.getItem(`${IT_PREFIX}${cid}:${k}`); return r ? JSON.parse(r) : fb } catch { return fb } }
function saveItJson(cid: string, k: string, v: unknown) { if (typeof window !== "undefined") localStorage.setItem(`${IT_PREFIX}${cid}:${k}`, JSON.stringify(v)) }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportTemplatesPage() {
  const t = useTranslations("importTemplates")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()
  const cid = activeCustomer?.id ?? ""

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadItJson<string[]>(cid, "checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadItJson<string[]>(cid, "starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state (persisted)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(() => loadItJson<string | null>(cid, "selectedTemplate", null))
  const [selected, setSelected] = useState<ImportTemplateResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadItJson<string>(cid, "activeTab", "overall"))
  const [detailMaximized, setDetailMaximized] = useState(() => loadItJson<boolean>(cid, "detailMaximized", false))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Draft state for Overall tab
  const [draft, setDraft] = useState<ImportTemplateUpdate>({})

  // ── Import Fields divider
  const [leftWidthPct, setLeftWidthPct] = useState<number>(() => loadItJson<number>(cid, "leftWidthPct", 50))
  const fieldsContainerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // ── User-defined key input
  const [udfKey, setUdfKey] = useState("")

  // ── Create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newSeparator, setNewSeparator] = useState(",")

  // ── Delete dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Clone dialog
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneName, setCloneName] = useState("")

  // ── Element config / constraint dialogs
  const [configElement, setConfigElement] = useState<ImportTemplateElementResponse | null>(null)
  const [constrainElement, setConstrainElement] = useState<ImportTemplateElementResponse | null>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["import-templates", activeCustomer?.id],
    queryFn: () => importTemplatesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  // ── Persist state to localStorage ──────────────────────────────────────────
  useEffect(() => { if (cid) saveItJson(cid, "checked", [...selectedIds]) }, [cid, selectedIds])
  useEffect(() => { if (cid) saveItJson(cid, "starred", [...starredIds]) }, [cid, starredIds])
  useEffect(() => { if (cid) saveItJson(cid, "activeTab", activeTab) }, [cid, activeTab])
  useEffect(() => { if (cid) saveItJson(cid, "selectedTemplate", selected?.id ?? null) }, [cid, selected?.id])
  useEffect(() => { if (cid) saveItJson(cid, "leftWidthPct", leftWidthPct) }, [cid, leftWidthPct])
  useEffect(() => { if (cid) saveItJson(cid, "detailMaximized", detailMaximized) }, [cid, detailMaximized])

  useEffect(() => {
    if (!templates.length || selected) return
    if (selectedTemplateId) { const f = templates.find((t) => t.id === selectedTemplateId); if (f) setSelected(f) }
  }, [templates.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setSelectedIds(new Set(loadItJson<string[]>(cid, "checked", [])))
      setStarredIds(new Set(loadItJson<string[]>(cid, "starred", [])))
      setSelectedTemplateId(loadItJson<string | null>(cid, "selectedTemplate", null))
      setSelected(null)
      setActiveTab(loadItJson<string>(cid, "activeTab", "overall"))
      setLeftWidthPct(loadItJson<number>(cid, "leftWidthPct", 50))
      setDetailMaximized(loadItJson<boolean>(cid, "detailMaximized", false))
    }
    prevCidRef.current = cid
  }, [cid])

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: importTemplatesApi.create,
    onSuccess: (newTemplate) => {
      queryClient.invalidateQueries({ queryKey: ["import-templates"] })
      setCreateOpen(false)
      setNewName("")
      setNewDescription("")
      setNewSeparator(",")
      toast.success(t("toastCreated"))
      setSelected(newTemplate)
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ImportTemplateUpdate }) =>
      importTemplatesApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["import-templates"] })
      setSelected(updated)
      setDraft({})
      toast.success(t("toastUpdated"))
    },
    onError: () => toast.error(t("toastUpdateError")),
  })

  const deleteMutation = useMutation({
    mutationFn: importTemplatesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-templates"] })
      toast.success(t("toastDeleted"))
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  const cloneMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => importTemplatesApi.clone(id, name),
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ["import-templates"] })
      toast.success(t("toastCloned"))
      setCloneOpen(false)
      setCloneName("")
      setSelected(cloned)
    },
    onError: () => toast.error(t("toastCloneError")),
  })

  const addElementMutation = useMutation({
    mutationFn: ({ templateId, data }: { templateId: string; data: ImportTemplateElementCreate }) =>
      importTemplatesApi.addElement(templateId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-templates"] })
      toast.success(t("toastElementAdded"))
    },
  })

  const updateElementMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ImportTemplateElementUpdate }) =>
      importTemplatesApi.updateElement(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-templates"] })
      toast.success(t("toastElementUpdated"))
    },
  })

  const removeElementMutation = useMutation({
    mutationFn: importTemplatesApi.removeElement,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-templates"] })
      toast.success(t("toastElementRemoved"))
    },
  })

  // ── Keep selected in sync with fetched data
  useEffect(() => {
    if (selected) {
      const updated = templates.find((tpl) => tpl.id === selected.id)
      if (updated) setSelected(updated)
      else setSelected(null)
    }
  }, [templates]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep open config/constrain dialogs in sync with refreshed data
  useEffect(() => {
    if (configElement && selected) {
      const refreshed = selected.elements.find((e) => e.id === configElement.id)
      if (refreshed) setConfigElement(refreshed)
    }
    if (constrainElement && selected) {
      const refreshed = selected.elements.find((e) => e.id === constrainElement.id)
      if (refreshed) setConstrainElement(refreshed)
    }
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtering & sorting ────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = templates
    if (showOnlySelected) list = list.filter((tpl) => selectedIds.has(tpl.id))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((tpl) =>
        tpl.name.toLowerCase().includes(q) ||
        (tpl.description ?? "").toLowerCase().includes(q)
      )
    }
    const dir = sortDir === "asc" ? 1 : -1
    list = [...list].sort((a, b) => {
      if (sortField === "starred") {
        return ((starredIds.has(a.id) ? 1 : 0) - (starredIds.has(b.id) ? 1 : 0)) * dir
      }
      if (sortField === "separator") return a.separator.localeCompare(b.separator) * dir
      return a.name.localeCompare(b.name) * dir
    })
    return list
  }, [templates, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
  const paginationPages = buildPaginationPages(safePage, totalPages)

  const allPageSelected = pageItems.length > 0 && pageItems.every((tpl) => selectedIds.has(tpl.id))
  const somePageSelected = pageItems.some((tpl) => selectedIds.has(tpl.id))

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  function handleHeaderCheckbox(checked: boolean | "indeterminate") {
    if (checked === true) setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((tpl) => n.add(tpl.id)); return n })
    else setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((tpl) => n.delete(tpl.id)); return n })
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRowClick(tpl: ImportTemplateResponse) {
    setSelected(tpl)
    setDraft({})
    setActiveTab("overall")
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    return (
      <button onClick={() => handleSort(field)} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors cursor-pointer">
        {label}
        {sortField === field ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    )
  }

  // ── Tab indicator ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tabsListRef.current) return
    const active = tabsListRef.current.querySelector<HTMLElement>("[data-state=active]")
    if (active) setIndicatorStyle({ left: active.offsetLeft, width: active.offsetWidth })
  }, [activeTab])

  // ── Detail draft helpers ───────────────────────────────────────────────────

  const draftDirty = Object.keys(draft).length > 0

  function handleSaveDraft() {
    if (!selected || !draftDirty) return
    updateMutation.mutate({ id: selected.id, data: draft })
  }

  // ── Delete from detail pane
  function handleDeleteSingle() {
    if (!selected) return
    deleteMutation.mutate(selected.id, {
      onSuccess: () => { setSelected(null); setDeleteDialogOpen(false); setDeleteUnderstood(false); setDeleteConfirmText("") },
    })
  }

  // ── Bulk delete
  function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    Promise.all(ids.map((id) => deleteMutation.mutateAsync(id)))
      .then(() => {
        setSelectedIds(new Set())
        setBulkDeleteDialogOpen(false)
        setBulkDeleteUnderstood(false)
        setBulkDeleteConfirmText("")
        if (selected && ids.includes(selected.id)) setSelected(null)
      })
  }

  // ── Clone
  function handleOpenClone() {
    if (!selected) return
    setCloneName(`${selected.name} (copy)`)
    setCloneOpen(true)
  }

  function handleConfirmClone() {
    if (!selected || !cloneName.trim()) return
    cloneMutation.mutate({ id: selected.id, name: cloneName.trim() })
  }

  // ── Add element from palette ───────────────────────────────────────────────

  function handleAddField(field: AvailableField) {
    if (!selected) return
    const nextIndex = selected.elements.length
    addElementMutation.mutate({
      templateId: selected.id,
      data: {
        name: t(field.labelKey as Parameters<typeof t>[0]),
        type: field.type,
        element_index: nextIndex,
        ...(field.weekdayStart !== undefined ? { weekday_start: field.weekdayStart } : {}),
      },
    })
  }

  function handleAddUserDefined() {
    if (!selected || !udfKey.trim()) return
    const key = udfKey.trim()
    addElementMutation.mutate({
      templateId: selected.id,
      data: {
        name: key,
        description: key,
        type: "outlet_info",
        element_index: selected.elements.length,
      },
    })
    setUdfKey("")
  }

  function handleRemoveElement(elementId: string) {
    removeElementMutation.mutate(elementId)
  }

  // ── Divider drag ───────────────────────────────────────────────────────────

  const onDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
  }, [])

  const onDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !fieldsContainerRef.current) return
    const rect = fieldsContainerRef.current.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    setLeftWidthPct(Math.max(25, Math.min(75, pct)))
  }, [isDragging])

  const onDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className={cn("flex flex-col shrink-0", detailMaximized && "hidden")}>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 shrink-0 bg-background">
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
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
              <p className="text-sm">{t("noTemplates")}</p>
              <p className="text-xs opacity-60">{t("noTemplatesHint")}</p>
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
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(templates.map((tpl) => tpl.id)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedIds(new Set(templates.filter((tpl) => starredIds.has(tpl.id)).map((tpl) => tpl.id)))}
                          >
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="separator" label={t("colSeparator")} /></TableHead>
                  <TableHead className="text-center">{t("colElements")}</TableHead>
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
                {pageItems.map((tpl) => (
                  <TableRow
                    key={tpl.id}
                    data-state={selected?.id === tpl.id ? "selected" : undefined}
                    onClick={() => handleRowClick(tpl)}
                    onContextMenu={(e) => { e.preventDefault(); handleStar(tpl.id) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(tpl.id)}
                        onCheckedChange={(c) =>
                          setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(tpl.id) : n.delete(tpl.id); return n })
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{tpl.name}</TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)] font-mono">{tpl.separator === "," ? "comma" : tpl.separator === "\t" ? "tab" : tpl.separator === ";" ? "semicolon" : tpl.separator}</TableCell>
                    <TableCell className="text-center text-sm text-[var(--muted-foreground)]">{tpl.elements.length}</TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStar(tpl.id)}
                        className="hover:text-amber-400 transition-colors cursor-pointer"
                        aria-label="Toggle star"
                      >
                        <Star className={cn("h-4 w-4", starredIds.has(tpl.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
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
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("showing", {
                  from: (safePage - 1) * ITEMS_PER_PAGE + 1,
                  to: Math.min(safePage * ITEMS_PER_PAGE, filtered.length),
                  total: filtered.length,
                })}
              </span>
              {totalPages > 1 && (
                <Pagination className="w-auto mx-0">
                  <PaginationContent className="gap-0.5">
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                        className={cn("h-7 text-xs", safePage === 1 && "pointer-events-none opacity-50")}
                      />
                    </PaginationItem>
                    {paginationPages.map((p, i) =>
                      p === "ellipsis" ? (
                        <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            onClick={() => setCurrentPage(p)}
                            isActive={p === safePage}
                            className="h-7 w-7 text-xs"
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                        className={cn("h-7 text-xs", safePage === totalPages && "pointer-events-none opacity-50")}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("selectedCount", { selected: selectedIds.size, total: filtered.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 cursor-pointer"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  title={showOnlySelected ? t("showAll") : t("showSelected")}
                >
                  <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive cursor-pointer"
                  onClick={() => setBulkDeleteDialogOpen(true)}
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
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {!detailMaximized && <hr className="my-8" />}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 gap-0">
            <div className="relative w-full shrink-0">
              <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                <TabsTrigger value="overall" className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer">
                  {t("tabOverall")}
                </TabsTrigger>
                <TabsTrigger value="fields" className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer">
                  {t("tabImportFields")}
                </TabsTrigger>
                <TabsTrigger value="verification" className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer">
                  {t("tabVerificationRules")}
                </TabsTrigger>
                <TabsTrigger value="actions" className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer">
                  {t("tabActions")}
                </TabsTrigger>
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

            {/* ── Overall tab ── */}
            <TabsContent value="overall" className="flex-1 overflow-y-auto mt-0">
              <div className="space-y-6 max-w-2xl mt-6 px-4">
              <FieldRow label={t("fieldId")}>
                <div className="relative">
                  <Input
                    value={selected.id}
                    readOnly
                    className="pr-9 opacity-50 cursor-default select-all font-mono text-xs"
                  />
                  <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                    <CopyIcon
                      size={16}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        navigator.clipboard.writeText(selected.id)
                        toast.success(t("toastCopied"))
                      }}
                    />
                  </AnimateIcon>
                </div>
              </FieldRow>
              <FieldRow label={t("fieldName")}>
                <Input
                  value={draft.name ?? selected.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className="h-9 text-sm"
                />
              </FieldRow>
              <FieldRow label={t("fieldDescription")}>
                <Textarea
                  value={draft.description ?? selected.description ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || null }))}
                  className="text-sm min-h-[60px]"
                />
              </FieldRow>
              <FieldRow label={t("fieldHeaderLines")}>
                <Input
                  type="number"
                  min={0}
                  value={draft.header_lines ?? selected.header_lines}
                  onChange={(e) => setDraft((d) => ({ ...d, header_lines: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="h-9 text-sm w-24"
                />
              </FieldRow>
              <FieldRow label={t("fieldFooterLines")}>
                <Input
                  type="number"
                  min={0}
                  value={draft.footer_lines ?? selected.footer_lines}
                  onChange={(e) => setDraft((d) => ({ ...d, footer_lines: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="h-9 text-sm w-24"
                />
              </FieldRow>
              <FieldRow label={t("fieldSeparator")}>
                <Input
                  value={draft.separator ?? selected.separator}
                  onChange={(e) => setDraft((d) => ({ ...d, separator: e.target.value }))}
                  className="h-9 text-sm w-24 font-mono"
                />
              </FieldRow>
              <SwitchRow
                label={t("fieldMoveFile")}
                checked={draft.move_file ?? selected.move_file}
                onCheckedChange={(c) => setDraft((d) => ({ ...d, move_file: c }))}
              />
              <SwitchRow
                label={t("fieldResetProductionGroup")}
                checked={draft.reset_production_group ?? selected.reset_production_group}
                onCheckedChange={(c) => setDraft((d) => ({ ...d, reset_production_group: c }))}
              />
              <SwitchRow
                label={t("fieldAddToProductionGroup")}
                checked={draft.add_to_production_group ?? selected.add_to_production_group}
                onCheckedChange={(c) => setDraft((d) => ({ ...d, add_to_production_group: c }))}
              />

              </div>
            </TabsContent>

            {/* ── Import Fields tab ── */}
            <TabsContent value="fields" className="flex-1 overflow-hidden mt-0">
              <div ref={fieldsContainerRef} className="flex h-full w-full relative">
                {/* Left: selected fields */}
                <div
                  className="overflow-y-auto p-4 border-r border-[var(--border)]"
                  style={{ width: `${leftWidthPct}%` }}
                >
                  <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
                    {t("selectedFields")}
                  </h3>
                  {selected.elements.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 gap-2 text-[var(--muted-foreground)]">
                      <p className="text-sm">{t("noElements")}</p>
                      <p className="text-xs opacity-60">{t("noElementsHint")}</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {selected.elements.map((elem, idx) => (
                        <div
                          key={elem.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--card)] text-sm group"
                        >
                          <span className="text-xs text-[var(--muted-foreground)] w-6 tabular-nums shrink-0">{idx + 1}</span>
                          <span className="flex-1 truncate">{elem.name}</span>
                          <button
                            onClick={() => setConfigElement(elem)}
                            className="text-[var(--muted-foreground)] hover:text-foreground transition-colors cursor-pointer"
                            aria-label="Configure"
                            title="Configure"
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setConstrainElement(elem)}
                            className="text-[var(--muted-foreground)] hover:text-foreground transition-colors cursor-pointer"
                            aria-label="Constrain"
                            title="Constrain"
                          >
                            <ListFilter className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveElement(elem.id)}
                            className="text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors cursor-pointer"
                            aria-label="Remove"
                            title="Remove"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div
                  onPointerDown={onDividerPointerDown}
                  onPointerMove={onDividerPointerMove}
                  onPointerUp={onDividerPointerUp}
                  className={cn(
                    "w-1.5 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)] transition-colors relative group shrink-0",
                    isDragging && "bg-[var(--accent)]"
                  )}
                >
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <GripVertical className="h-4 w-4 text-[var(--muted-foreground)]" />
                  </div>
                </div>

                {/* Right: available fields palette */}
                <div
                  className="overflow-y-auto p-4 flex-1"
                >
                  <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
                    {t("availableFields")}
                  </h3>
                  <div className="space-y-4">
                    {SECTION_ORDER.map((section) => {
                      const fields = AVAILABLE_FIELDS.filter((f) => f.section === section)
                      if (section === "userDefined") {
                        return (
                          <div key={section}>
                            <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
                              {t(SECTION_LABEL_KEY[section] as Parameters<typeof t>[0])}
                            </h4>
                            <div className="rounded-md border border-[var(--border)] p-3 space-y-2">
                              <p className="text-xs text-[var(--muted-foreground)]">{t("userDefinedTitle")}</p>
                              <label className="text-xs font-medium text-[var(--muted-foreground)] block">
                                {t("userDefinedKeyLabel")}
                              </label>
                              <Input
                                value={udfKey}
                                onChange={(e) => setUdfKey(e.target.value)}
                                placeholder={t("userDefinedKeyPlaceholder")}
                                className="h-8 text-sm"
                                            />
                              {(() => {
                                const trimmed = udfKey.trim()
                                const dup = !!trimmed && selected.elements.some(
                                  (e) => e.type === "outlet_info" && e.name === trimmed
                                )
                                return (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleAddUserDefined}
                                    disabled={!trimmed || dup}
                                    className="w-full h-7 text-xs gap-1.5"
                                  >
                                    <Plus className="h-3 w-3" />
                                    {dup ? t("userDefinedDuplicate") : t("userDefinedAddButton")}
                                  </Button>
                                )
                              })()}
                            </div>
                          </div>
                        )
                      }
                      if (fields.length === 0) return null
                      return (
                        <div key={section}>
                          <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
                            {t(SECTION_LABEL_KEY[section] as Parameters<typeof t>[0])}
                          </h4>
                          <div className="grid grid-cols-2 gap-1">
                            {fields.map((field) => {
                              const inUse = isFieldInUse(field, selected.elements)
                              return (
                                <button
                                  key={`${field.type}-${field.weekdayStart ?? ""}-${field.labelKey}`}
                                  onClick={() => handleAddField(field)}
                                  disabled={inUse}
                                  className={cn(
                                    "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors text-left border",
                                    inUse
                                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 cursor-not-allowed"
                                      : "border-[var(--border)] hover:bg-[var(--accent)] cursor-pointer"
                                  )}
                                >
                                  <Plus className={cn("h-3 w-3 shrink-0", inUse ? "opacity-0" : "text-[var(--muted-foreground)]")} />
                                  <span className="truncate">{t(field.labelKey as Parameters<typeof t>[0])}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Verification Rules tab ── */}
            <TabsContent value="verification" className="flex-1 overflow-y-auto p-4 mt-0">
              <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--muted-foreground)]">
                <p className="text-sm font-medium">{t("verificationPlaceholder")}</p>
                <p className="text-xs opacity-60 max-w-md text-center">{t("verificationPlaceholderHint")}</p>
              </div>
            </TabsContent>

            {/* ── Actions tab ── */}
            <TabsContent value="actions" className="flex-1 overflow-y-auto p-4 mt-0 space-y-4">
              <div className="rounded-lg border border-[var(--border)] p-4">
                <h3 className="text-sm font-semibold mb-1">{t("cloneAction")}</h3>
                <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("cloneActionDescription")}</p>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleOpenClone}
                  className="gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t("cloneActionButton")}
                </Button>
              </div>

              <div className="rounded-lg border border-[var(--destructive)]/20 p-4">
                <h3 className="text-sm font-semibold text-[var(--destructive)] mb-1">{t("deleteAction")}</h3>
                <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("deleteActionDescription")}</p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  {t("deleteActionButton")}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {draftDirty && (
            <div className="shrink-0 border-t flex items-center justify-end gap-2 px-4 py-2 bg-background">
              <Button variant="secondary" size="sm" onClick={() => setDraft({})}>
                {t("cancelButton")}
              </Button>
              <Button size="sm" onClick={handleSaveDraft} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("saving") : t("saveChanges")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldName")}</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldDescription")}</label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="mt-1 min-h-[60px]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldSeparator")}</label>
              <Input
                value={newSeparator}
                onChange={(e) => setNewSeparator(e.target.value)}
                className="mt-1 w-24 font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("cancelButton")}</Button>
            <Button
              onClick={() => createMutation.mutate({
                customer_id: activeCustomer!.id,
                name: newName,
                description: newDescription || null,
                separator: newSeparator,
              })}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {t("createButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Clone dialog ── */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cloneTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("cloneNameLabel")}</label>
              <Input
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                className="mt-1"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneOpen(false)}>{t("cancelButton")}</Button>
            <Button onClick={handleConfirmClone} disabled={!cloneName.trim() || cloneMutation.isPending}>
              {t("cloneButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Single delete dialog ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) { setDeleteUnderstood(false); setDeleteConfirmText("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDescription", { count: 1 })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(c) => setDeleteUnderstood(!!c)} />
              <label className="text-sm">{t("deleteUnderstood")}</label>
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">{t("deleteConfirmLabel")}</label>
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>{t("cancelButton")}</Button>
            <Button
              variant="destructive"
              disabled={!deleteUnderstood || deleteConfirmText.toLowerCase() !== "delete"}
              onClick={handleDeleteSingle}
            >
              {t("deleteButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete dialog ── */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={(open) => { setBulkDeleteDialogOpen(open); if (!open) { setBulkDeleteUnderstood(false); setBulkDeleteConfirmText("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDescription", { count: selectedIds.size })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={bulkDeleteUnderstood} onCheckedChange={(c) => setBulkDeleteUnderstood(!!c)} />
              <label className="text-sm">{t("deleteUnderstood")}</label>
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">{t("deleteConfirmLabel")}</label>
              <Input value={bulkDeleteConfirmText} onChange={(e) => setBulkDeleteConfirmText(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteDialogOpen(false)}>{t("cancelButton")}</Button>
            <Button
              variant="destructive"
              disabled={!bulkDeleteUnderstood || bulkDeleteConfirmText.toLowerCase() !== "delete"}
              onClick={handleBulkDelete}
            >
              {t("deleteButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Element config dialog ── */}
      <ElementConfigDialog
        element={configElement}
        onClose={() => setConfigElement(null)}
        onSave={(data) => {
          if (!configElement) return
          updateElementMutation.mutate(
            { id: configElement.id, data },
            { onSuccess: () => setConfigElement(null) }
          )
        }}
        isSaving={updateElementMutation.isPending}
      />

      {/* ── Element constraint dialog ── */}
      <ElementConstraintDialog
        element={constrainElement}
        onClose={() => setConstrainElement(null)}
        onSave={(data) => {
          if (!constrainElement) return
          updateElementMutation.mutate(
            { id: constrainElement.id, data },
            { onSuccess: () => setConstrainElement(null) }
          )
        }}
        isSaving={updateElementMutation.isPending}
      />
    </div>
  )
}

// ─── ElementConfigDialog ─────────────────────────────────────────────────────

function ElementConfigDialog({
  element,
  onClose,
  onSave,
  isSaving,
}: {
  element: ImportTemplateElementResponse | null
  onClose: () => void
  onSave: (data: ImportTemplateElementUpdate) => void
  isSaving: boolean
}) {
  const t = useTranslations("importTemplates")
  const [draft, setDraft] = useState<ImportTemplateElementUpdate>({})

  useEffect(() => {
    if (element) setDraft({})
  }, [element?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!element) return null

  const fields = configFieldsForType(element.type)

  const allowEmpty = draft.allow_empty ?? element.allow_empty
  const maxValue = draft.maximum_value ?? element.maximum_value
  const dateFormat = draft.date_format ?? element.date_format
  const emptyIsZero = draft.empty_is_zero ?? element.empty_is_zero
  const allowPositive = draft.allow_positive ?? element.allow_positive
  const allowNegative = draft.allow_negative ?? element.allow_negative
  const valueType = draft.value_type ?? element.value_type

  return (
    <Dialog open={!!element} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("configureElementTitle")}</DialogTitle>
          <DialogDescription>{element.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {fields.length === 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">No configuration available for this field.</p>
          )}
          {fields.includes("value_type") && (
            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-muted-foreground">{t("fieldType")}</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-36 justify-between">
                    {valueType === "number" ? t("typeNumber") : t("typeString")}
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setDraft((d) => ({ ...d, value_type: "string" }))}>
                    {t("typeString")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDraft((d) => ({ ...d, value_type: "number" }))}>
                    {t("typeNumber")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          {fields.includes("allow_empty") && (
            <SwitchRow
              label={t("fieldAllowEmpty")}
              checked={allowEmpty}
              onCheckedChange={(c) => setDraft((d) => ({ ...d, allow_empty: c }))}
            />
          )}
          {fields.includes("maximum_value") && (
            <FieldRow label={t("fieldMaximumValue")}>
              <Input
                type="number"
                value={maxValue}
                onChange={(e) => setDraft((d) => ({ ...d, maximum_value: parseInt(e.target.value) || 0 }))}
                className="h-9 text-sm w-32"
              />
            </FieldRow>
          )}
          {fields.includes("date_format") && (
            <FieldRow label={t("fieldDateFormat")}>
              <Input
                value={dateFormat}
                onChange={(e) => setDraft((d) => ({ ...d, date_format: e.target.value }))}
                className="h-9 text-sm w-40 font-mono"
              />
            </FieldRow>
          )}
          {fields.includes("add_subtract") && (
            <div className="flex items-center justify-between gap-4">
              <label className="text-xs font-medium text-muted-foreground">{t("fieldAddSubtract")}</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-36 justify-between">
                    {allowNegative ? t("addSubtractSubtract") : t("addSubtractAdd")}
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setDraft((d) => ({ ...d, allow_negative: false }))}>
                    {t("addSubtractAdd")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDraft((d) => ({ ...d, allow_negative: true }))}>
                    {t("addSubtractSubtract")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          {fields.includes("empty_is_zero") && (
            <SwitchRow
              label={t("fieldEmptyIsZero")}
              checked={emptyIsZero}
              onCheckedChange={(c) => setDraft((d) => ({ ...d, empty_is_zero: c }))}
            />
          )}
          {fields.includes("allow_positive") && (
            <SwitchRow
              label={t("fieldAllowPositive")}
              checked={allowPositive}
              onCheckedChange={(c) => setDraft((d) => ({ ...d, allow_positive: c }))}
            />
          )}
          {fields.includes("allow_negative") && !fields.includes("add_subtract") && (
            <SwitchRow
              label={t("fieldAllowNegative")}
              checked={allowNegative}
              onCheckedChange={(c) => setDraft((d) => ({ ...d, allow_negative: c }))}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancelButton")}</Button>
          <Button onClick={() => onSave(draft)} disabled={isSaving || Object.keys(draft).length === 0}>
            {t("okButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── ElementConstraintDialog ─────────────────────────────────────────────────

function ElementConstraintDialog({
  element,
  onClose,
  onSave,
  isSaving,
}: {
  element: ImportTemplateElementResponse | null
  onClose: () => void
  onSave: (data: ImportTemplateElementUpdate) => void
  isSaving: boolean
}) {
  const t = useTranslations("importTemplates")
  const [allowed, setAllowed] = useState("")
  const [disallowed, setDisallowed] = useState("")

  useEffect(() => {
    if (element) {
      setAllowed(element.allow ?? "")
      setDisallowed(element.disallow ?? "")
    }
  }, [element?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!element) return null

  const dirty = allowed !== (element.allow ?? "") || disallowed !== (element.disallow ?? "")

  return (
    <Dialog open={!!element} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("constrainElementTitle")}</DialogTitle>
          <DialogDescription>{element.name}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-[var(--muted-foreground)] whitespace-pre-line">
          {t("constrainElementHint")}
        </p>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("allowedValues")}</label>
            <Textarea
              value={allowed}
              onChange={(e) => setAllowed(e.target.value)}
              className="mt-1 min-h-[100px] font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("disallowedValues")}</label>
            <Textarea
              value={disallowed}
              onChange={(e) => setDisallowed(e.target.value)}
              className="mt-1 min-h-[100px] font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancelButton")}</Button>
          <Button
            onClick={() => onSave({
              allow: allowed.trim() ? allowed.trim() : null,
              disallow: disallowed.trim() ? disallowed.trim() : null,
            })}
            disabled={isSaving || !dirty}
          >
            {t("okButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
