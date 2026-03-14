"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Plus, Search, Star, Trash2, Focus, ArrowUpDown,
  ChevronDown, ChevronUp, ArrowRightLeft,
} from "lucide-react"
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
import { useCustomer } from "@/components/providers/customer-provider"
import {
  outletGroupsApi, outletsApi,
  type OutletGroupResponse, type OutletResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
const OUTLET_ITEMS_PER_PAGE = 100
type SortField = "name" | "outlet_count" | "starred"

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

// ─── Outlet compact list (must be outside page component to avoid remounting) ──

function OutletCompactList({
  outlets,
  checkedIds,
  onCheckedChange,
  emptyText,
}: {
  outlets: OutletResponse[]
  checkedIds: Set<string>
  onCheckedChange: (ids: Set<string>) => void
  emptyText: string
}) {
  return (
    <div className="flex flex-col">
      {outlets.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)] py-3 text-center italic">{emptyText}</p>
      ) : (
        outlets.map((outlet) => {
          const checked = checkedIds.has(outlet.id)
          return (
            <div
              key={outlet.id}
              onClick={() => {
                const n = new Set(checkedIds)
                n.has(outlet.id) ? n.delete(outlet.id) : n.add(outlet.id)
                onCheckedChange(n)
              }}
              className={cn(
                "flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-[var(--muted)]/50 select-none",
                checked && "bg-[var(--muted)]/40"
              )}
            >
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => {
                    const n = new Set(checkedIds)
                    n.has(outlet.id) ? n.delete(outlet.id) : n.add(outlet.id)
                    onCheckedChange(n)
                  }}
                />
              </div>
              <span className="text-xs font-mono text-[var(--muted-foreground)] shrink-0">{outlet.ext_id}</span>
              <span className="text-xs truncate">{outlet.name}</span>
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OutletGroupsPage() {
  const t = useTranslations("outletGroups")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()

  // ── Master table state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)

  // ── Detail pane state
  const [selected, setSelected] = useState<OutletGroupResponse | null>(null)
  const [activeTab, setActiveTab] = useState("tab1")
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Detail draft (name / description edits)
  const [draftName, setDraftName] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const isDirty = selected != null && (draftName !== selected.name || draftDescription !== (selected.description ?? ""))

  // ── Bulk delete dialog
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Single delete dialog (from Actions tab)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")

  // ── New group dialog
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")

  // ── Outlets tab: current outlets selection
  const [currentSearch, setCurrentSearch] = useState("")
  const [currentSelectedIds, setCurrentSelectedIds] = useState<Set<string>>(new Set())
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [pendingRemoveIds, setPendingRemoveIds] = useState<string[]>([])

  // ── Outlets tab: available outlets selection
  const [availableSearch, setAvailableSearch] = useState("")
  const [availableSelectedIds, setAvailableSelectedIds] = useState<Set<string>>(new Set())
  const [addConfirmOpen, setAddConfirmOpen] = useState(false)
  const [pendingAddIds, setPendingAddIds] = useState<string[]>([])

  // ── Outlets tab: free input
  const [freeInput, setFreeInput] = useState("")
  const [freeAddConfirmOpen, setFreeAddConfirmOpen] = useState(false)
  const [freeRemoveConfirmOpen, setFreeRemoveConfirmOpen] = useState(false)

  // ─── Data fetching ───────────────────────────────────────────────────────

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["outlet-groups", activeCustomer?.id],
    queryFn: () => outletGroupsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  const { data: groupOutlets = [], refetch: refetchGroupOutlets } = useQuery({
    queryKey: ["outlet-group-outlets", selected?.id],
    queryFn: () => outletGroupsApi.getOutlets(selected!.id),
    enabled: !!selected,
  })

  const { data: allOutlets = [] } = useQuery({
    queryKey: ["outlets", activeCustomer?.id],
    queryFn: () => outletsApi.list(activeCustomer!.id, { limit: 5000 }),
    enabled: !!activeCustomer,
  })

  // ─── Sync draft when selected changes ───────────────────────────────────

  useEffect(() => {
    if (selected) {
      setDraftName(selected.name)
      setDraftDescription(selected.description ?? "")
      setCurrentSelectedIds(new Set())
      setAvailableSelectedIds(new Set())
      setCurrentSearch("")
      setAvailableSearch("")
      setFreeInput("")
    }
  }, [selected?.id])

  // ─── Tab indicator ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selected])

  // ─── Mutations ───────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () => outletGroupsApi.create({
      customer_id: activeCustomer!.id,
      name: newName,
      description: newDescription || null,
    }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["outlet-groups"] })
      setNewDialogOpen(false)
      setNewName("")
      setNewDescription("")
      setSelected(created)
      setDraftName(created.name)
      setDraftDescription(created.description ?? "")
      toast.success(t("toastCreated", { name: created.name }))
    },
    onError: () => toast.error(t("toastCreateError")),
  })

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string | null }) =>
      outletGroupsApi.update(selected!.id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["outlet-groups"] })
      setSelected(updated)
      toast.success(t("toastUpdated", { name: updated.name }))
    },
    onError: () => toast.error(t("toastUpdateError")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => outletGroupsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["outlet-groups"] })
      if (selected?.id === id) setSelected(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => toast.error(t("toastDeleteError")),
  })

  const addOutletsBulkMutation = useMutation({
    mutationFn: (outletIds: string[]) => outletGroupsApi.addOutletsBulk(selected!.id, outletIds),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["outlet-group-outlets"] })
      queryClient.invalidateQueries({ queryKey: ["outlet-groups"] })
      const parts: string[] = []
      if (result.added > 0) parts.push(t("toastBulkAdded", { count: result.added }))
      if (result.duplicates > 0) parts.push(t("toastBulkDuplicates", { count: result.duplicates }))
      toast.success(parts.join("\n"))
    },
    onError: () => toast.error(t("toastOutletAddError")),
  })

  const removeOutletMutation = useMutation({
    mutationFn: (outletId: string) => outletGroupsApi.removeOutlet(selected!.id, outletId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outlet-group-outlets"] })
      queryClient.invalidateQueries({ queryKey: ["outlet-groups"] })
      toast.success(t("toastOutletRemoved"))
    },
    onError: () => toast.error(t("toastOutletRemoveError")),
  })

  // ─── Derived / filtering / sorting / pagination ───────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? groups.filter((g) => selectedIds.has(g.id))
      : groups

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((g) => g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q))
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "name":         va = a.name;          vb = b.name;          break
        case "outlet_count": va = a.outlet_count;  vb = b.outlet_count;  break
        case "starred":      va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [groups, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ─── Outlets tab derived data ─────────────────────────────────────────────

  const groupOutletIds = useMemo(() => new Set(groupOutlets.map((o) => o.id)), [groupOutlets])

  const filteredCurrentOutlets = useMemo(() => {
    if (!currentSearch.trim()) return groupOutlets
    const q = currentSearch.toLowerCase()
    return groupOutlets.filter((o) => o.name.toLowerCase().includes(q) || o.ext_id.toLowerCase().includes(q))
  }, [groupOutlets, currentSearch])

  const filteredAvailableOutlets = useMemo(() => {
    const available = allOutlets.filter((o) => !groupOutletIds.has(o.id) && o.active)
    if (!availableSearch.trim()) return available
    const q = availableSearch.toLowerCase()
    return available.filter((o) => o.name.toLowerCase().includes(q) || o.ext_id.toLowerCase().includes(q))
  }, [allOutlets, groupOutletIds, availableSearch])

  // ─── Handlers ────────────────────────────────────────────────────────────

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
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((g) => n.add(g.id)); return n })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleSelectGroup(group: OutletGroupResponse) {
    setSelected(group)
    setActiveTab("tab1")
  }

  function handleSaveChanges() {
    if (!selected) return
    updateMutation.mutate({ name: draftName, description: draftDescription || null })
  }

  function handleCancelChanges() {
    if (!selected) return
    setDraftName(selected.name)
    setDraftDescription(selected.description ?? "")
  }

  // ── Remove outlets from group
  function openRemoveConfirm() {
    setPendingRemoveIds(Array.from(currentSelectedIds))
    setRemoveConfirmOpen(true)
  }

  async function handleRemoveSelected() {
    for (const id of pendingRemoveIds) await removeOutletMutation.mutateAsync(id)
    setCurrentSelectedIds(new Set())
    setRemoveConfirmOpen(false)
  }

  // ── Add outlets to group
  function openAddConfirm() {
    setPendingAddIds(Array.from(availableSelectedIds))
    setAddConfirmOpen(true)
  }

  async function handleAddSelected() {
    await addOutletsBulkMutation.mutateAsync(pendingAddIds)
    setAvailableSelectedIds(new Set())
    setAddConfirmOpen(false)
  }

  // ── Free input add/remove (comma-separated ext_ids)
  function parseFreeInputIds(): string[] {
    return freeInput.split(",").map((s) => s.trim()).filter(Boolean)
  }

  function handleFreeAdd() {
    if (!freeInput.trim()) return
    setFreeAddConfirmOpen(true)
  }

  function handleFreeRemove() {
    if (!freeInput.trim()) return
    setFreeRemoveConfirmOpen(true)
  }

  async function confirmFreeAdd() {
    const extIds = parseFreeInputIds()
    const outletIds: string[] = []
    const notFound: string[] = []
    for (const extId of extIds) {
      const outlet = allOutlets.find((o) => o.ext_id === extId)
      if (!outlet) { notFound.push(extId); continue }
      outletIds.push(outlet.id)
    }
    if (notFound.length > 0) {
      const preview = notFound.slice(0, 10).join(", ")
      const suffix = notFound.length > 10 ? ` (+${notFound.length - 10})` : ""
      toast.error(t("outletsNotFound", { count: notFound.length, ids: preview + suffix }))
    }
    if (outletIds.length > 0) await addOutletsBulkMutation.mutateAsync(outletIds)
    setFreeInput("")
    setFreeAddConfirmOpen(false)
  }

  async function confirmFreeRemove() {
    const extIds = parseFreeInputIds()
    const notFound: string[] = []
    for (const extId of extIds) {
      const outlet = allOutlets.find((o) => o.ext_id === extId)
      if (!outlet) { notFound.push(extId); continue }
      await removeOutletMutation.mutateAsync(outlet.id)
    }
    if (notFound.length > 0) {
      const preview = notFound.slice(0, 10).join(", ")
      const suffix = notFound.length > 10 ? ` (+${notFound.length - 10})` : ""
      toast.error(t("outletsNotFound", { count: notFound.length, ids: preview + suffix }))
    }
    setFreeInput("")
    setFreeRemoveConfirmOpen(false)
  }

  // ── Delete handlers
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
    for (const id of Array.from(selectedIds)) await deleteMutation.mutateAsync(id)
    setSelectedIds(new Set())
    setBulkDeleteDialogOpen(false)
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 font-medium hover:text-foreground transition-colors text-left"
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
      <div className="flex flex-col shrink-0">
        {/* Toolbar */}
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

        {/* Table */}
        <div className="overflow-y-auto max-h-[45vh]">
          {isLoading || !activeCustomer ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">
              Loading…
            </div>
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
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(groups.map((g) => g.id)))}>
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
                  <TableHead><SortHeader field="outlet_count" label={t("colOutletCount")} /></TableHead>
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
                    onClick={() => handleSelectGroup(group)}
                    onContextMenu={(e) => { e.preventDefault(); handleStar(group.id) }}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(group.id)}
                        onCheckedChange={(c) => setSelectedIds((prev) => { const n = new Set(prev); c ? n.add(group.id) : n.delete(group.id); return n })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{group.name}</TableCell>
                    <TableCell className="text-sm text-[var(--muted-foreground)]">{group.outlet_count}</TableCell>
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
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-t">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
            <div className="relative w-full">
              <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab1">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab2">{t("tabOutlets")}</TabsTrigger>
                <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="tab3">{t("tabActions")}</TabsTrigger>
              </TabsList>
              <div
                className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
                style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
              />
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ─ Details ─ */}
              <TabsContent value="tab1" className="space-y-4 max-w-2xl mt-6 px-4 pb-20">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">ID</label>
                  <span className="text-sm font-mono opacity-60">{selected.id}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldName")}</label>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldDescription")}</label>
                  <Textarea
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    placeholder={t("fieldDescriptionPlaceholder")}
                    className="text-sm min-h-[80px] resize-none"
                  />
                </div>
              </TabsContent>

              {/* ─ Outlets ─ */}
              <TabsContent value="tab2" className="mt-3 px-3 pb-3 h-[calc(100%-2rem)]">
                <div className="flex gap-0 h-full min-h-[200px]">

                  {/* Column 1: Available Outlets */}
                  <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <h4 className="text-xs font-semibold truncate">{t("availableOutlets")}</h4>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        className="h-5 text-[10px] px-1.5 cursor-pointer"
                        onClick={() => {
                          const n = new Set(availableSelectedIds)
                          filteredAvailableOutlets.forEach((o) => n.add(o.id))
                          setAvailableSelectedIds(n)
                        }}
                      >
                        {t("selectAll")}
                      </Button>
                      {availableSelectedIds.size > 0 && (
                        <>
                          <Button
                            size="sm"
                            className="h-5 text-[10px] px-1.5 cursor-pointer"
                            onClick={() => setAvailableSelectedIds(new Set())}
                          >
                            {t("deselectAll")}
                          </Button>
                          <Button size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={openAddConfirm}>
                            {t("addSelected")} ({availableSelectedIds.size})
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--muted-foreground)]" />
                      <Input
                        placeholder={t("availableOutletsSearch")}
                        value={availableSearch}
                        onChange={(e) => setAvailableSearch(e.target.value)}
                        className="h-6 pl-6 text-[11px]"
                      />
                    </div>
                    <div className="flex-1 border rounded overflow-y-auto min-h-[100px]">
                      <OutletCompactList
                        outlets={filteredAvailableOutlets}
                        checkedIds={availableSelectedIds}
                        onCheckedChange={setAvailableSelectedIds}
                        emptyText={t("noAvailableOutlets")}
                      />
                    </div>
                  </div>

                  {/* Arrow separator */}
                  <div className="flex items-center justify-center w-8 shrink-0 pt-10">
                    <ArrowRightLeft className="h-4 w-4 text-[var(--muted-foreground)]" />
                  </div>

                  {/* Column 2: Outlets in Group */}
                  <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <h4 className="text-xs font-semibold truncate">{t("currentOutlets")}</h4>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        className="h-5 text-[10px] px-1.5 cursor-pointer"
                        onClick={() => {
                          const n = new Set(filteredCurrentOutlets.map((o) => o.id))
                          setCurrentSelectedIds(n)
                        }}
                      >
                        {t("selectAll")}
                      </Button>
                      {currentSelectedIds.size > 0 && (
                        <>
                          <Button
                            size="sm"
                            className="h-5 text-[10px] px-1.5 cursor-pointer"
                            onClick={() => setCurrentSelectedIds(new Set())}
                          >
                            {t("deselectAll")}
                          </Button>
                          <Button
                            size="sm"
                            className="h-5 text-[10px] px-1.5 cursor-pointer"
                            onClick={() => {
                              const ids = groupOutlets
                                .filter((o) => currentSelectedIds.has(o.id))
                                .map((o) => o.ext_id)
                                .join(", ")
                              setFreeInput((prev) => prev ? `${prev}, ${ids}` : ids)
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
                      <Input
                        placeholder={t("currentOutletsSearch")}
                        value={currentSearch}
                        onChange={(e) => setCurrentSearch(e.target.value)}
                        className="h-6 pl-6 text-[11px]"
                      />
                    </div>
                    <div className="flex-1 border rounded overflow-y-auto min-h-[100px]">
                      <OutletCompactList
                        outlets={filteredCurrentOutlets}
                        checkedIds={currentSelectedIds}
                        onCheckedChange={setCurrentSelectedIds}
                        emptyText={t("noCurrentOutlets")}
                      />
                    </div>
                  </div>

                  {/* Column 3: Free input */}
                  <div className="flex flex-col gap-1.5 w-56 shrink-0 ml-3">
                    <h4 className="text-xs font-semibold">{t("freeInput")}</h4>
                    <div className="flex gap-1">
                      <Button size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={handleFreeAdd} disabled={!freeInput.trim()}>
                        {t("freeInputAdd")}
                      </Button>
                      <Button variant="destructive" size="sm" className="h-5 text-[10px] px-1.5 cursor-pointer" onClick={handleFreeRemove} disabled={!freeInput.trim()}>
                        {t("freeInputRemove")}
                      </Button>
                    </div>
                    <p className="text-[10px] text-[var(--muted-foreground)] leading-tight">{t("freeInputHint")}</p>
                    <Textarea
                      value={freeInput}
                      onChange={(e) => setFreeInput(e.target.value)}
                      placeholder={t("freeInputPlaceholder")}
                      className="flex-1 text-xs resize-none min-h-[100px] font-mono"
                    />
                  </div>

                </div>
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="tab3" className="max-w-2xl mt-6 px-4">
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

          {/* ── Save / Cancel bar ── */}
          {isDirty && (
            <div className="shrink-0 border-t bg-[var(--muted)]/30 px-4 py-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 cursor-pointer" onClick={handleCancelChanges}>
                {t("cancelChanges")}
              </Button>
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
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t("fieldDescriptionPlaceholder")}
                className="resize-none min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setNewDialogOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm" onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? t("creating") : t("createButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove outlets confirm ── */}
      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("removeConfirmDescription", { count: pendingRemoveIds.length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setRemoveConfirmOpen(false)}>{t("deleteCancel")}</Button>
            <Button variant="destructive" size="sm" onClick={handleRemoveSelected} disabled={removeOutletMutation.isPending}>
              {t("removeConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add outlets confirm ── */}
      <Dialog open={addConfirmOpen} onOpenChange={setAddConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("addConfirmDescription", { count: pendingAddIds.length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setAddConfirmOpen(false)}>{t("deleteCancel")}</Button>
            <Button size="sm" onClick={handleAddSelected} disabled={addOutletsBulkMutation.isPending}>
              {t("addConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Free add confirm ── */}
      <Dialog open={freeAddConfirmOpen} onOpenChange={setFreeAddConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("freeAddConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("freeAddConfirmDescription", { count: parseFreeInputIds().length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setFreeAddConfirmOpen(false)}>{t("deleteCancel")}</Button>
            <Button size="sm" onClick={confirmFreeAdd} disabled={addOutletsBulkMutation.isPending}>
              {t("freeAddConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Free remove confirm ── */}
      <Dialog open={freeRemoveConfirmOpen} onOpenChange={setFreeRemoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("freeRemoveConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("freeRemoveConfirmDescription", { count: parseFreeInputIds().length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setFreeRemoveConfirmOpen(false)}>{t("deleteCancel")}</Button>
            <Button variant="destructive" size="sm" onClick={confirmFreeRemove} disabled={removeOutletMutation.isPending}>
              {t("freeRemoveConfirmButton")}
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
