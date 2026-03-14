"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp, Plus, X, Info,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
  ChartLegend, type ChartConfig,
} from "@/components/ui/chart"
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis,
} from "recharts"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  outletsApi, outletGroupsApi, customerConfigurationApi, salesApi,
  type OutletResponse, type OutletUpdate, type DeliveryAnalyticsWeekday,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "ext_id" | "starred"

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

function HeaderInfo({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3 w-3 text-[var(--muted-foreground)] cursor-help shrink-0 inline-block ml-0.5 align-middle" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4">
      <label className="text-xs font-medium text-[var(--muted-foreground)] pt-2.5">{label}</label>
      <div>{children}</div>
    </div>
  )
}

const WEEKDAY_NAMES: Record<number, string> = {
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday",
  5: "Friday", 6: "Saturday", 7: "Sunday",
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—"
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function DeliveryAnalyticsWeekdayRows({
  wd,
  labels,
}: {
  wd: DeliveryAnalyticsWeekday
  labels: [string, string, string]
}) {
  const histories: (number | null)[][] = [wd.delivered_history, wd.sold_history, wd.returned_history]

  return (
    <>
      {([0, 1, 2] as const).map((rowIdx) => {
        const hist = histories[rowIdx] ?? []
        // pad to 8
        const cells = Array.from({ length: 8 }, (_, i) => hist[i] ?? null)

        return (
          <tr
            key={rowIdx}
            className={rowIdx === 2 ? "border-b border-[var(--border)]" : ""}
          >
            {rowIdx === 0 && (
              <td
                rowSpan={3}
                className="py-1.5 px-2 font-medium align-middle border-r border-[var(--border)] whitespace-nowrap"
              >
                {WEEKDAY_NAMES[wd.weekday]}
              </td>
            )}
            <td className="py-0.5 px-2 text-[var(--muted-foreground)] whitespace-nowrap">
              {labels[rowIdx]}
            </td>
            {cells.map((val, i) => (
              <td
                key={i}
                className={cn(
                  "py-0.5 px-1.5 text-center tabular-nums",
                  rowIdx === 1 && i < 4 && val != null && "text-red-500",
                )}
              >
                {val ?? "—"}
              </td>
            ))}
            {rowIdx === 0 && (
              <>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle border-l border-[var(--border)]">
                  {fmtNum(wd.raw_prediction)}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle" title={wd.pad_effect_pct != null ? `${wd.pad_effect_pct.toFixed(1)}%` : undefined}>
                  {fmtNum(wd.pad_effect)}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle">
                  {fmtNum(wd.weekday_correction)}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle">
                  {fmtNum(wd.lower_bound)}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle">
                  {fmtNum(wd.upper_bound)}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums font-medium align-middle">
                  {fmtNum(wd.predicted)}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle">
                  {fmtNum(wd.economic_optimal)}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums font-medium text-red-500 align-middle">
                  {fmtNum(wd.delivered)}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle whitespace-nowrap">
                  {wd.cost_per_unit != null && wd.profit_per_unit != null
                    ? `${wd.cost_per_unit.toFixed(2)}/${wd.profit_per_unit.toFixed(2)} (1:${(wd.profit_per_unit / wd.cost_per_unit).toFixed(2)})`
                    : wd.cost_per_unit != null
                      ? `${wd.cost_per_unit.toFixed(2)}/—`
                      : wd.profit_per_unit != null
                        ? `—/${wd.profit_per_unit.toFixed(2)}`
                        : "—"}
                </td>
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle whitespace-nowrap">
                  {[
                    wd.fixed    != null ? `=${fmtNum(wd.fixed)}`         : null,
                    wd.minimum  != null ? `>${fmtNum(wd.minimum)}`       : null,
                    wd.maximum  != null ? `<${fmtNum(wd.maximum)}`       : null,
                    wd.add      != null ? `+${fmtNum(wd.add)}`           : null,
                    wd.add_pct  != null ? `+%${fmtNum(wd.add_pct)}`      : null,
                  ].filter(Boolean).join(" ") || "—"}
                </td>
              </>
            )}
          </tr>
        )
      })}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OutletsListPage() {
  const t = useTranslations("outlets.list")
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
  const [groupFilter, setGroupFilter] = useState<"active" | "all">("active")

  // ── Detail pane state
  const [selected, setSelected] = useState<OutletResponse | null>(null)
  const [activeTab, setActiveTab] = useState("tab1")
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Draft state for editable fields
  const [draft, setDraft] = useState<OutletUpdate>({})

  // ── Statistics tab state
  const [statsWeeks, setStatsWeeks] = useState(8)
  const [statsWeekday, setStatsWeekday] = useState<string>("all")
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  function toggleSeries(key: string) {
    setHiddenSeries((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  // ── Info tab state
  const [addInfoMode, setAddInfoMode] = useState(false)
  const [newInfoKey, setNewInfoKey] = useState("")
  const [newInfoValue, setNewInfoValue] = useState("")
  const [deleteInfoId, setDeleteInfoId] = useState<string | null>(null)

  // ── Delete dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: outlets = [], isLoading } = useQuery({
    queryKey: ["outlets", activeCustomer?.id],
    queryFn: () => outletsApi.list(activeCustomer!.id, { limit: 5000 }),
    enabled: !!activeCustomer,
    retry: false,
  })

  const { data: customerConfig } = useQuery({
    queryKey: ["customer-config", activeCustomer?.id],
    queryFn: () => customerConfigurationApi.get(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  const groupId = customerConfig?.group_id ?? null

  const { data: groupOutlets = [] } = useQuery({
    queryKey: ["outlet-group-outlets", groupId],
    queryFn: () => outletGroupsApi.getOutlets(groupId!),
    enabled: !!groupId,
    retry: false,
  })

  const groupOutletIds = useMemo(() => new Set(groupOutlets.map((o) => o.id)), [groupOutlets])

  // ── Sales data for statistics tab ─────────────────────────────────────────

  const statsEndDate = useMemo(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  }, [])

  const statsStartDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - statsWeeks * 7)
    return d.toISOString().slice(0, 10)
  }, [statsWeeks])

  const { data: salesData = [], isLoading: salesLoading } = useQuery({
    queryKey: ["outlet-sales", selected?.id, statsStartDate, statsEndDate],
    queryFn: () => salesApi.query({ outlet_id: selected!.id, start_date: statsStartDate, end_date: statsEndDate, limit: 1000 }),
    enabled: !!selected && activeTab === "tab5",
    retry: false,
  })

  const { data: deliveryAnalytics, isLoading: deliveryAnalyticsLoading } = useQuery({
    queryKey: ["outlet-delivery-analytics", selected?.id],
    queryFn: () => outletsApi.getDeliveryAnalytics(selected!.id),
    enabled: !!selected && activeTab === "tab6",
    retry: false,
  })

  // Filter by weekday and shape for chart
  const WEEKDAY_JS: Record<string, number[]> = {
    sun: [0], mon: [1], tue: [2], wed: [3], thu: [4], fri: [5], sat: [6],
    "mon-fri": [1, 2, 3, 4, 5],
    "mon-sat": [1, 2, 3, 4, 5, 6],
    all: [0, 1, 2, 3, 4, 5, 6],
  }

  const chartData = useMemo(() => {
    const allowed = WEEKDAY_JS[statsWeekday] ?? WEEKDAY_JS.all
    return salesData
      .filter((s) => allowed.includes(new Date(s.date + "T00:00:00").getDay()))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({
        date: s.date,
        draw: s.delivered ?? null,
        sold: s.sold,
        returned: s.delivered != null ? s.delivered - s.sold : null,
      }))
  }, [salesData, statsWeekday]) // eslint-disable-line react-hooks/exhaustive-deps

  const WEEKDAY_LABEL: Record<string, string> = {
    all: "All Weekdays", "mon-fri": "Monday–Friday", "mon-sat": "Monday–Saturday",
    mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
    fri: "Friday", sat: "Saturday", sun: "Sunday",
  }

  const chartConfig: ChartConfig = {
    draw:     { label: "Draw",     color: "hsl(217 91% 60%)" },
    sold:     { label: "Sold",     color: "hsl(0 72% 51%)" },
    returned: { label: "Returned", color: "hsl(38 92% 50%)" },
  }

  // ── Sync selected with latest data after mutations ─────────────────────────

  useEffect(() => {
    if (!selected || outlets.length === 0) return
    const fresh = outlets.find((o) => o.id === selected.id)
    if (fresh) setSelected(fresh)
  }, [outlets]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync draft when selection changes ──────────────────────────────────────

  useEffect(() => {
    if (!selected) { setDraft({}); return }
    setDraft({
      ext_id: selected.ext_id,
      name: selected.name,
      description: selected.description,
      notes: selected.notes,
      address: selected.address,
      city: selected.city,
      zip: selected.zip,
      state: selected.state,
      country: selected.country,
    })
    setAddInfoMode(false)
    setNewInfoKey("")
    setNewInfoValue("")
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── isDirty ────────────────────────────────────────────────────────────────

  const isDirty = useMemo(() => {
    if (!selected) return false
    return (
      draft.ext_id !== selected.ext_id ||
      draft.name !== selected.name ||
      draft.description !== (selected.description ?? null) ||
      draft.notes !== (selected.notes ?? null) ||
      draft.address !== (selected.address ?? null) ||
      draft.city !== (selected.city ?? null) ||
      draft.zip !== (selected.zip ?? null) ||
      draft.state !== (selected.state ?? null) ||
      draft.country !== (selected.country ?? null)
    )
  }, [draft, selected])

  // ── Tab indicator ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selected])

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: OutletUpdate }) => outletsApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["outlets"] })
      setSelected(updated)
      toast.success(t("toastUpdated"))
    },
    onError: () => toast.error(t("toastUpdateError")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => outletsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["outlets"] })
      if (selected?.id === id) setSelected(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  const addInfoMutation = useMutation({
    mutationFn: ({ outletId, key, value }: { outletId: string; key: string; value: string | null }) =>
      outletsApi.addInfo(outletId, { key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlets"] })
      setAddInfoMode(false)
      setNewInfoKey("")
      setNewInfoValue("")
      toast.success(t("toastInfoAdded"))
    },
    onError: () => toast.error(t("toastInfoAddError")),
  })

  const deleteInfoMutation = useMutation({
    mutationFn: ({ outletId, infoId }: { outletId: string; infoId: string }) =>
      outletsApi.deleteInfo(outletId, infoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlets"] })
      setDeleteInfoId(null)
      toast.success(t("toastInfoDeleted"))
    },
    onError: () => toast.error(t("toastInfoDeleteError")),
  })

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? outlets.filter((o) => selectedIds.has(o.id))
      : outlets

    if (groupFilter === "active" && groupId) {
      items = items.filter((o) => groupOutletIds.has(o.id))
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.ext_id.toLowerCase().includes(q)
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name":    va = a.name;    vb = b.name;    break
        case "ext_id":  va = a.ext_id;  vb = b.ext_id;  break
        case "starred": va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [outlets, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds, groupFilter, groupId, groupOutletIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((o) => selectedIds.has(o.id))
  const somePageSelected = pageItems.some((o) => selectedIds.has(o.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((o) => n.delete(o.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((o) => n.add(o.id)); return n })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRowClick(outlet: OutletResponse) {
    setSelected(outlet)
    setActiveTab("tab1")
  }

  function handleCancelDraft() {
    if (!selected) return
    setDraft({
      ext_id: selected.ext_id,
      name: selected.name,
      description: selected.description,
      notes: selected.notes,
      address: selected.address,
      city: selected.city,
      zip: selected.zip,
      state: selected.state,
      country: selected.country,
    })
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
    const ids = [...selectedIds]
    for (const id of ids) await deleteMutation.mutateAsync(id)
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className="flex flex-col shrink-0">

        {/* Toolbar */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 shrink-0 bg-background">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 cursor-pointer">
                {groupFilter === "active" ? t("filterActive") : t("filterAll")}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => { setGroupFilter("active"); setCurrentPage(1) }}>
                {t("filterActive")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setGroupFilter("all"); setCurrentPage(1) }}>
                {t("filterAll")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              <p className="text-sm">{t("noOutlets")}</p>
              <p className="text-xs opacity-60">{t("noOutletsHint")}</p>
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
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(outlets.map((o) => o.id)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSelectedIds(new Set(outlets.filter((o) => starredIds.has(o.id)).map((o) => o.id)))}
                          >
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="ext_id" label={t("colExtId")} /></TableHead>
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
                {pageItems.map((outlet) => (
                  <TableRow
                    key={outlet.id}
                    data-state={selected?.id === outlet.id ? "selected" : undefined}
                    onClick={() => handleRowClick(outlet)}
                    onContextMenu={(e) => { e.preventDefault(); handleStar(outlet.id) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(outlet.id)}
                        onCheckedChange={(c) =>
                          setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(outlet.id) : n.delete(outlet.id); return n })
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{outlet.name}</TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)]">{outlet.ext_id}</TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStar(outlet.id)}
                        className="hover:text-amber-400 transition-colors cursor-pointer"
                        aria-label="Toggle star"
                      >
                        <Star className={cn("h-4 w-4", starredIds.has(outlet.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
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
                  variant="ghost" size="sm" className="h-7 gap-1.5 px-2 cursor-pointer"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  title={showOnlySelected ? "Show all" : "Show only selected"}
                >
                  <Focus className={cn("h-3.5 w-3.5", showOnlySelected && "text-primary")} />
                  {showOnlySelected && <span className="text-xs">Show all</span>}
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
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabLocation")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabInformation")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab5">{t("tabStatistics")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab6">{t("tabDeliveryAnalytics")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabActions")}</TabsTrigger>
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
                    <Input
                      value={selected.id}
                      readOnly
                      className="opacity-50 cursor-default select-all font-mono text-xs"
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldExtId")}>
                    <Input
                      value={draft.ext_id ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, ext_id: e.target.value }))}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldName")}>
                    <Input
                      value={draft.name ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldDescription")}>
                    <Textarea
                      value={draft.description ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || null }))}
                      rows={3}
                      className="resize-none"
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldNotes")}>
                    <Textarea
                      value={draft.notes ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value || null }))}
                      rows={3}
                      className="resize-none"
                    />
                  </FieldRow>
                </TabsContent>

                {/* ─ Location ─ */}
                <TabsContent value="tab2" className="space-y-6 max-w-2xl mt-6 px-4">
                  <FieldRow label={t("fieldAddress")}>
                    <Input
                      value={draft.address ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value || null }))}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldCity")}>
                    <Input
                      value={draft.city ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value || null }))}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldZip")}>
                    <Input
                      value={draft.zip ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, zip: e.target.value || null }))}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldState")}>
                    <Input
                      value={draft.state ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value || null }))}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldCountry")}>
                    <Input
                      value={draft.country ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value || null }))}
                    />
                  </FieldRow>
                </TabsContent>

                {/* ─ Information ─ */}
                <TabsContent value="tab3" className="max-w-2xl mt-6 px-4 space-y-4">
                  {/* Existing info items */}
                  {selected.info.filter((i) => i.active).length === 0 && !addInfoMode && (
                    <p className="text-sm text-[var(--muted-foreground)] italic">{t("infoEmptyHint")}</p>
                  )}
                  <div className="space-y-1">
                    {selected.info.filter((i) => i.active).map((info) => (
                      <div
                        key={info.id}
                        className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 group"
                      >
                        <span className="text-xs font-medium text-[var(--muted-foreground)] w-40 shrink-0 truncate">{info.key}</span>
                        <span className="text-sm flex-1 truncate">{info.value ?? "—"}</span>
                        <button
                          onClick={() => setDeleteInfoId(info.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--muted-foreground)] hover:text-destructive cursor-pointer"
                          aria-label="Remove field"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add info inline form */}
                  {addInfoMode ? (
                    <div className="rounded-md border border-border p-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldInfoKey")}</label>
                          <Input
                            value={newInfoKey}
                            onChange={(e) => setNewInfoKey(e.target.value)}
                            className="h-8 text-xs"
                            autoFocus
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldInfoValue")}</label>
                          <Input
                            value={newInfoValue}
                            onChange={(e) => setNewInfoValue(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          variant="ghost" size="sm" className="h-7 text-xs cursor-pointer"
                          onClick={() => { setAddInfoMode(false); setNewInfoKey(""); setNewInfoValue("") }}
                        >
                          {t("cancelInfoAdd")}
                        </Button>
                        <Button
                          size="sm" className="h-7 text-xs cursor-pointer"
                          disabled={!newInfoKey.trim() || addInfoMutation.isPending}
                          onClick={() => addInfoMutation.mutate({ outletId: selected.id, key: newInfoKey.trim(), value: newInfoValue.trim() || null })}
                        >
                          {t("saveInfoAdd")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline" size="sm" className="h-7 gap-1.5 text-xs cursor-pointer"
                      onClick={() => setAddInfoMode(true)}
                    >
                      <Plus className="h-3 w-3" />
                      {t("addInfoButton")}
                    </Button>
                  )}
                </TabsContent>

                {/* ─ Statistics ─ */}
                <TabsContent value="tab5" className="mt-6 px-4 space-y-4">
                  {/* Controls */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-[var(--muted-foreground)] shrink-0">{t("statsWeekday")}</label>
                      <select
                        value={statsWeekday}
                        onChange={(e) => setStatsWeekday(e.target.value)}
                        className="h-7 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
                      >
                        <option value="all">{WEEKDAY_LABEL.all}</option>
                        <option value="mon-fri">{WEEKDAY_LABEL["mon-fri"]}</option>
                        <option value="mon-sat">{WEEKDAY_LABEL["mon-sat"]}</option>
                        <option disabled>──────────</option>
                        <option value="mon">{WEEKDAY_LABEL.mon}</option>
                        <option value="tue">{WEEKDAY_LABEL.tue}</option>
                        <option value="wed">{WEEKDAY_LABEL.wed}</option>
                        <option value="thu">{WEEKDAY_LABEL.thu}</option>
                        <option value="fri">{WEEKDAY_LABEL.fri}</option>
                        <option value="sat">{WEEKDAY_LABEL.sat}</option>
                        <option value="sun">{WEEKDAY_LABEL.sun}</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-[var(--muted-foreground)] shrink-0">{t("statsWeeks")}</label>
                      <Input
                        type="number"
                        min={1}
                        max={104}
                        value={statsWeeks}
                        onChange={(e) => setStatsWeeks(Math.max(1, parseInt(e.target.value) || 8))}
                        className="h-7 w-16 text-xs"
                      />
                    </div>
                  </div>

                  {/* Chart */}
                  {salesLoading ? (
                    <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">Loading…</div>
                  ) : chartData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">{t("statsNoData")}</div>
                  ) : (
                    <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto">
                      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: string) => {
                            const d = new Date(v + "T00:00:00")
                            return `${d.getMonth() + 1}/${d.getDate()}`
                          }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          width={32}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelKey="date"
                              formatter={(value) => String(value ?? "—")}
                            />
                          }
                        />
                        <ChartLegend
                          content={() => (
                            <div className="flex items-center justify-center gap-4 pt-2">
                              {(["draw", "sold", "returned"] as const).map((key) => {
                                const hidden = hiddenSeries.has(key)
                                return (
                                  <button
                                    key={key}
                                    onClick={() => toggleSeries(key)}
                                    className="flex items-center gap-1.5 cursor-pointer select-none group"
                                  >
                                    <div
                                      className="h-2 w-4 shrink-0 rounded-[2px] transition-opacity"
                                      style={{
                                        backgroundColor: chartConfig[key].color,
                                        opacity: hidden ? 0.3 : 1,
                                      }}
                                    />
                                    <span
                                      className="text-xs text-muted-foreground transition-opacity group-hover:text-foreground"
                                      style={{
                                        textDecoration: hidden ? "line-through" : "none",
                                        opacity: hidden ? 0.5 : 1,
                                      }}
                                    >
                                      {chartConfig[key].label as string}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        />
                        <Line
                          type="monotone"
                          dataKey="draw"
                          stroke={chartConfig.draw.color}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4 }}
                          connectNulls
                          hide={hiddenSeries.has("draw")}
                        />
                        <Line
                          type="monotone"
                          dataKey="sold"
                          stroke={chartConfig.sold.color}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4 }}
                          connectNulls
                          hide={hiddenSeries.has("sold")}
                        />
                        <Line
                          type="monotone"
                          dataKey="returned"
                          stroke={chartConfig.returned.color}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4 }}
                          connectNulls
                          hide={hiddenSeries.has("returned")}
                        />
                      </LineChart>
                    </ChartContainer>
                  )}
                </TabsContent>

                {/* ─ Delivery Analytics ─ */}
                <TabsContent value="tab6" className="mt-4 px-2">
                  <TooltipProvider delayDuration={200}>
                  {deliveryAnalyticsLoading ? (
                    <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">Loading…</div>
                  ) : !deliveryAnalytics ? (
                    <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">{t("daNoData")}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)]">
                            <th className="text-left font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[80px]" rowSpan={2}></th>
                            <th className="text-left font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[56px]" rowSpan={2}></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-1 border-x border-[var(--border)]" colSpan={8}>
                              History <HeaderInfo text={t("daHistoryInfo")} />
                            </th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[64px]" rowSpan={2}>{t("daRawPred")} <HeaderInfo text={t("daRawPredInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[48px]" rowSpan={2}>{t("daPad")} <HeaderInfo text={t("daPadInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[56px]" rowSpan={2}>{t("daWkCorrect")} <HeaderInfo text={t("daWkCorrectInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[44px]" rowSpan={2}>{t("daLower")} <HeaderInfo text={t("daLowerInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[44px]" rowSpan={2}>{t("daUpper")} <HeaderInfo text={t("daUpperInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[52px]" rowSpan={2}>{t("daPredict")} <HeaderInfo text={t("daPredictInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[44px]" rowSpan={2}>{t("daEO")} <HeaderInfo text={t("daEOInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[52px]" rowSpan={2}>{t("daLatest")} <HeaderInfo text={t("daLatestInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[80px]" rowSpan={2}>{t("daCostProfit")} <HeaderInfo text={t("daCostProfitInfo")} /></th>
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[80px]" rowSpan={2}>{t("daConstraints")} <HeaderInfo text={t("daConstraintsInfo")} /></th>
                          </tr>
                          <tr className="border-b border-[var(--border)]">
                            {[1,2,3,4,5,6,7,8].map((n) => (
                              <th key={n} className="text-center font-medium text-[var(--muted-foreground)] py-1 px-1.5 border-x first:border-l border-[var(--border)] min-w-[28px]">{n}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {deliveryAnalytics.weekdays.map((wd) => (
                            <DeliveryAnalyticsWeekdayRows key={wd.weekday} wd={wd} labels={[t("daDraw"), t("daSold"), t("daReturned")]} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  </TooltipProvider>
                </TabsContent>

                {/* ─ Actions ─ */}
                <TabsContent value="tab4" className="max-w-2xl mt-6 px-4">
                  <div className="rounded-md border border-destructive/30 p-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-destructive">{t("deleteButton")}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">{t("deleteZoneDescription")}</p>
                    </div>
                    <Button
                      variant="destructive" size="sm" className="shrink-0 cursor-pointer"
                      onClick={openDeleteDialog}
                    >
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
              <Button variant="secondary" size="sm" onClick={handleCancelDraft} className="cursor-pointer">
                {t("cancelChanges")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending} className="cursor-pointer">
                {updateMutation.isPending ? t("saving") : t("saveChanges")}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Delete info confirm dialog ── */}
      <Dialog open={!!deleteInfoId} onOpenChange={(o) => { if (!o) setDeleteInfoId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteInfoTitle")}</DialogTitle>
            <DialogDescription>{t("deleteInfoDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteInfoId(null)} className="cursor-pointer">
              {t("deleteCancel")}
            </Button>
            <Button
              variant="destructive" size="sm" className="cursor-pointer"
              disabled={deleteInfoMutation.isPending}
              onClick={() => {
                if (selected && deleteInfoId) {
                  deleteInfoMutation.mutate({ outletId: selected.id, infoId: deleteInfoId })
                }
              }}
            >
              {t("deleteInfoConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Single delete dialog ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteAbsoluteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteAbsoluteDescription", { name: selected?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox checked={deleteUnderstood} onCheckedChange={(v) => setDeleteUnderstood(!!v)} className="mt-0.5 shrink-0" />
              <span className="text-sm">{t("deleteUnderstand")}</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm")}</label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t("deleteTypePlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteDialogOpen(false)} className="cursor-pointer">
              {t("deleteCancel")}
            </Button>
            <Button
              variant="destructive" size="sm" className="cursor-pointer"
              onClick={handleDelete}
              disabled={!deleteUnderstood || deleteConfirmText !== t("deleteTypePlaceholder") || deleteMutation.isPending}
            >
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete dialog ── */}
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
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("deleteTypeToConfirm")}</label>
              <Input
                value={bulkDeleteConfirmText}
                onChange={(e) => setBulkDeleteConfirmText(e.target.value)}
                placeholder={t("deleteTypePlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)} className="cursor-pointer">
              {t("deleteCancel")}
            </Button>
            <Button
              variant="destructive" size="sm" className="cursor-pointer"
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
