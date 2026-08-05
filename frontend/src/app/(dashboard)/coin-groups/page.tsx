"use client"

// Coin Groups — named collections of coins (global, no customer scoping). Ported
// from gorm.ai's outlet-groups: a master table + a detail pane with Details /
// Coins / Actions tabs. The reserved "favorites" group (slug set) is fixed: it
// can't be renamed or deleted, only its membership edited. Coins are added /
// removed by picking from two columns or by pasting tickers.

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Plus, Search, Star, Trash2, Focus, ArrowUpDown,
  ChevronDown, ChevronUp, ArrowRightLeft, Lock,
} from "lucide-react"
import { Maximize } from "@/components/animate-ui/icons/maximize"
import { Minimize } from "@/components/animate-ui/icons/minimize"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  coinGroupsApi, coinsApi,
  type CoinGroup, type CoinResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "coin_count" | "starred"

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

// ─── Coin compact list (outside page component to avoid remounting) ────────────

function CoinCompactList({
  coins,
  checkedIds,
  onCheckedChange,
  emptyText,
}: {
  coins: CoinResponse[]
  checkedIds: Set<string>
  onCheckedChange: (ids: Set<string>) => void
  emptyText: string
}) {
  return (
    <div className="flex flex-col">
      {coins.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)] py-3 text-center italic">{emptyText}</p>
      ) : (
        coins.map((coin) => {
          const checked = checkedIds.has(coin.id)
          const toggle = () => {
            const n = new Set(checkedIds)
            n.has(coin.id) ? n.delete(coin.id) : n.add(coin.id)
            onCheckedChange(n)
          }
          return (
            <div
              key={coin.id}
              onClick={toggle}
              className={cn(
                "flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-[var(--muted)]/50 select-none",
                checked && "bg-[var(--muted)]/40",
              )}
            >
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <Checkbox checked={checked} onCheckedChange={toggle} />
              </div>
              <span className="text-xs font-mono font-medium shrink-0">{coin.symbol}</span>
              <span className="text-xs text-[var(--muted-foreground)] truncate">{coin.name}</span>
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const CG_STORAGE_PREFIX = "gorm:coinGroups:"

function loadCgJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${CG_STORAGE_PREFIX}${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveCgJson(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(`${CG_STORAGE_PREFIX}${key}`, JSON.stringify(value)) } catch { /* ignore */ }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CoinGroupsPage() {
  const t = useTranslations("coinGroups")
  const queryClient = useQueryClient()

  // ── Master table state (persisted)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(loadCgJson<string[]>("checked", [])))
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set(loadCgJson<string[]>("starred", [])))
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state (persisted)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => loadCgJson<string | null>("selectedGroup", null))
  const [selected, setSelected] = useState<CoinGroup | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadCgJson<string>("activeTab", "tab1"))
  const [detailMaximized, setDetailMaximized] = useState(() => loadCgJson<boolean>("detailMaximized", false))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Detail draft (name / description / notes edits)
  const [draftName, setDraftName] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const [draftNotes, setDraftNotes] = useState("")
  const isFixed = selected?.slug != null
  const isDirty = selected != null && (
    draftName !== selected.name ||
    draftDescription !== (selected.description ?? "") ||
    draftNotes !== (selected.notes ?? "")
  )

  // ── Delete / bulk-delete dialogs
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")

  // ── New group dialog
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")

  // ── Coins tab selection state
  const [currentSearch, setCurrentSearch] = useState("")
  const [currentSelectedIds, setCurrentSelectedIds] = useState<Set<string>>(new Set())
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [pendingRemoveIds, setPendingRemoveIds] = useState<string[]>([])
  const [availableSearch, setAvailableSearch] = useState("")
  const [availableSelectedIds, setAvailableSelectedIds] = useState<Set<string>>(new Set())
  // Available-coins type filters — untick to drop that type from the list.
  const [showCrypto, setShowCrypto] = useState(true)
  const [showStable, setShowStable] = useState(true)
  const [addConfirmOpen, setAddConfirmOpen] = useState(false)
  const [pendingAddIds, setPendingAddIds] = useState<string[]>([])
  const [freeInput, setFreeInput] = useState("")
  const [freeAddConfirmOpen, setFreeAddConfirmOpen] = useState(false)
  const [freeRemoveConfirmOpen, setFreeRemoveConfirmOpen] = useState(false)

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["coin-groups"],
    queryFn: () => coinGroupsApi.list(),
  })
  const { data: coins = [] } = useQuery({
    queryKey: ["coins"],
    queryFn: () => coinsApi.list({ limit: 1000 }),
  })

  // ── Persist state ──────────────────────────────────────────────────────────
  useEffect(() => { saveCgJson("checked", [...selectedIds]) }, [selectedIds])
  useEffect(() => { saveCgJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveCgJson("activeTab", activeTab) }, [activeTab])
  useEffect(() => { saveCgJson("selectedGroup", selected?.id ?? null) }, [selected?.id])
  useEffect(() => { saveCgJson("detailMaximized", detailMaximized) }, [detailMaximized])

  // Keep the selected group object in sync with the freshest list data, and
  // restore it from the persisted id on first load.
  useEffect(() => {
    if (!groups.length) return
    if (selected) {
      const fresh = groups.find((g) => g.id === selected.id)
      if (fresh && fresh !== selected) setSelected(fresh)
    } else if (selectedGroupId) {
      const found = groups.find((g) => g.id === selectedGroupId)
      if (found) setSelected(found)
    }
  }, [groups]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync draft when selected changes ─────────────────────────────────────
  useEffect(() => {
    if (selected) {
      setDraftName(selected.name)
      setDraftDescription(selected.description ?? "")
      setDraftNotes(selected.notes ?? "")
      setCurrentSelectedIds(new Set())
      setAvailableSelectedIds(new Set())
      setCurrentSearch("")
      setAvailableSearch("")
      setFreeInput("")
    }
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tab indicator ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selected])

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const invalidateGroups = () => queryClient.invalidateQueries({ queryKey: ["coin-groups"] })
  // Members changed → also refresh the favorites set the coins page hearts use.
  const afterMembers = (updated: CoinGroup) => {
    setSelected(updated)
    invalidateGroups()
    if (updated.slug === "favorites") queryClient.invalidateQueries({ queryKey: ["coinGroups", "favorites"] })
  }

  const createMutation = useMutation({
    mutationFn: () => coinGroupsApi.create({ name: newName, description: newDescription || null }),
    onSuccess: (created) => {
      invalidateGroups()
      setNewDialogOpen(false)
      setNewName("")
      setNewDescription("")
      setSelected(created)
      toast.success(t("toastCreated", { name: created.name }))
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string | null; notes: string | null }) =>
      coinGroupsApi.update(selected!.id, data),
    onSuccess: (updated) => {
      invalidateGroups()
      setSelected(updated)
      toast.success(t("toastUpdated", { name: updated.name }))
    },
    onError: () => toast.error(t("toastUpdateError")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => coinGroupsApi.delete(id),
    onSuccess: (_, id) => {
      invalidateGroups()
      if (selected?.id === id) setSelected(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  const addMembersMutation = useMutation({
    mutationFn: (coinIds: string[]) => coinGroupsApi.addMembers(selected!.id, coinIds),
    onSuccess: (updated, ids) => { afterMembers(updated); toast.success(t("toastBulkAdded", { count: ids.length })) },
    onError: () => toast.error(t("toastCoinAddError")),
  })

  const removeMembersMutation = useMutation({
    mutationFn: (coinIds: string[]) => coinGroupsApi.removeMembers(selected!.id, coinIds),
    onSuccess: (updated) => { afterMembers(updated); toast.success(t("toastCoinRemoved")) },
    onError: () => toast.error(t("toastCoinRemoveError")),
  })

  // ─── Derived / filtering / sorting / pagination ───────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected ? groups.filter((g) => selectedIds.has(g.id)) : groups
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((g) => g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q))
    }
    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name":       va = a.name; vb = b.name; break
        case "coin_count": va = a.member_coin_ids.length; vb = b.member_coin_ids.length; break
        case "starred":    va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [groups, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ─── Coins tab derived data ───────────────────────────────────────────────

  const memberIds = useMemo(() => new Set(selected?.member_coin_ids ?? []), [selected])
  const coinBySymbol = useMemo(() => {
    const m = new Map<string, CoinResponse>()
    for (const c of coins) m.set(c.symbol.toUpperCase(), c)
    return m
  }, [coins])

  const filteredCurrentCoins = useMemo(() => {
    const current = coins.filter((c) => memberIds.has(c.id)).sort((a, b) => a.symbol.localeCompare(b.symbol))
    if (!currentSearch.trim()) return current
    const q = currentSearch.toLowerCase()
    return current.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
  }, [coins, memberIds, currentSearch])

  const filteredAvailableCoins = useMemo(() => {
    const available = coins
      .filter((c) => !memberIds.has(c.id) && c.active)
      .filter((c) => (c.type === "stablecoin" ? showStable : showCrypto))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
    if (!availableSearch.trim()) return available
    const q = availableSearch.toLowerCase()
    return available.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
  }, [coins, memberIds, availableSearch, showCrypto, showStable])

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((g) => selectedIds.has(g.id))
  const somePageSelected = pageItems.some((g) => selectedIds.has(g.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((g) => n.delete(g.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((g) => { if (g.slug == null) n.add(g.id) }); return n })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleSaveChanges() {
    if (!selected) return
    updateMutation.mutate({
      name: draftName.trim() || selected.name,
      description: draftDescription || null,
      notes: draftNotes || null,
    })
  }
  function handleCancelChanges() {
    if (!selected) return
    setDraftName(selected.name)
    setDraftDescription(selected.description ?? "")
    setDraftNotes(selected.notes ?? "")
  }

  // Add / remove via the two-column selection
  function openRemoveConfirm() { setPendingRemoveIds([...currentSelectedIds]); setRemoveConfirmOpen(true) }
  async function handleRemoveSelected() {
    await removeMembersMutation.mutateAsync(pendingRemoveIds)
    setCurrentSelectedIds(new Set())
    setRemoveConfirmOpen(false)
  }
  function openAddConfirm() { setPendingAddIds([...availableSelectedIds]); setAddConfirmOpen(true) }
  async function handleAddSelected() {
    await addMembersMutation.mutateAsync(pendingAddIds)
    setAvailableSelectedIds(new Set())
    setAddConfirmOpen(false)
  }

  // Free input add/remove (comma-separated tickers)
  function parseFreeTickers(): string[] {
    return freeInput.split(",").map((s) => s.trim()).filter(Boolean)
  }
  function resolveTickers(tickers: string[]): { ids: string[]; notFound: string[] } {
    const ids: string[] = []
    const notFound: string[] = []
    for (const tk of tickers) {
      const coin = coinBySymbol.get(tk.toUpperCase())
      if (coin) ids.push(coin.id)
      else notFound.push(tk)
    }
    return { ids, notFound }
  }
  function reportNotFound(notFound: string[]) {
    if (notFound.length === 0) return
    const preview = notFound.slice(0, 10).join(", ")
    const suffix = notFound.length > 10 ? ` (+${notFound.length - 10})` : ""
    toast.error(t("coinsNotFound", { count: notFound.length, ids: preview + suffix }))
  }
  async function confirmFreeAdd() {
    const { ids, notFound } = resolveTickers(parseFreeTickers())
    reportNotFound(notFound)
    if (ids.length > 0) await addMembersMutation.mutateAsync(ids)
    setFreeInput("")
    setFreeAddConfirmOpen(false)
  }
  async function confirmFreeRemove() {
    const { ids, notFound } = resolveTickers(parseFreeTickers())
    reportNotFound(notFound)
    if (ids.length > 0) await removeMembersMutation.mutateAsync(ids)
    setFreeInput("")
    setFreeRemoveConfirmOpen(false)
  }

  // Delete handlers
  function openDeleteDialog() { setDeleteUnderstood(false); setDeleteConfirmText(""); setDeleteDialogOpen(true) }
  async function handleDelete() {
    if (!selected) return
    await deleteMutation.mutateAsync(selected.id)
    setDeleteDialogOpen(false)
    setSelected(null)
  }
  function openBulkDeleteDialog() { setBulkDeleteUnderstood(false); setBulkDeleteConfirmText(""); setBulkDeleteDialogOpen(true) }
  async function handleBulkDelete() {
    // Skip fixed (slug) groups — they can't be deleted.
    const deletable = [...selectedIds].filter((id) => groups.find((g) => g.id === id)?.slug == null)
    for (const id of deletable) await deleteMutation.mutateAsync(id)
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

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className={cn("flex flex-col shrink-0", detailMaximized && "hidden")}>
        <div className="flex items-center justify-between px-4 py-2 shrink-0 bg-background">
          <Button size="sm" className="h-7 gap-1.5 px-2 cursor-pointer" onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
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

        <div className="overflow-y-auto max-h-[45vh]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--muted-foreground)]">
              <p className="text-sm">{t("noGroups")}</p>
              <p className="text-xs opacity-60">{t("noGroupsHint")}</p>
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
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(groups.filter((g) => g.slug == null).map((g) => g.id)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(groups.filter((g) => starredIds.has(g.id)).map((g) => g.id)))}>
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="coin_count" label={t("colCoinCount")} /></TableHead>
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
                {pageItems.map((group) => (
                  <TableRow
                    key={group.id}
                    data-state={selected?.id === group.id ? "selected" : undefined}
                    onClick={() => { setSelected(group); setActiveTab("tab1") }}
                    onContextMenu={(e) => { e.preventDefault(); handleStar(group.id) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(group.id)}
                        disabled={group.slug != null}
                        onCheckedChange={(c) => setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(group.id) : n.delete(group.id); return n })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {group.name}
                        {group.slug != null && <Lock className="h-3 w-3 text-[var(--muted-foreground)]" />}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)] tabular-nums">{group.member_coin_ids.length}</TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleStar(group.id)} className="hover:text-amber-400 transition-colors cursor-pointer" aria-label="Toggle star">
                        <Star className={cn("h-4 w-4", starredIds.has(group.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
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
        <div className={cn("flex-1 flex flex-col min-h-0 overflow-hidden", !detailMaximized && "border-t")}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
            <div className="relative w-full">
              <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabCoins")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabActions")}</TabsTrigger>
                <div
                  className="ml-auto flex items-center pr-2 pl-3 mb-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setDetailMaximized((v) => !v)}
                  aria-label={detailMaximized ? "Minimize" : "Maximize"}
                >
                  {detailMaximized ? <Minimize size={16} animateOnHover /> : <Maximize size={16} animateOnHover />}
                </div>
              </TabsList>
              <div className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0" style={{ left: indicatorStyle.left, width: indicatorStyle.width }} />
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ─ Details ─ */}
              <TabsContent value="tab1" className="space-y-4 max-w-2xl mt-6 px-4 pb-20">
                {isFixed && (
                  <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                    <Lock className="h-3 w-3" /> {t("fixedGroupNote")}
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldId")}</label>
                  <div className="relative">
                    <Input value={selected.id} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono text-xs" />
                    <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                      <CopyIcon
                        size={16}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => { navigator.clipboard.writeText(selected.id); toast.success(t("toastCopied")) }}
                      />
                    </AnimateIcon>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldName")}</label>
                  <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={isFixed} className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldDescription")}</label>
                  <Textarea
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    placeholder={t("fieldDescriptionPlaceholder")}
                    className="text-sm min-h-[70px] resize-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldNotes")}</label>
                  <Textarea
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    placeholder={t("fieldNotesPlaceholder")}
                    className="text-sm min-h-[100px] resize-none"
                  />
                </div>
              </TabsContent>

              {/* ─ Coins ─ */}
              <TabsContent value="tab2" className="mt-3 px-3 pb-3 h-[calc(100%-2rem)]">
                <div className="flex gap-0 h-full min-h-[200px]">

                  {/* Column 1: Available coins */}
                  <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <h4 className="text-xs font-semibold truncate">{t("availableCoins")}</h4>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer"
                        onClick={() => setAvailableSelectedIds((prev) => { const n = new Set(prev); filteredAvailableCoins.forEach((c) => n.add(c.id)); return n })}
                      >
                        {t("selectAll")}
                      </Button>
                      {availableSelectedIds.size > 0 && (
                        <>
                          <Button size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={() => setAvailableSelectedIds(new Set())}>
                            {t("deselectAll")}
                          </Button>
                          <Button size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={openAddConfirm}>
                            {t("addSelected")} ({availableSelectedIds.size})
                          </Button>
                        </>
                      )}
                      {/* Type filters — untick to drop that type from the list */}
                      <div className="ml-auto flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[10px] cursor-pointer select-none">
                          <Checkbox checked={showCrypto} onCheckedChange={(v) => setShowCrypto(!!v)} className="h-3 w-3" />
                          {t("typeCrypto")}
                        </label>
                        <label className="flex items-center gap-1 text-[10px] cursor-pointer select-none">
                          <Checkbox checked={showStable} onCheckedChange={(v) => setShowStable(!!v)} className="h-3 w-3" />
                          {t("typeStable")}
                        </label>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--muted-foreground)]" />
                      <Input placeholder={t("availableCoinsSearch")} value={availableSearch} onChange={(e) => setAvailableSearch(e.target.value)} className="h-6 pl-6 text-[11px]" />
                    </div>
                    <div className="flex-1 border rounded overflow-y-auto min-h-[100px]">
                      <CoinCompactList coins={filteredAvailableCoins} checkedIds={availableSelectedIds} onCheckedChange={setAvailableSelectedIds} emptyText={t("noAvailableCoins")} />
                    </div>
                  </div>

                  <div className="flex items-center justify-center w-8 shrink-0 pt-10">
                    <ArrowRightLeft className="h-4 w-4 text-[var(--muted-foreground)]" />
                  </div>

                  {/* Column 2: Coins in group */}
                  <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <h4 className="text-xs font-semibold truncate">{t("currentCoins")}</h4>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={() => setCurrentSelectedIds(new Set(filteredCurrentCoins.map((c) => c.id)))}>
                        {t("selectAll")}
                      </Button>
                      {currentSelectedIds.size > 0 && (
                        <>
                          <Button size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={() => setCurrentSelectedIds(new Set())}>
                            {t("deselectAll")}
                          </Button>
                          <Button
                            size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer"
                            onClick={() => {
                              const syms = coins.filter((c) => currentSelectedIds.has(c.id)).map((c) => c.symbol).join(", ")
                              setFreeInput((prev) => prev ? `${prev}, ${syms}` : syms)
                            }}
                          >
                            {t("exportList")}
                          </Button>
                          <Button variant="destructive" size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={openRemoveConfirm}>
                            {t("removeSelected")} ({currentSelectedIds.size})
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--muted-foreground)]" />
                      <Input placeholder={t("currentCoinsSearch")} value={currentSearch} onChange={(e) => setCurrentSearch(e.target.value)} className="h-6 pl-6 text-[11px]" />
                    </div>
                    <div className="flex-1 border rounded overflow-y-auto min-h-[100px]">
                      <CoinCompactList coins={filteredCurrentCoins} checkedIds={currentSelectedIds} onCheckedChange={setCurrentSelectedIds} emptyText={t("noCurrentCoins")} />
                    </div>
                  </div>

                  {/* Column 3: Free input by ticker */}
                  <div className="flex flex-col gap-1.5 w-56 shrink-0 ml-3">
                    <h4 className="text-xs font-semibold">{t("freeInput")}</h4>
                    <div className="flex gap-1">
                      <Button size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={() => freeInput.trim() && setFreeAddConfirmOpen(true)} disabled={!freeInput.trim()}>
                        {t("freeInputAdd")}
                      </Button>
                      <Button variant="destructive" size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={() => freeInput.trim() && setFreeRemoveConfirmOpen(true)} disabled={!freeInput.trim()}>
                        {t("freeInputRemove")}
                      </Button>
                    </div>
                    <p className="text-[10px] text-[var(--muted-foreground)] leading-tight">{t("freeInputHint")}</p>
                    <Textarea value={freeInput} onChange={(e) => setFreeInput(e.target.value)} placeholder={t("freeInputPlaceholder")} className="flex-1 text-xs resize-none min-h-[100px] font-mono" />
                  </div>

                </div>
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="tab3" className="max-w-2xl mt-6 px-4">
                {isFixed ? (
                  <p className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                    <Lock className="h-4 w-4" /> {t("fixedGroupNote")}
                  </p>
                ) : (
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
                )}
              </TabsContent>

            </div>
          </Tabs>

          {/* Save / Cancel bar */}
          {isDirty && (
            <div className="shrink-0 border-t bg-[var(--muted)]/30 px-4 py-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 cursor-pointer" onClick={handleCancelChanges}>{t("cancelChanges")}</Button>
              <Button size="sm" className="h-7 cursor-pointer" onClick={handleSaveChanges} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("saving") : t("saveChanges")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── New group dialog ── */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldName")}</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("fieldNamePlaceholder")}
                onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createMutation.mutate() }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldDescription")}</label>
              <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder={t("fieldDescriptionPlaceholder")} className="resize-none min-h-[70px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setNewDialogOpen(false)}>{t("cancel")}</Button>
            <Button size="sm" onClick={() => createMutation.mutate()} disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? t("creating") : t("createButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove confirm ── */}
      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("removeConfirmDescription", { count: pendingRemoveIds.length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setRemoveConfirmOpen(false)}>{t("deleteCancel")}</Button>
            <Button variant="destructive" size="sm" onClick={handleRemoveSelected} disabled={removeMembersMutation.isPending}>{t("removeConfirmButton")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add confirm ── */}
      <Dialog open={addConfirmOpen} onOpenChange={setAddConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("addConfirmDescription", { count: pendingAddIds.length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setAddConfirmOpen(false)}>{t("deleteCancel")}</Button>
            <Button size="sm" onClick={handleAddSelected} disabled={addMembersMutation.isPending}>{t("addConfirmButton")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Free add confirm ── */}
      <Dialog open={freeAddConfirmOpen} onOpenChange={setFreeAddConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("freeAddConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("freeAddConfirmDescription", { count: parseFreeTickers().length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setFreeAddConfirmOpen(false)}>{t("deleteCancel")}</Button>
            <Button size="sm" onClick={confirmFreeAdd} disabled={addMembersMutation.isPending}>{t("freeAddConfirmButton")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Free remove confirm ── */}
      <Dialog open={freeRemoveConfirmOpen} onOpenChange={setFreeRemoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("freeRemoveConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("freeRemoveConfirmDescription", { count: parseFreeTickers().length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setFreeRemoveConfirmOpen(false)}>{t("deleteCancel")}</Button>
            <Button variant="destructive" size="sm" onClick={confirmFreeRemove} disabled={removeMembersMutation.isPending}>{t("freeRemoveConfirmButton")}</Button>
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
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleteDialogOpen(false)}>{t("deleteCancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={handleDelete}
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
              <Input value={bulkDeleteConfirmText} onChange={(e) => setBulkDeleteConfirmText(e.target.value)} placeholder={t("deleteTypePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)}>{t("deleteCancel")}</Button>
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
