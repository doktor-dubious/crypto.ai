"use client"

import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown,
  ChevronDown, ChevronUp,
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
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { customersApi, type CustomerResponse, type CustomerUpdate } from "@/lib/api"

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

const STORAGE_PREFIX = "gorm:customers:"

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

export default function CustomersPage() {
  const t = useTranslations("customersPage")
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
  const [detailMaximized, setDetailMaximized] = useState(() => loadJson<boolean>("detailMaximized", false))
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(() => loadJson<string | null>("selectedCustomer", null))
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResponse | null>(null)
  const [activeTab, setActiveTab] = useState(() => loadJson<string>("activeTab", "details"))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
  const [draft, setDraft] = useState<CustomerUpdate>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteUnderstood, setDeleteUnderstood] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list(),
  })

  // ── Persist state to localStorage ──────────────────────────────────────────

  useEffect(() => { saveJson("checked", [...selectedIds]) }, [selectedIds])
  useEffect(() => { saveJson("starred", [...starredIds]) }, [starredIds])
  useEffect(() => { saveJson("activeTab", activeTab) }, [activeTab])
  useEffect(() => { saveJson("detailMaximized", detailMaximized) }, [detailMaximized])
  useEffect(() => { saveJson("selectedCustomer", selectedCustomer?.id ?? null) }, [selectedCustomer?.id])

  // ── Restore selected customer from persisted ID when list loads ────────────

  useEffect(() => {
    if (!customers.length || selectedCustomer) return
    if (selectedCustomerId) {
      const found = customers.find((c) => c.id === selectedCustomerId)
      if (found) setSelectedCustomer(found)
    }
  }, [customers.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mutations ─────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CustomerUpdate }) =>
      customersApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      setSelectedCustomer(updated)
      toast.success(t("toastUpdated", { name: updated.name }))
    },
    onError: () => { toast.error(t("toastUpdateError")) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => customersApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      if (selectedCustomer?.id === id) setSelectedCustomer(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => { toast.error(t("toastDeleteError")) },
  })

  // ── Sync draft when selected customer changes ──────────────────────────────

  useEffect(() => {
    if (selectedCustomer) {
      setDraft({
        name: selectedCustomer.name,
        description: selectedCustomer.description,
        notes: selectedCustomer.notes,
      })
    }
  }, [selectedCustomer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [activeTab, selectedCustomer])

  const isDirty = useMemo(() => {
    if (!selectedCustomer) return false
    return (
      draft.name !== selectedCustomer.name ||
      draft.description !== selectedCustomer.description ||
      draft.notes !== selectedCustomer.notes
    )
  }, [draft, selectedCustomer])

  function handleCancelDraft() {
    if (!selectedCustomer) return
    setDraft({
      name: selectedCustomer.name,
      description: selectedCustomer.description,
      notes: selectedCustomer.notes,
    })
  }

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? customers.filter((c) => selectedIds.has(c.id))
      : customers

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (c) => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
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
  }, [customers, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
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

  function handleRowClick(customer: CustomerResponse) {
    setSelectedCustomer(customer)
    setActiveTab("details")
  }

  function handleRowRightClick(e: React.MouseEvent, id: string) {
    e.preventDefault()
    handleStar(id)
  }

  async function handleSave() {
    if (!selectedCustomer) return
    await updateMutation.mutateAsync({ id: selectedCustomer.id, data: draft })
  }

  function openDeleteDialog() {
    setDeleteUnderstood(false)
    setDeleteConfirmText("")
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!selectedCustomer) return
    await deleteMutation.mutateAsync(selectedCustomer.id)
    setDeleteDialogOpen(false)
    setSelectedCustomer(null)
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
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Top: Master table ── */}
      <div
        className={cn("flex flex-col shrink-0", detailMaximized && "hidden")}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-end px-4 py-2 shrink-0 bg-background">
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
              <p className="text-sm">{t("noCustomers")}</p>
              <p className="text-xs opacity-60">{t("noCustomersHint")}</p>
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
                            onClick={() => setSelectedIds(new Set(customers.map((c) => c.id)))}
                          >
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setSelectedIds(
                                new Set(customers.filter((c) => starredIds.has(c.id)).map((c) => c.id))
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
                {pageItems.map((customer) => (
                  <TableRow
                    key={customer.id}
                    data-state={selectedCustomer?.id === customer.id ? "selected" : undefined}
                    onClick={() => handleRowClick(customer)}
                    onContextMenu={(e) => handleRowRightClick(e, customer.id)}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(customer.id)}
                        onCheckedChange={(c) => handleRowCheckbox(customer.id, !!c)}
                      />
                    </TableCell>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {customer.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-[240px] truncate">
                      {customer.description ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStar(customer.id)}
                        className="hover:text-amber-400 transition-colors"
                        aria-label="Toggle star"
                      >
                        <Star
                          className={cn(
                            "h-4 w-4",
                            starredIds.has(customer.id)
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
      {selectedCustomer && (
        <>
          {!detailMaximized && <hr className="my-8" />}

          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            {/* Tabs */}
            <Tabs
              defaultValue="details"
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex-1 flex flex-col gap-0"
            >
              <div className="relative w-full">
                <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="details">{t("tabDetails")}</TabsTrigger>
                  <TabsTrigger className="bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer" value="actions">{t("tabActions")}</TabsTrigger>
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
              <TabsContent value="details" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
                <FieldRow label="ID">
                  <div className="relative">
                    <Input value={selectedCustomer.id} readOnly className="pr-9 opacity-50 cursor-default select-all font-mono text-xs" />
                    <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
                      <CopyIcon
                        size={16}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedCustomer.id)
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
                <FieldRow label={t("fieldNotes")}>
                  <Textarea
                    value={draft.notes ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value || null }))}
                    rows={4}
                    className="space-y-6 w-full min-h-30 px-4 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
                  />
                </FieldRow>
              </TabsContent>

              {/* ─ Actions ─ */}
              <TabsContent value="actions" className="space-y-6 max-w-2xl mt-6 pl-[2px]">
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

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("deleteAbsoluteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteAbsoluteDescription", { name: selectedCustomer?.name ?? "" })}
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
