"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp, Plus, X, Info,
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
import { Badge } from "@/components/ui/badge"
import {
  outletsApi, outletGroupsApi, customerConfigurationApi, salesApi,
  type OutletResponse, type OutletUpdate, type DeliveryAnalyticsWeekday,
  type OutletConstraintWeekday,
} from "@/lib/api"
import { ExportMenu } from "@/components/ui/export-menu"
import type { ExportColumn } from "@/lib/export"
import { useLock } from "@/components/providers/lock-provider"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
const DATA_ITEMS_PER_PAGE = 10
type SortField = "name" | "ext_id" | "starred"
type DataSortField = "date" | "weekday" | "quantity" | "sold" | "returned" | "starred"

const JS_WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

interface DataTableRow {
  date: string
  weekday: string
  weekdayIndex: number
  quantity: number | null
  sold: number
  returned: number | null
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
  const dates = wd.dates ?? []

  return (
    <>
      {([0, 1, 2] as const).map((rowIdx) => {
        const hist = histories[rowIdx] ?? []
        // pad to 8 (oldest first, most recent last)
        const padLen = 8
        const padCount = Math.max(0, padLen - hist.length)
        const cells = [...Array.from({ length: padCount }, () => null), ...hist]
        const cellDates = [...Array.from({ length: padCount }, () => ""), ...dates]
        // Highlight the 4 most recent sold values
        const recentStart = padLen - Math.min(hist.length, 4)

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
                  rowIdx === 1 && i >= recentStart && val != null && "text-red-500",
                )}
                title={cellDates[i] || undefined}
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
                <td rowSpan={3} className="py-1.5 px-2 text-center tabular-nums align-middle text-[var(--muted-foreground)]">
                  {wd.cv != null ? wd.cv.toFixed(2) : "—"}
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
                    wd.fixed    ? `=${fmtNum(wd.fixed)}`         : null,
                    wd.minimum  ? `>${fmtNum(wd.minimum)}`       : null,
                    wd.maximum  ? `<${fmtNum(wd.maximum)}`       : null,
                    wd.add      ? `+${fmtNum(wd.add)}`           : null,
                    wd.add_pct  ? `+%${fmtNum(wd.add_pct)}`      : null,
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

// ─── localStorage helpers (scoped per customer) ─────────────────────────────

const STORAGE_PREFIX = "gorm:outlets:"

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

export default function OutletsListPage() {
  const t = useTranslations("outlets.list")
  const { activeCustomer } = useCustomer()
  const { isLocked } = useLock()
  const queryClient = useQueryClient()
  const cid = activeCustomer?.id ?? ""

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadJson<string[]>(cid, "checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>(cid, "starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)
  const [groupFilter, setGroupFilter] = useState<"active" | "all">("active")

  // ── Detail pane state (persisted)
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(() => loadJson<string | null>(cid, "selectedOutlet", null))
  const [selected, setSelected] = useState<OutletResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadJson<string>(cid, "activeTab", "tab1"))
  const [detailMaximized, setDetailMaximized] = useState(() => loadJson<boolean>(cid, "detailMaximized", false))
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

  // ── Data tab state
  const [dataSearch, setDataSearch] = useState("")
  const [dataPage, setDataPage] = useState(1)
  const [dataSortField, setDataSortField] = useState<DataSortField>("date")
  const [dataSortDir, setDataSortDir] = useState<"asc" | "desc">("desc")
  const [dataChecked, setDataChecked] = useState<Set<string>>(new Set())
  const [dataStarred, setDataStarred] = useState<Set<string>>(new Set())
  const [dataShowOnlySelected, setDataShowOnlySelected] = useState(false)

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
    enabled: !!selected && (activeTab === "tab5" || activeTab === "tab7"),
    retry: false,
  })

  const { data: deliveryAnalytics, isLoading: deliveryAnalyticsLoading } = useQuery({
    queryKey: ["outlet-delivery-analytics", selected?.id],
    queryFn: () => outletsApi.getDeliveryAnalytics(selected!.id),
    enabled: !!selected && activeTab === "tab6",
    retry: false,
  })

  // ── Constraints tab state ─────────────────────────────────────────────────
  const { data: constraintsData, isLoading: constraintsLoading } = useQuery({
    queryKey: ["outlet-constraints", selected?.id],
    queryFn: () => outletsApi.getConstraints(selected!.id),
    enabled: !!selected && activeTab === "tab8",
    retry: false,
  })

  const [constraintsDraft, setConstraintsDraft] = useState<OutletConstraintWeekday[]>([])
  const [constraintsDraftInit, setConstraintsDraftInit] = useState(false)

  useEffect(() => {
    if (constraintsData) {
      setConstraintsDraft(constraintsData.weekdays.map((w) => ({ ...w })))
      setConstraintsDraftInit(true)
    }
  }, [constraintsData])

  // Reset constraints draft when selection changes
  useEffect(() => {
    setConstraintsDraftInit(false)
    setConstraintsDraft([])
  }, [selected?.id])

  const constraintsDirty = useMemo(() => {
    if (!constraintsDraftInit || !constraintsData) return false
    return JSON.stringify(constraintsDraft) !== JSON.stringify(constraintsData.weekdays)
  }, [constraintsDraft, constraintsData, constraintsDraftInit])

  const constraintsMutation = useMutation({
    mutationFn: ({ id, weekdays }: { id: string; weekdays: OutletConstraintWeekday[] }) =>
      outletsApi.updateConstraints(id, { weekdays }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlet-constraints", selected?.id] })
      queryClient.invalidateQueries({ queryKey: ["outlet-delivery-analytics", selected?.id] })
      toast.success(t("constraintsSaved"))
    },
    onError: () => toast.error(t("constraintsSaveError")),
  })

  function updateConstraintField(weekday: number, field: keyof Omit<OutletConstraintWeekday, "weekday">, value: string) {
    setConstraintsDraft((prev) =>
      prev.map((w) =>
        w.weekday === weekday
          ? { ...w, [field]: value === "" ? null : parseFloat(value) }
          : w
      )
    )
  }

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

  // ── Data tab table ──────────────────────────────────────────────────────────

  const dataTableRows: DataTableRow[] = useMemo(() => {
    return salesData
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => {
        const d = new Date(s.date + "T00:00:00")
        return {
          date: s.date,
          weekday: JS_WEEKDAY_NAMES[d.getDay()],
          weekdayIndex: d.getDay(),
          quantity: s.delivered,
          sold: s.sold,
          returned: s.delivered != null ? s.delivered - s.sold : null,
        }
      })
  }, [salesData])

  const dataFilteredTable = useMemo(() => {
    let rows = dataTableRows
    if (dataSearch) {
      const q = dataSearch.toLowerCase()
      rows = rows.filter((r) => r.date.includes(q) || r.weekday.toLowerCase().includes(q))
    }
    if (dataShowOnlySelected && dataChecked.size > 0) {
      rows = rows.filter((r) => dataChecked.has(r.date))
    }
    rows = [...rows].sort((a, b) => {
      const dir = dataSortDir === "asc" ? 1 : -1
      if (dataSortField === "starred") {
        return ((dataStarred.has(a.date) ? 1 : 0) - (dataStarred.has(b.date) ? 1 : 0)) * dir
      }
      if (dataSortField === "date") return a.date.localeCompare(b.date) * dir
      if (dataSortField === "weekday") return (a.weekdayIndex - b.weekdayIndex) * dir
      const av = a[dataSortField] ?? 0
      const bv = b[dataSortField] ?? 0
      return (av - bv) * dir
    })
    return rows
  }, [dataTableRows, dataSearch, dataShowOnlySelected, dataChecked, dataSortField, dataSortDir, dataStarred])

  const dataTotalPages = Math.max(1, Math.ceil(dataFilteredTable.length / DATA_ITEMS_PER_PAGE))
  const dataSafePage = Math.min(dataPage, dataTotalPages)
  const dataPagedRows = dataFilteredTable.slice((dataSafePage - 1) * DATA_ITEMS_PER_PAGE, dataSafePage * DATA_ITEMS_PER_PAGE)
  const dataPaginationPages = buildPaginationPages(dataSafePage, dataTotalPages)
  const dataAllChecked = dataPagedRows.length > 0 && dataPagedRows.every((r) => dataChecked.has(r.date))

  const toggleDataCheck = useCallback((date: string) => {
    setDataChecked((prev) => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n })
  }, [])

  const toggleDataStar = useCallback((date: string) => {
    setDataStarred((prev) => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n })
  }, [])

  const toggleDataAllChecked = useCallback(() => {
    setDataChecked((prev) => {
      const n = new Set(prev)
      if (dataAllChecked) { dataPagedRows.forEach((r) => n.delete(r.date)) }
      else { dataPagedRows.forEach((r) => n.add(r.date)) }
      return n
    })
  }, [dataAllChecked, dataPagedRows])

  function handleDataSort(field: DataSortField) {
    if (dataSortField === field) { setDataSortDir((d) => (d === "asc" ? "desc" : "asc")) }
    else { setDataSortField(field); setDataSortDir("desc") }
    setDataPage(1)
  }

  const dataExportColumns: ExportColumn[] = useMemo(() => [
    { header: t("dataDate"), accessor: "date" },
    { header: t("dataWeekday"), accessor: "weekday" },
    { header: t("dataQuantity"), accessor: (r: any) => r.quantity != null ? String(r.quantity) : "" },
    { header: t("dataSold"), accessor: (r: any) => String(r.sold) },
    { header: t("dataReturned"), accessor: (r: any) => r.returned != null ? String(r.returned) : "" },
  ], [t])

  function DataSortIcon({ field }: { field: DataSortField }) {
    if (dataSortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />
    return dataSortDir === "asc"
      ? <ChevronUp className="h-3 w-3 ml-1" />
      : <ChevronDown className="h-3 w-3 ml-1" />
  }

  // ── Persist state to localStorage ──────────────────────────────────────────

  useEffect(() => { if (cid) saveJson(cid, "checked", [...selectedIds]) }, [cid, selectedIds])
  useEffect(() => { if (cid) saveJson(cid, "starred", [...starredIds]) }, [cid, starredIds])
  useEffect(() => { if (cid) saveJson(cid, "activeTab", activeTab) }, [cid, activeTab])
  useEffect(() => { if (cid) saveJson(cid, "selectedOutlet", selected?.id ?? null) }, [cid, selected?.id])
  useEffect(() => { if (cid) saveJson(cid, "detailMaximized", detailMaximized) }, [cid, detailMaximized])

  // ── Restore selected outlet from persisted ID when outlets load ───────────

  useEffect(() => {
    if (!outlets.length || selected) return
    if (selectedOutletId) {
      const found = outlets.find((o) => o.id === selectedOutletId)
      if (found) setSelected(found)
    }
  }, [outlets.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset persisted state when customer changes ───────────────────────────

  const prevCidRef = useRef(cid)
  useEffect(() => {
    if (prevCidRef.current && cid && prevCidRef.current !== cid) {
      setSelectedIds(new Set(loadJson<string[]>(cid, "checked", [])))
      setStarredIds(new Set(loadJson<string[]>(cid, "starred", [])))
      setSelectedOutletId(loadJson<string | null>(cid, "selectedOutlet", null))
      setSelected(null)
      setActiveTab(loadJson<string>(cid, "activeTab", "tab1"))
    }
    prevCidRef.current = cid
  }, [cid])

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

  // ── Production toggle mutation ───────────────────────────────────────────
  const productionToggleMutation = useMutation({
    mutationFn: async ({ outletId, inGroup }: { outletId: string; inGroup: boolean }) => {
      if (!groupId) return
      if (inGroup) {
        await outletGroupsApi.removeOutlet(groupId, outletId)
      } else {
        await outletGroupsApi.addOutlet(groupId, outletId)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlet-group-outlets", groupId] })
      toast.success(t("productionToggled"))
    },
    onError: () => toast.error(t("productionToggleError")),
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
    setDataChecked(new Set())
    setDataStarred(new Set())
    setDataSearch("")
    setDataPage(1)
    setDataShowOnlySelected(false)
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
      <div className={cn("flex flex-col shrink-0", detailMaximized && "hidden")}>

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
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab8">{t("tabConstraints")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabLocation")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabInformation")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab5">{t("tabStatistics")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab6">{t("tabDeliveryAnalytics")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab7">{t("tabData")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab4">{t("tabActions")}</TabsTrigger>
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

              <div className="flex-1 overflow-y-auto">

                {/* ─ Details ─ */}
                <TabsContent value="tab1" className="space-y-6 max-w-2xl mt-6 px-4">
                  <div>
                    {groupId ? (
                      groupOutletIds.has(selected.id) ? (
                        <Badge
                          variant="default"
                          className={cn("text-xs", !isLocked && "cursor-pointer hover:opacity-80")}
                          onClick={() => {
                            if (!isLocked && groupId) {
                              productionToggleMutation.mutate({ outletId: selected.id, inGroup: true })
                            }
                          }}
                        >
                          {t("inProduction")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className={cn("text-xs", !isLocked && "cursor-pointer hover:opacity-80")}
                          onClick={() => {
                            if (!isLocked && groupId) {
                              productionToggleMutation.mutate({ outletId: selected.id, inGroup: false })
                            }
                          }}
                        >
                          {t("notInProduction")}
                        </Badge>
                      )
                    ) : null}
                  </div>
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
                  <FieldRow label={t("fieldExtId")}>
                    <Input
                      value={draft.ext_id ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, ext_id: e.target.value }))}
                      disabled={isLocked}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldName")}>
                    <Input
                      value={draft.name ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      disabled={isLocked}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldDescription")}>
                    <Textarea
                      value={draft.description ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || null }))}
                      rows={3}
                      className="resize-none"
                      disabled={isLocked}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldNotes")}>
                    <Textarea
                      value={draft.notes ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value || null }))}
                      rows={3}
                      className="resize-none"
                      disabled={isLocked}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldCreated")}>
                    <Input
                      value={selected.created_at ? new Date(selected.created_at).toLocaleDateString() : "—"}
                      readOnly
                      className="opacity-50 cursor-default"
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldStartDate")}>
                    <Input
                      value={selected.start_date ?? "—"}
                      readOnly
                      className="opacity-50 cursor-default"
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldEndDate")}>
                    <Input
                      value={selected.end_date ?? "—"}
                      readOnly
                      className="opacity-50 cursor-default"
                    />
                  </FieldRow>
                </TabsContent>

                {/* ─ Location ─ */}
                <TabsContent value="tab2" className="space-y-6 max-w-2xl mt-6 px-4">
                  <FieldRow label={t("fieldAddress")}>
                    <Input
                      value={draft.address ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value || null }))}
                      disabled={isLocked}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldCity")}>
                    <Input
                      value={draft.city ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value || null }))}
                      disabled={isLocked}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldZip")}>
                    <Input
                      value={draft.zip ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, zip: e.target.value || null }))}
                      disabled={isLocked}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldState")}>
                    <Input
                      value={draft.state ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value || null }))}
                      disabled={isLocked}
                    />
                  </FieldRow>
                  <FieldRow label={t("fieldCountry")}>
                    <Input
                      value={draft.country ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value || null }))}
                      disabled={isLocked}
                    />
                  </FieldRow>
                </TabsContent>

                {/* ─ Constraints ─ */}
                <TabsContent value="tab8" className="mt-4 px-2">
                  {constraintsLoading ? (
                    <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">Loading…</div>
                  ) : constraintsDraft.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">{t("constraintsNoData")}</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="text-xs w-28">{t("constraintsWeekday")}</TableHead>
                              <TableHead className="text-xs text-center w-20">{t("constraintsStatus")}</TableHead>
                              <TableHead className="text-xs text-right">{t("constraintsCost")}</TableHead>
                              <TableHead className="text-xs text-right">{t("constraintsProfit")}</TableHead>
                              <TableHead className="text-xs text-right">{t("constraintsFixed")}</TableHead>
                              <TableHead className="text-xs text-right">{t("constraintsMinimum")}</TableHead>
                              <TableHead className="text-xs text-right">{t("constraintsMaximum")}</TableHead>
                              <TableHead className="text-xs text-right">{t("constraintsAdded")}</TableHead>
                              <TableHead className="text-xs text-right">{t("constraintsAddedPct")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {constraintsDraft.map((wd) => (
                              <TableRow key={wd.weekday}>
                                <TableCell className="text-xs font-medium">{WEEKDAY_NAMES[wd.weekday]}</TableCell>
                                <TableCell className="text-center p-1">
                                  <Badge
                                    variant={wd.open ? "default" : "secondary"}
                                    className={cn(
                                      "text-xs",
                                      !isLocked && "cursor-pointer hover:opacity-80",
                                    )}
                                    onClick={() => {
                                      if (!isLocked) {
                                        setConstraintsDraft((prev) =>
                                          prev.map((w) =>
                                            w.weekday === wd.weekday ? { ...w, open: !w.open } : w
                                          )
                                        )
                                      }
                                    }}
                                  >
                                    {wd.open ? t("constraintsOpen") : t("constraintsClosed")}
                                  </Badge>
                                </TableCell>
                                {(["cost_per_unit", "profit_per_unit", "fixed", "minimum", "maximum", "add", "add_pct"] as const).map((field) => (
                                  <TableCell key={field} className="p-1 text-right">
                                    <Input
                                      type="number"
                                      step="any"
                                      value={wd[field] ?? ""}
                                      onChange={(e) => updateConstraintField(wd.weekday, field, e.target.value)}
                                      className="h-7 text-xs text-right tabular-nums w-24 ml-auto bg-transparent border-none shadow-none"
                                      disabled={isLocked}
                                    />
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {constraintsDirty && !isLocked && (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary" size="sm" className="cursor-pointer"
                            onClick={() => {
                              if (constraintsData) setConstraintsDraft(constraintsData.weekdays.map((w) => ({ ...w })))
                            }}
                          >
                            {t("cancelChanges")}
                          </Button>
                          <Button
                            size="sm" className="cursor-pointer"
                            disabled={constraintsMutation.isPending}
                            onClick={() => {
                              if (selected) constraintsMutation.mutate({ id: selected.id, weekdays: constraintsDraft })
                            }}
                          >
                            {constraintsMutation.isPending ? t("saving") : t("saveChanges")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
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
                        {!isLocked && (
                          <button
                            onClick={() => setDeleteInfoId(info.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--muted-foreground)] hover:text-destructive cursor-pointer"
                            aria-label="Remove field"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Add info inline form */}
                  {!isLocked && addInfoMode ? (
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
                  ) : !isLocked ? (
                    <Button
                      variant="outline" size="sm" className="h-7 gap-1.5 text-xs cursor-pointer"
                      onClick={() => setAddInfoMode(true)}
                    >
                      <Plus className="h-3 w-3" />
                      {t("addInfoButton")}
                    </Button>
                  ) : null}
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
                            <th className="text-center font-medium text-[var(--muted-foreground)] py-1.5 px-2 min-w-[44px]" rowSpan={2}>{t("daCV")} <HeaderInfo text={t("daCVInfo")} /></th>
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

                {/* ─ Data ─ */}
                <TabsContent value="tab7" className="mt-4 px-2">
                  {salesLoading ? (
                    <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">Loading…</div>
                  ) : dataTableRows.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-sm text-[var(--muted-foreground)]">{t("dataNoData")}</div>
                  ) : (
                    <div className="space-y-3">
                      {/* Table toolbar */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative flex-1 max-w-xs">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                          <Input
                            value={dataSearch}
                            onChange={(e) => { setDataSearch(e.target.value); setDataPage(1) }}
                            placeholder={t("dataSearchPlaceholder")}
                            className="pl-8 h-8 text-xs"
                          />
                        </div>

                        <ExportMenu
                          data={dataFilteredTable}
                          columns={dataExportColumns}
                          filename={`outlet-data-${selected?.name ?? "outlet"}`}
                        />

                        <span className="text-xs text-[var(--muted-foreground)] ml-auto">
                          {dataChecked.size > 0 && (
                            <span className="mr-3">{t("dataSelectedCount", { selected: dataChecked.size })}</span>
                          )}
                          {t("dataShowing", {
                            from: (dataSafePage - 1) * DATA_ITEMS_PER_PAGE + 1,
                            to: Math.min(dataSafePage * DATA_ITEMS_PER_PAGE, dataFilteredTable.length),
                            total: dataFilteredTable.length,
                          })}
                        </span>
                      </div>

                      {/* Data table */}
                      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="w-10 px-3">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <div className="flex items-center cursor-pointer">
                                      <Checkbox
                                        checked={dataAllChecked}
                                        onCheckedChange={toggleDataAllChecked}
                                        className="cursor-pointer"
                                      />
                                      <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" />
                                    </div>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start" className="min-w-[140px]">
                                    <DropdownMenuItem onClick={toggleDataAllChecked} className="cursor-pointer text-xs">
                                      {t("dataSelectAll")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        const n = new Set(dataChecked)
                                        dataFilteredTable.filter((r) => dataStarred.has(r.date)).forEach((r) => n.add(r.date))
                                        setDataChecked(n)
                                      }}
                                      className="cursor-pointer text-xs"
                                    >
                                      {t("dataStarred")}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableHead>
                              <TableHead className="cursor-pointer select-none text-xs" onClick={() => handleDataSort("date")}>
                                <span className="flex items-center">{t("dataDate")}<DataSortIcon field="date" /></span>
                              </TableHead>
                              <TableHead className="cursor-pointer select-none text-xs" onClick={() => handleDataSort("weekday")}>
                                <span className="flex items-center">{t("dataWeekday")}<DataSortIcon field="weekday" /></span>
                              </TableHead>
                              <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleDataSort("quantity")}>
                                <span className="flex items-center justify-end">{t("dataQuantity")}<DataSortIcon field="quantity" /></span>
                              </TableHead>
                              <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleDataSort("sold")}>
                                <span className="flex items-center justify-end">{t("dataSold")}<DataSortIcon field="sold" /></span>
                              </TableHead>
                              <TableHead className="cursor-pointer select-none text-xs text-right" onClick={() => handleDataSort("returned")}>
                                <span className="flex items-center justify-end">{t("dataReturned")}<DataSortIcon field="returned" /></span>
                              </TableHead>
                              <TableHead className="w-10 px-3" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {dataPagedRows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={7} className="text-center text-xs text-[var(--muted-foreground)] py-8">
                                  {t("dataNoResults")}
                                </TableCell>
                              </TableRow>
                            ) : (
                              dataPagedRows.map((row) => {
                                const isChecked = dataChecked.has(row.date)
                                const isStarred = dataStarred.has(row.date)
                                return (
                                  <TableRow
                                    key={row.date}
                                    className={cn(
                                      "cursor-pointer",
                                      isChecked && "bg-[var(--accent)]/30",
                                    )}
                                    onContextMenu={(e) => {
                                      e.preventDefault()
                                      toggleDataStar(row.date)
                                    }}
                                  >
                                    <TableCell className="px-3">
                                      <Checkbox
                                        checked={isChecked}
                                        onCheckedChange={() => toggleDataCheck(row.date)}
                                        className="cursor-pointer"
                                      />
                                    </TableCell>
                                    <TableCell className="text-xs font-medium">{row.date}</TableCell>
                                    <TableCell className="text-xs">{row.weekday}</TableCell>
                                    <TableCell className="text-xs text-right tabular-nums">
                                      {row.quantity != null ? row.quantity.toLocaleString() : "\u2014"}
                                    </TableCell>
                                    <TableCell className="text-xs text-right tabular-nums">
                                      {row.sold.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-xs text-right tabular-nums">
                                      {row.returned != null ? row.returned.toLocaleString() : "\u2014"}
                                    </TableCell>
                                    <TableCell className="px-3">
                                      <button
                                        onClick={() => toggleDataStar(row.date)}
                                        className="cursor-pointer"
                                      >
                                        <Star
                                          className={cn(
                                            "h-3.5 w-3.5 transition-colors",
                                            isStarred
                                              ? "fill-amber-400 text-amber-400"
                                              : "text-[var(--muted-foreground)] hover:text-amber-400",
                                          )}
                                        />
                                      </button>
                                    </TableCell>
                                  </TableRow>
                                )
                              })
                            )}
                          </TableBody>
                        </Table>
                        {dataChecked.size > 0 && (
                          <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] bg-[var(--muted)]/30">
                            <span className="text-xs text-[var(--muted-foreground)]">
                              {t("dataSelectedCount", { selected: dataChecked.size })}
                            </span>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
                              onClick={() => setDataShowOnlySelected((v) => !v)}
                              title={dataShowOnlySelected ? t("dataShowAll") : t("dataShowSelected")}
                            >
                              <Focus className={cn("h-4 w-4", dataShowOnlySelected && "text-primary")} />
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Pagination */}
                      {dataTotalPages > 1 && (
                        <div className="flex justify-center">
                          <Pagination>
                            <PaginationContent>
                              <PaginationItem>
                                <PaginationPrevious
                                  onClick={() => setDataPage(Math.max(1, dataSafePage - 1))}
                                  className={cn("cursor-pointer", dataSafePage === 1 && "pointer-events-none opacity-50")}
                                />
                              </PaginationItem>
                              {dataPaginationPages.map((p, i) =>
                                p === "ellipsis" ? (
                                  <PaginationItem key={`e-${i}`}>
                                    <PaginationEllipsis />
                                  </PaginationItem>
                                ) : (
                                  <PaginationItem key={p}>
                                    <PaginationLink
                                      onClick={() => setDataPage(p)}
                                      isActive={p === dataSafePage}
                                      className="cursor-pointer"
                                    >
                                      {p}
                                    </PaginationLink>
                                  </PaginationItem>
                                ),
                              )}
                              <PaginationItem>
                                <PaginationNext
                                  onClick={() => setDataPage(Math.min(dataTotalPages, dataSafePage + 1))}
                                  className={cn("cursor-pointer", dataSafePage === dataTotalPages && "pointer-events-none opacity-50")}
                                />
                              </PaginationItem>
                            </PaginationContent>
                          </Pagination>
                        </div>
                      )}
                    </div>
                  )}
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
                      disabled={isLocked}
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
          {isDirty && !isLocked && (
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
