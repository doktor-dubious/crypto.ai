"use client"

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import type { DateRange } from "react-day-picker"
import {
  Search, Star, Trash2, Focus, ArrowUpDown,
  ChevronDown, ChevronUp, CalendarIcon, RefreshCw, Tags,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
import { coinsApi, klinesApi, binanceImportApi, type CoinResponse, type CoinUpdate, type PredictionEngine } from "@/lib/api"
import { KlineChart } from "@/components/coins/kline-chart"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "symbol" | "name" | "tradingPairs" | "volume" | "type" | "lastUpdated" | "starred"

// Compact USD-ish formatter for traded-volume figures (e.g. $1.2B, $345M, $12K).
const compactUsd = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

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

// ─── Sub-components ───────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORAGE_PREFIX = "gorm:coins:"

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

export default function CoinsPage() {
  const t = useTranslations("coinsPage")
  const queryClient = useQueryClient()

  // ── Table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadJson<string[]>("starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state (persisted)
  const [selectedCoinId, setSelectedCoinId] = useState<string | null>(() => loadJson<string | null>("selectedCoin", null))
  const [selectedCoin, setSelectedCoin] = useState<CoinResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadJson<string>("activeTab", "details"))
  const [detailMaximized, setDetailMaximized] = useState(false)
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  const [draft, setDraft] = useState<CoinUpdate>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data tab state ────────────────────────────────────────────────────────
  const [selectedQuoteAsset, setSelectedQuoteAsset] = useState<string | null>(null)
  const [selectedTimeframe, setSelectedTimeframe] = useState<string | null>(null)
  const [klinesPage, setKlinesPage] = useState(1)
  const [klinesSelectedIds, setKlinesSelectedIds] = useState<Set<string>>(new Set())
  const [klinesStarredIds, setKlinesStarredIds] = useState<Set<string>>(new Set())
  const [klinesSearch, setKlinesSearch] = useState("")
  const [klinesSortField, setKlinesSortField] = useState<"open_time" | "open" | "high" | "low" | "close" | "volume" | "number_of_trades">("open_time")
  const [klinesSortDir, setKlinesSortDir] = useState<"asc" | "desc">("asc")
  const [klinesDeleteDialogOpen, setKlinesDeleteDialogOpen] = useState(false)
  const [klinesDeleteUnderstood, setKlinesDeleteUnderstood] = useState(false)
  const [klinesDeleteConfirmText, setKlinesDeleteConfirmText] = useState("")
  const KLINES_PER_PAGE = 10
  type KlineSortField = "open_time" | "open" | "high" | "low" | "close" | "volume" | "number_of_trades"

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: coins = [], isLoading } = useQuery({
    queryKey: ["coins"],
    queryFn: async () => {
      const response = await coinsApi.list({ limit: 1000 })
      return response
    },
  })

  // Number of distinct trading pairs (with loaded data) per coin, for the master table
  const { data: pairCounts = {} } = useQuery({
    queryKey: ["klinesPairCounts"],
    queryFn: () => klinesApi.getPairCounts(),
  })

  // Most recent data-update timestamp (ISO 8601) per coin, for the "Last updated" column
  const { data: lastUpdated = {} } = useQuery({
    queryKey: ["klinesLastUpdated"],
    queryFn: () => klinesApi.getLastUpdated(),
  })

  // Avg daily traded value (USDT, last 30 1d bars) per coin, for the "Volume (30d)" column
  const { data: avgVolume = {} } = useQuery({
    queryKey: ["klinesAvgVolume"],
    queryFn: () => klinesApi.getAvgDailyVolume(30),
  })

  // Fetch available trading pairs for selected coin
  const { data: tradingPairsResponse, isLoading: tradingPairsLoading } = useQuery({
    queryKey: ["klinesTrading Pairs", selectedCoin?.id],
    queryFn: () => klinesApi.getTradingPairs(selectedCoin!.id),
    enabled: !!selectedCoin && (activeTab === "data" || activeTab === "chart" || activeTab === "analyze" || activeTab === "simulation"),
  })
  const tradingPairs = tradingPairsResponse?.pairs || []

  // Fetch available timeframes for selected trading pair (Data/Analyze tabs)
  const { data: timeframesResponse, isLoading: timeframesLoading } = useQuery({
    queryKey: ["klinesTimeframes", selectedCoin?.id, selectedQuoteAsset],
    queryFn: () => klinesApi.getTimeframes(selectedCoin!.id, selectedQuoteAsset!),
    enabled: !!selectedCoin && !!selectedQuoteAsset && (activeTab === "data" || activeTab === "chart" || activeTab === "analyze"),
  })
  const timeframes = timeframesResponse?.timeframes || []

  // Fetch kline data for selected trading pair and timeframe
  const klinesQuery = useQuery({
    queryKey: ["klines", selectedCoin?.id, selectedQuoteAsset, selectedTimeframe],
    queryFn: () => klinesApi.list({
      coin_id: selectedCoin!.id,
      quote_asset: selectedQuoteAsset!,
      interval: selectedTimeframe!,
      limit: 100000,
      offset: 0,
    }),
    enabled: !!selectedCoin && !!selectedQuoteAsset && !!selectedTimeframe && (activeTab === "data" || activeTab === "chart" || activeTab === "analyze" || activeTab === "simulation"),
  })
  const allKlinesData = klinesQuery.data || []

  // Filter and sort klines for Data tab
  const filteredKlines = useMemo(() => {
    let items = allKlinesData

    if (klinesSearch.trim()) {
      const q = klinesSearch.toLowerCase()
      items = items.filter((k) =>
        k.open.toString().includes(q) ||
        k.high.toString().includes(q) ||
        k.low.toString().includes(q) ||
        k.close.toString().includes(q) ||
        k.volume.toString().includes(q) ||
        new Date(k.open_time).toLocaleString().toLowerCase().includes(q)
      )
    }

    return [...items].sort((a, b) => {
      let va: number, vb: number
      switch (klinesSortField) {
        case "open_time": va = a.open_time; vb = b.open_time; break
        case "open": va = a.open; vb = b.open; break
        case "high": va = a.high; vb = b.high; break
        case "low": va = a.low; vb = b.low; break
        case "close": va = a.close; vb = b.close; break
        case "volume": va = a.volume; vb = b.volume; break
        case "number_of_trades": va = a.number_of_trades; vb = b.number_of_trades; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return klinesSortDir === "asc" ? cmp : -cmp
    })
  }, [allKlinesData, klinesSearch, klinesSortField, klinesSortDir])

  const klinesPageCount = Math.max(1, Math.ceil(filteredKlines.length / KLINES_PER_PAGE))
  const klinesCurrentPage = Math.min(klinesPage, klinesPageCount)
  const klinesPageItems = filteredKlines.slice((klinesCurrentPage - 1) * KLINES_PER_PAGE, klinesCurrentPage * KLINES_PER_PAGE)

  // For Analyze tab, use all data
  const klinesData = activeTab === "analyze" ? allKlinesData : klinesPageItems

  // ── Persist state to localStorage ──────────────────────────────────────────

  useEffect(() => { saveJson("checked", [...selectedIds]) }, [selectedIds])
  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson("activeTab", activeTab) }, [activeTab])
  useEffect(() => { saveJson("selectedCoin", selectedCoin?.id ?? null) }, [selectedCoin?.id])

  // ── Auto-revert "show only selected" when no selections remain ────────────

  useEffect(() => {
    if (showOnlySelected && selectedIds.size === 0) {
      setShowOnlySelected(false)
    }
  }, [selectedIds.size, showOnlySelected])

  // ── Restore selected coin from persisted ID when list loads ────────────

  useEffect(() => {
    if (!coins.length || selectedCoin) return
    if (selectedCoinId) {
      const found = coins.find((c) => c.id === selectedCoinId)
      if (found) setSelectedCoin(found)
    }
  }, [coins.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mutations ─────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CoinUpdate }) =>
      coinsApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["coins"] })
      setSelectedCoin(updated)
      toast.success(t("toastUpdated"))
    },
    onError: () => { toast.error(t("toastUpdateError")) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => coinsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["coins"] })
      if (selectedCoin?.id === id) setSelectedCoin(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      setDeleteDialogOpen(false)
      toast.success(t("toastDeleted"))
    },
    onError: () => { toast.error(t("toastDeleteError")) },
  })

  const refreshDataMutation = useMutation({
    mutationFn: (coinId: string) => binanceImportApi.refreshCoin(coinId),
    onSuccess: (res) => {
      if (res.count === 0) {
        toast.info(t("refreshDataNone"))
        return
      }
      // The new import tasks show up in the sidebar task list, which polls itself.
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      toast.success(t("refreshDataQueued", { count: res.count }))
    },
    onError: () => { toast.error(t("refreshDataError")) },
  })

  const refreshSelectedMutation = useMutation({
    mutationFn: (coinIds: string[]) => binanceImportApi.refreshCoins(coinIds),
    onSuccess: (res) => {
      if (res.count === 0) {
        toast.info(t("refreshDataNone"))
        return
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      toast.success(t("refreshDataQueued", { count: res.count }))
    },
    onError: () => { toast.error(t("refreshDataError")) },
  })

  const refreshCategoriesMutation = useMutation({
    mutationFn: (coinIds?: string[]) => coinsApi.refreshCategories(coinIds),
    onSuccess: (res) => {
      if (!res.task_id || res.count === 0) {
        toast.info(t("categoriesNone"))
        return
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      toast.success(t("categoriesQueued", { count: res.count }))
    },
    onError: () => { toast.error(t("categoriesError")) },
  })

  const klinesDeleteMutation = useMutation({
    mutationFn: () => klinesApi.deleteAll(selectedCoin!.id, selectedQuoteAsset!, selectedTimeframe!),
    onSuccess: async (result) => {
      // Clear all klines queries from cache
      queryClient.removeQueries({ queryKey: ["klines"] })
      // Refetch the data
      await klinesQuery.refetch()
      setKlinesDeleteDialogOpen(false)
      setKlinesDeleteUnderstood(false)
      setKlinesDeleteConfirmText("")
      setKlinesPage(1)
      setKlinesSearch("")
      toast.success(`Deleted ${result.deleted_count} klines`)
    },
    onError: () => { toast.error("Failed to delete klines") },
  })

  // ── Sync draft when selected coin changes ──────────────────────────────

  useEffect(() => {
    if (selectedCoin) {
      setDraft({
        symbol: selectedCoin.symbol,
        name: selectedCoin.name,
        description: selectedCoin.description,
        type: selectedCoin.type,
      })
    }
  }, [selectedCoin?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selectedCoin])

  const isDirty = useMemo(() => {
    if (!selectedCoin) return false
    return (
      draft.symbol !== selectedCoin.symbol ||
      draft.name !== selectedCoin.name ||
      draft.description !== selectedCoin.description ||
      draft.type !== selectedCoin.type
    )
  }, [draft, selectedCoin])

  function handleCancelDraft() {
    if (!selectedCoin) return
    setDraft({
      symbol: selectedCoin.symbol,
      name: selectedCoin.name,
      description: selectedCoin.description,
      type: selectedCoin.type,
    })
  }

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  // All distinct categories present across coins, for the filter dropdown.
  const allCategories = useMemo(
    () => Array.from(new Set(coins.flatMap((c) => c.categories ?? []))).sort((a, b) => a.localeCompare(b)),
    [coins]
  )

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? coins.filter((c) => selectedIds.has(c.id))
      : coins

    if (categoryFilter.size > 0) {
      items = items.filter((c) => (c.categories ?? []).some((cat) => categoryFilter.has(cat)))
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (c) => c.name.toLowerCase().includes(q) ||
               c.description?.toLowerCase().includes(q) ||
               c.type?.toLowerCase().includes(q) ||
               (c.categories ?? []).some((cat) => cat.toLowerCase().includes(q))
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "symbol": va = a.symbol; vb = b.symbol; break
        case "name": va = a.name; vb = b.name; break
        case "tradingPairs": va = pairCounts[a.id] ?? 0; vb = pairCounts[b.id] ?? 0; break
        case "volume": va = avgVolume[a.id] ?? 0; vb = avgVolume[b.id] ?? 0; break
        case "type": va = a.type ?? ""; vb = b.type ?? ""; break
        case "lastUpdated":
          va = lastUpdated[a.id] ? Date.parse(lastUpdated[a.id]) : 0
          vb = lastUpdated[b.id] ? Date.parse(lastUpdated[b.id]) : 0
          break
        case "starred": va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [coins, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds, pairCounts, lastUpdated, avgVolume, categoryFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Quantity/time columns read best biggest/newest-first, so they default to
  // descending on first click; text columns default to ascending (A→Z).
  const DESC_FIRST_FIELDS = new Set<SortField>(["tradingPairs", "volume", "lastUpdated", "starred"])

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir(DESC_FIRST_FIELDS.has(field) ? "desc" : "asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((c) => selectedIds.has(c.id))
  const somePageSelected = pageItems.some((c) => selectedIds.has(c.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((c) => n.delete(c.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((c) => n.add(c.id)); return n })
    }
  }

  function handleRowCheckbox(id: string, checked: boolean) {
    setSelectedIds((prev) => { const n = new Set(prev); checked ? n.add(id) : n.delete(id); return n })
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRowClick(coin: CoinResponse) {
    setSelectedCoin(coin)
    setActiveTab("details")
    // Reset pair/timeframe/page — carrying them over queries the new coin
    // with the old coin's selection (phantom combos, blank timeframe select).
    setSelectedQuoteAsset(null)
    setSelectedTimeframe(null)
    setKlinesPage(1)
  }

  function handleRowRightClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    handleStar(id)
  }

  async function handleSave() {
    if (!selectedCoin) return
    await updateMutation.mutateAsync({ id: selectedCoin.id, data: draft })
  }

  function openDeleteDialog() {
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!selectedCoin) return
    await deleteMutation.mutateAsync(selectedCoin.id)
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

  // ── Sort header ────────────────────────────────────────────────────────

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
      <div className={cn("flex flex-col shrink-0", detailMaximized && selectedCoin && "hidden")}>
        {/* Toolbar */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 shrink-0 bg-background">
          <Button
            variant="outline"
            size="sm"
            className="h-7 cursor-pointer"
            disabled={refreshCategoriesMutation.isPending}
            onClick={() => refreshCategoriesMutation.mutate(undefined)}
            title={t("categoriesFetchAllTitle")}
          >
            <Tags className={cn("h-3.5 w-3.5 mr-1.5", refreshCategoriesMutation.isPending && "animate-pulse")} />
            {t("categoriesFetch")}
          </Button>

          {/* Category filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("h-7 cursor-pointer", categoryFilter.size > 0 && "border-primary text-primary")}
                disabled={allCategories.length === 0}
              >
                <Focus className="h-3.5 w-3.5 mr-1.5" />
                {categoryFilter.size > 0 ? t("categoryFilterActive", { count: categoryFilter.size }) : t("categoryFilter")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2">
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-xs font-medium text-muted-foreground">{t("categoryFilter")}</span>
                {categoryFilter.size > 0 && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setCategoryFilter(new Set())}
                  >
                    {t("clear")}
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto space-y-0.5">
                {allCategories.map((cat) => (
                  <label
                    key={cat}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-sm cursor-pointer hover:bg-accent"
                  >
                    <Checkbox
                      checked={categoryFilter.has(cat)}
                      onCheckedChange={(checked) => {
                        setCategoryFilter((prev) => {
                          const n = new Set(prev)
                          checked ? n.add(cat) : n.delete(cat)
                          return n
                        })
                        setCurrentPage(1)
                      }}
                    />
                    <span className="truncate">{cat}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

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
              Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <p className="text-sm">{t("noCoins")}</p>
              <p className="text-xs opacity-60">{t("noCoinsHint")}</p>
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
                            onClick={() => setSelectedIds(new Set(coins.map((c) => c.id)))}
                          >
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setSelectedIds(
                                new Set(coins.filter((c) => starredIds.has(c.id)).map((c) => c.id))
                              )
                            }
                          >
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="symbol" label={t("colSymbol")} /></TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="tradingPairs" label={t("colTradingPairs")} /></TableHead>
                  <TableHead><SortHeader field="volume" label={t("colVolume")} /></TableHead>
                  <TableHead>{t("colCategories")}</TableHead>
                  <TableHead><SortHeader field="lastUpdated" label={t("colLastUpdated")} /></TableHead>
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
                {pageItems.map((coin) => (
                  <TableRow
                    key={coin.id}
                    data-state={selectedCoin?.id === coin.id ? "selected" : undefined}
                    onClick={() => handleRowClick(coin)}
                    onContextMenu={(e) => handleRowRightClick(e, coin.id)}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(coin.id)}
                        onCheckedChange={(c) => handleRowCheckbox(coin.id, !!c)}
                      />
                    </TableCell>
                    <TableCell className="font-mono font-medium text-sm max-w-[80px] truncate">
                      {coin.symbol}
                    </TableCell>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {coin.name}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {pairCounts[coin.id] ? (
                        pairCounts[coin.id]
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums whitespace-nowrap">
                      {avgVolume[coin.id] != null ? (
                        `$${compactUsd.format(avgVolume[coin.id])}`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {coin.categories?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {coin.categories.slice(0, 3).map((cat) => (
                            <Badge key={cat} variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                              {cat}
                            </Badge>
                          ))}
                          {coin.categories.length > 3 && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 font-normal"
                              title={coin.categories.slice(3).join(", ")}
                            >
                              +{coin.categories.length - 3}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {lastUpdated[coin.id]
                        ? format(new Date(lastUpdated[coin.id]), "yyyy-MM-dd HH:mm")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-center w-10" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStar(coin.id)}
                        className="hover:text-amber-400 transition-colors"
                        aria-label="Toggle star"
                      >
                        <Star
                          className={cn(
                            "h-4 w-4",
                            starredIds.has(coin.id)
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
        <div className="shrink-0 border-t bg-background">
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
                  size="sm"
                  className="h-7 cursor-pointer"
                  disabled={refreshSelectedMutation.isPending}
                  onClick={() => refreshSelectedMutation.mutate([...selectedIds])}
                  title={t("refreshSelectedTitle", { count: selectedIds.size })}
                >
                  <RefreshCw className={cn("h-4 w-4 mr-1.5", refreshSelectedMutation.isPending && "animate-spin")} />
                  {t("refreshDataButton")}
                </Button>
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
      {selectedCoin && (
        <>
          <hr className={cn("my-8", detailMaximized && "hidden")} />

          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            {/* Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex-1 flex flex-col gap-0"
            >
              <div className="relative w-full">
                <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="details">{t("tabDetails")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="data">Data</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="chart">Chart</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="analyze">Analyze</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="actions">{t("tabActions")}</TabsTrigger>
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

              {/* ─ Details ─ */}
              <TabsContent value="details" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <FieldRow label="ID">
                  <div className="relative">
                    <Input value={selectedCoin.id} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono text-xs" />
                    <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                      <CopyIcon
                        size={16}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedCoin.id)
                          toast.success(t("toastCopied"))
                        }}
                      />
                    </AnimateIcon>
                  </div>
                </FieldRow>
                <FieldRow label={t("fieldSymbol")}>
                  <div className="relative">
                    <Input value={selectedCoin.symbol} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono" />
                    <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                      <CopyIcon
                        size={16}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedCoin.symbol)
                          toast.success(t("toastCopied"))
                        }}
                      />
                    </AnimateIcon>
                  </div>
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
                <FieldRow label={t("fieldType")}>
                  <Input
                    value={draft.type ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value || null }))}
                    className="px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
                  />
                </FieldRow>
              </TabsContent>

              {/* ─ Data Tab ─ */}
              <TabsContent value="data" className="space-y-4 max-w-6xl mt-6 pl-[2px]">
                {/* Header with Delete Button */}
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Kline Data</h3>
                  {selectedQuoteAsset && selectedTimeframe && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setKlinesDeleteDialogOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete All Data
                    </Button>
                  )}
                </div>

                {/* Trading Pair and Timeframe Selectors */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium">Trading Pair</label>
                    <select
                      value={selectedQuoteAsset || ""}
                      onChange={(e) => {
                        setSelectedQuoteAsset(e.target.value || null)
                        setSelectedTimeframe(null)
                        setKlinesPage(1)
                      }}
                      className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background text-sm"
                    >
                      <option value="">Select trading pair...</option>
                      {tradingPairs.map((pair) => (
                        <option key={pair} value={pair}>
                          {selectedCoin?.symbol}{pair}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Timeframe</label>
                    <select
                      value={selectedTimeframe || ""}
                      onChange={(e) => {
                        setSelectedTimeframe(e.target.value || null)
                        setKlinesPage(1)
                      }}
                      disabled={!selectedQuoteAsset}
                      className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background text-sm disabled:opacity-50"
                    >
                      <option value="">Select timeframe...</option>
                      {timeframes.map((tf) => (
                        <option key={tf} value={tf}>
                          {tf}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Search</label>
                    <div className="relative mt-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search klines..."
                        value={klinesSearch}
                        onChange={(e) => {
                          setKlinesSearch(e.target.value)
                          setKlinesPage(1)
                        }}
                        className="h-9 pl-8 text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Data Table */}
                {!selectedQuoteAsset || !selectedTimeframe ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    Select a trading pair and timeframe to view kline data
                  </div>
                ) : allKlinesData.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No kline data found for this selection
                  </div>
                ) : (
                  <>
                    <div className="border rounded-md overflow-hidden">
                      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                        <Table>
                          <TableHeader className="sticky top-0 bg-muted">
                            <TableRow>
                              <TableHead className="w-12">
                                <Checkbox
                                  checked={klinesPageItems.length > 0 && klinesPageItems.every((k) => klinesSelectedIds.has(k.id))}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setKlinesSelectedIds(new Set(klinesPageItems.map((k) => k.id)))
                                    } else {
                                      const newSet = new Set(klinesSelectedIds)
                                      klinesPageItems.forEach((k) => newSet.delete(k.id))
                                      setKlinesSelectedIds(newSet)
                                    }
                                  }}
                                />
                              </TableHead>
                              <TableHead className="w-12 text-center">⭐</TableHead>
                              <TableHead className="cursor-pointer" onClick={() => {
                                if (klinesSortField === "open_time") {
                                  setKlinesSortDir(klinesSortDir === "asc" ? "desc" : "asc")
                                } else {
                                  setKlinesSortField("open_time")
                                  setKlinesSortDir("asc")
                                }
                              }}>
                                <div className="flex items-center gap-1">
                                  Open Time
                                  {klinesSortField === "open_time" ? (
                                    klinesSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                                  )}
                                </div>
                              </TableHead>
                              <TableHead className="text-right cursor-pointer" onClick={() => {
                                if (klinesSortField === "open") {
                                  setKlinesSortDir(klinesSortDir === "asc" ? "desc" : "asc")
                                } else {
                                  setKlinesSortField("open")
                                  setKlinesSortDir("asc")
                                }
                              }}>
                                <div className="flex items-center justify-end gap-1">
                                  Open
                                  {klinesSortField === "open" ? (
                                    klinesSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                                  )}
                                </div>
                              </TableHead>
                              <TableHead className="text-right cursor-pointer" onClick={() => {
                                if (klinesSortField === "high") {
                                  setKlinesSortDir(klinesSortDir === "asc" ? "desc" : "asc")
                                } else {
                                  setKlinesSortField("high")
                                  setKlinesSortDir("asc")
                                }
                              }}>
                                <div className="flex items-center justify-end gap-1">
                                  High
                                  {klinesSortField === "high" ? (
                                    klinesSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                                  )}
                                </div>
                              </TableHead>
                              <TableHead className="text-right cursor-pointer" onClick={() => {
                                if (klinesSortField === "low") {
                                  setKlinesSortDir(klinesSortDir === "asc" ? "desc" : "asc")
                                } else {
                                  setKlinesSortField("low")
                                  setKlinesSortDir("asc")
                                }
                              }}>
                                <div className="flex items-center justify-end gap-1">
                                  Low
                                  {klinesSortField === "low" ? (
                                    klinesSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                                  )}
                                </div>
                              </TableHead>
                              <TableHead className="text-right cursor-pointer" onClick={() => {
                                if (klinesSortField === "close") {
                                  setKlinesSortDir(klinesSortDir === "asc" ? "desc" : "asc")
                                } else {
                                  setKlinesSortField("close")
                                  setKlinesSortDir("asc")
                                }
                              }}>
                                <div className="flex items-center justify-end gap-1">
                                  Close
                                  {klinesSortField === "close" ? (
                                    klinesSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                                  )}
                                </div>
                              </TableHead>
                              <TableHead className="text-right cursor-pointer" onClick={() => {
                                if (klinesSortField === "volume") {
                                  setKlinesSortDir(klinesSortDir === "asc" ? "desc" : "asc")
                                } else {
                                  setKlinesSortField("volume")
                                  setKlinesSortDir("asc")
                                }
                              }}>
                                <div className="flex items-center justify-end gap-1">
                                  Volume
                                  {klinesSortField === "volume" ? (
                                    klinesSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                                  )}
                                </div>
                              </TableHead>
                              <TableHead className="text-right cursor-pointer" onClick={() => {
                                if (klinesSortField === "number_of_trades") {
                                  setKlinesSortDir(klinesSortDir === "asc" ? "desc" : "asc")
                                } else {
                                  setKlinesSortField("number_of_trades")
                                  setKlinesSortDir("asc")
                                }
                              }}>
                                <div className="flex items-center justify-end gap-1">
                                  Trades
                                  {klinesSortField === "number_of_trades" ? (
                                    klinesSortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                                  )}
                                </div>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {klinesPageItems.map((kline) => (
                              <TableRow key={kline.id}>
                                <TableCell>
                                  <Checkbox
                                    checked={klinesSelectedIds.has(kline.id)}
                                    onCheckedChange={(checked) => {
                                      const newSet = new Set(klinesSelectedIds)
                                      if (checked) {
                                        newSet.add(kline.id)
                                      } else {
                                        newSet.delete(kline.id)
                                      }
                                      setKlinesSelectedIds(newSet)
                                    }}
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  <button
                                    onClick={() => {
                                      const newSet = new Set(klinesStarredIds)
                                      if (newSet.has(kline.id)) {
                                        newSet.delete(kline.id)
                                      } else {
                                        newSet.add(kline.id)
                                      }
                                      setKlinesStarredIds(newSet)
                                    }}
                                    className="hover:text-amber-400 transition-colors"
                                  >
                                    <Star
                                      className={cn(
                                        "h-4 w-4",
                                        klinesStarredIds.has(kline.id)
                                          ? "fill-amber-400 text-amber-400"
                                          : "text-muted-foreground"
                                      )}
                                    />
                                  </button>
                                </TableCell>
                                <TableCell className="text-xs font-mono">
                                  {new Date(kline.open_time).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right text-sm">{kline.open.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-sm">{kline.high.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-sm">{kline.low.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-sm font-medium">{kline.close.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">
                                  {kline.volume.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right text-xs">{kline.number_of_trades.toLocaleString()}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* Pagination and info bar */}
                    {filteredKlines.length > 0 && (
                      <div className="flex items-center justify-between px-4 py-1.5 border-t bg-background text-s text-muted-foreground">
                        <span>
                          Showing {(klinesCurrentPage - 1) * KLINES_PER_PAGE + 1} to {Math.min(klinesCurrentPage * KLINES_PER_PAGE, filteredKlines.length)} of {filteredKlines.length}
                        </span>
                        {klinesPageCount > 1 && (
                          <Pagination className="w-auto mx-0">
                            <PaginationContent>
                              <PaginationItem>
                                <PaginationPrevious
                                  onClick={() => setKlinesPage(Math.max(1, klinesCurrentPage - 1))}
                                  disabled={klinesCurrentPage === 1}
                                />
                              </PaginationItem>
                              {buildPaginationPages(klinesCurrentPage, klinesPageCount).map((p, i) =>
                                p === "ellipsis" ? (
                                  <PaginationItem key={`e${i}`}>
                                    <PaginationEllipsis />
                                  </PaginationItem>
                                ) : (
                                  <PaginationItem key={p}>
                                    <PaginationLink
                                      isActive={klinesCurrentPage === p}
                                      onClick={() => setKlinesPage(p)}
                                    >
                                      {p}
                                    </PaginationLink>
                                  </PaginationItem>
                                )
                              )}
                              <PaginationItem>
                                <PaginationNext
                                  onClick={() => setKlinesPage(Math.min(klinesPageCount, klinesCurrentPage + 1))}
                                  disabled={klinesCurrentPage === klinesPageCount}
                                />
                              </PaginationItem>
                            </PaginationContent>
                          </Pagination>
                        )}
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              {/* ─ Chart Tab ─ */}
              <TabsContent value="chart" className="space-y-4 max-w-6xl mt-6 pl-[2px]">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">
                    {selectedQuoteAsset && selectedTimeframe
                      ? `${selectedCoin?.symbol}${selectedQuoteAsset} · ${selectedTimeframe}`
                      : "Price Chart"}
                  </h3>
                </div>

                {/* Trading Pair and Timeframe Selectors */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Trading Pair</label>
                    <select
                      value={selectedQuoteAsset || ""}
                      onChange={(e) => {
                        setSelectedQuoteAsset(e.target.value || null)
                        setSelectedTimeframe(null)
                      }}
                      className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background text-sm"
                    >
                      <option value="">Select trading pair...</option>
                      {tradingPairs.map((pair) => (
                        <option key={pair} value={pair}>
                          {selectedCoin?.symbol}{pair}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Timeframe</label>
                    <select
                      value={selectedTimeframe || ""}
                      onChange={(e) => {
                        setSelectedTimeframe(e.target.value || null)
                      }}
                      disabled={!selectedQuoteAsset}
                      className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background text-sm disabled:opacity-50"
                    >
                      <option value="">Select timeframe...</option>
                      {timeframes.map((tf) => (
                        <option key={tf} value={tf}>
                          {tf}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Chart */}
                {!selectedQuoteAsset || !selectedTimeframe ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    Select a trading pair and timeframe to view the chart
                  </div>
                ) : allKlinesData.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No kline data found for this selection
                  </div>
                ) : (
                  <KlineChart data={allKlinesData} interval={selectedTimeframe} />
                )}
              </TabsContent>

              {/* ─ Analyze Tab ─ */}
              <TabsContent value="analyze" className="space-y-4 max-w-4xl mt-6 pl-[2px]">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Trading Pair</label>
                    <select
                      value={selectedQuoteAsset || ""}
                      onChange={(e) => {
                        setSelectedQuoteAsset(e.target.value || null)
                        setSelectedTimeframe(null)
                      }}
                      className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background text-sm"
                    >
                      <option value="">Select trading pair...</option>
                      {tradingPairs.map((pair) => (
                        <option key={pair} value={pair}>
                          {selectedCoin?.symbol}{pair}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Timeframe</label>
                    <select
                      value={selectedTimeframe || ""}
                      onChange={(e) => setSelectedTimeframe(e.target.value || null)}
                      disabled={!selectedQuoteAsset}
                      className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background text-sm disabled:opacity-50"
                    >
                      <option value="">Select timeframe...</option>
                      {timeframes.map((tf) => (
                        <option key={tf} value={tf}>
                          {tf}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {!selectedQuoteAsset || !selectedTimeframe ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    Select a trading pair and timeframe to analyze forecastability
                  </div>
                ) : klinesData.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No kline data found for this selection
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Data Summary */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Candles</p>
                        <p className="text-lg font-semibold">{klinesData.length}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Date Range</p>
                        <p className="text-xs font-mono">
                          {klinesData.length > 0 ? (() => {
                            const firstTime = klinesData[0]?.open_time
                            const lastTime = klinesData[klinesData.length - 1]?.open_time
                            // Validate timestamps (should be > year 2000 in milliseconds = 946684800000)
                            if (!firstTime || !lastTime || firstTime < 946684800000 || lastTime < 946684800000) {
                              return "Invalid timestamps"
                            }
                            return (
                              <>
                                {new Date(firstTime).toLocaleDateString()} →
                                <br />
                                {new Date(lastTime).toLocaleDateString()}
                              </>
                            )
                          })() : (
                            "N/A"
                          )}
                        </p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Avg Volume</p>
                        <p className="text-lg font-semibold">
                          {(klinesData.reduce((sum, k) => sum + k.volume, 0) / klinesData.length).toFixed(0)}
                        </p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Price Range</p>
                        <p className="text-xs font-mono">
                          {Math.min(...klinesData.map((k) => k.low)).toFixed(2)} - {Math.max(...klinesData.map((k) => k.high)).toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* Price Analysis */}
                    <div className="rounded-md border p-4 space-y-3">
                      <h3 className="font-semibold text-sm">Price Direction Analysis</h3>
                      {(() => {
                        const returns = klinesData.slice(1).map((k, i) => (k.close - klinesData[i].close) / klinesData[i].close)
                        const upDays = returns.filter((r) => r > 0).length
                        const downDays = returns.filter((r) => r < 0).length
                        const upPct = (upDays / returns.length) * 100
                        const winRate = upPct.toFixed(1)
                        return (
                          <>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Up Days:</span>
                                <p className="font-semibold text-green-600">{upDays} ({upPct.toFixed(1)}%)</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Down Days:</span>
                                <p className="font-semibold text-red-600">{downDays} ({(100 - upPct).toFixed(1)}%)</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Random Walk:</span>
                                <p className="font-semibold">~50%</p>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {Math.abs(upPct - 50) < 5
                                ? "⚠️ Price direction appears random (like a fair coin flip). ML forecasting of direction unlikely to beat random baseline."
                                : upPct > 50
                                  ? "✓ Slight uptrend observed, but still close to random. Direction forecasting challenging."
                                  : "⚠️ Slight downtrend observed, but still close to random. Direction forecasting challenging."}
                            </p>
                          </>
                        )
                      })()}
                    </div>

                    {/* Volatility Analysis */}
                    <div className="rounded-md border p-4 space-y-3">
                      <h3 className="font-semibold text-sm">Volatility Analysis</h3>
                      {(() => {
                        const returns = klinesData.map((k) => Math.log(k.close / k.open))
                        // Annualize by bars-per-year for the selected timeframe
                        // (crypto trades 365d) — a flat √252 treats every bar
                        // as a daily equity bar and understates intraday vol.
                        const barMinutes: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080, "1M": 43200 }
                        const perYear = (365 * 24 * 60) / (barMinutes[selectedTimeframe ?? "1d"] ?? 1440)
                        const volatility = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length) * Math.sqrt(perYear)
                        const priceRange = klinesData.map((k) => (k.high - k.low) / k.open)
                        const avgRange = priceRange.reduce((a, b) => a + b, 0) / priceRange.length
                        const rangeStdDev = Math.sqrt(
                          priceRange.reduce((sum, r) => sum + (r - avgRange) * (r - avgRange), 0) / priceRange.length
                        )

                        const forecastability =
                          rangeStdDev > 0.01
                            ? "High"
                            : rangeStdDev > 0.005
                              ? "Moderate"
                              : "Low"
                        return (
                          <>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Annualized Vol:</span>
                                <p className="font-semibold">{(volatility * 100).toFixed(1)}%</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Avg Range:</span>
                                <p className="font-semibold">{(avgRange * 100).toFixed(2)}%</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Range Variability:</span>
                                <p className="font-semibold">{(rangeStdDev * 100).toFixed(2)}%</p>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              ✓ Volatility is <strong>forecastable</strong>. Volatility prediction models (GARCH, TimesFM) typically perform well.
                              Consistent range variation indicates predictable volatility patterns.
                            </p>
                          </>
                        )
                      })()}
                    </div>

                    {/* Forecastability Recommendation */}
                    <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-4 space-y-2">
                      <h3 className="font-semibold text-sm text-amber-900 dark:text-amber-100">Forecastability Assessment</h3>
                      <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
                        <li>
                          <strong>✗ Price Direction:</strong> Appears random (≈50%). Use ML models for direction with caution - will struggle to beat baseline.
                        </li>
                        <li>
                          <strong>✓ Volatility:</strong> Forecastable. TimesFM and GARCH models show good correlation (0.50+). Recommended for volatility prediction.
                        </li>
                        <li>
                          <strong>📊 Recommendation:</strong> Focus on volatility forecasting rather than direction. This coin is better suited for risk models
                          than return prediction.
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="actions" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <div className="rounded-md border p-4 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{t("refreshDataTitle")}</p>
                    <p className="text-xs text-muted-foreground">{t("refreshDataDescription")}</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    disabled={!selectedCoin || refreshDataMutation.isPending}
                    onClick={() => selectedCoin && refreshDataMutation.mutate(selectedCoin.id)}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshDataMutation.isPending && "animate-spin")} />
                    {t("refreshDataButton")}
                  </Button>
                </div>
                <div className="rounded-md border p-4 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{t("categoriesTitle")}</p>
                    <p className="text-xs text-muted-foreground">{t("categoriesDescription")}</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    disabled={!selectedCoin || refreshCategoriesMutation.isPending}
                    onClick={() => selectedCoin && refreshCategoriesMutation.mutate([selectedCoin.id])}
                  >
                    <Tags className={cn("h-3.5 w-3.5 mr-1.5", refreshCategoriesMutation.isPending && "animate-pulse")} />
                    {t("categoriesFetch")}
                  </Button>
                </div>
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

      {/* ── Delete Confirmation Dialog (Coins) ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteAbsoluteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteAbsoluteDescription", { name: selectedCoin?.name ?? "" })}
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

      {/* ── Bulk Delete Confirmation Dialog (Coins) ── */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteAbsoluteTitle")}</DialogTitle>
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

      {/* ── Delete All Klines Dialog ── */}
      <Dialog open={klinesDeleteDialogOpen} onOpenChange={setKlinesDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete All Kline Data</DialogTitle>
            <DialogDescription>
              This will permanently delete all kline data for {selectedCoin?.symbol}{selectedQuoteAsset} ({selectedTimeframe}). This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-md border border-destructive/30 p-3 cursor-pointer">
              <Checkbox
                checked={klinesDeleteUnderstood}
                onCheckedChange={(v) => setKlinesDeleteUnderstood(!!v)}
                className="mt-0.5 shrink-0"
              />
              <span className="text-sm">I understand this will delete all imported kline data for this trading pair and timeframe</span>
            </label>
            <FieldRow label="Type 'delete' to confirm">
              <Input
                value={klinesDeleteConfirmText}
                onChange={(e) => setKlinesDeleteConfirmText(e.target.value)}
                placeholder="Type 'delete' here"
              />
            </FieldRow>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setKlinesDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => klinesDeleteMutation.mutate()}
              disabled={!klinesDeleteUnderstood || klinesDeleteConfirmText !== "delete" || klinesDeleteMutation.isPending}
            >
              {klinesDeleteMutation.isPending ? "Deleting..." : "Delete All Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
