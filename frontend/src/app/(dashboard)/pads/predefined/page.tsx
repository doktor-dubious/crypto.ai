"use client"

import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, Focus, ArrowUpDown, ChevronDown, ChevronUp, Plus, Minus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
  predefinedPadsApi, padsApi,
  type PredefinedPadResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
const DATES_PER_PAGE = 6
type SortField = "country" | "name" | "dates" | "applied" | "starred"

function countryDisplay(country: string | null): string {
  if (!country) return "🌐"
  switch (country.toUpperCase()) {
    case "CA": return "🇨🇦"
    case "US": return "🇺🇸"
    default: return "🌐"
  }
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PredefinedPadsPage() {
  const t = useTranslations("pads.predefined")
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
  const [selected, setSelected] = useState<PredefinedPadResponse | null>(null)
  const [datesPage, setDatesPage] = useState(1)

  // ── Confirmation dialogs
  const [applyDialogPad, setApplyDialogPad] = useState<PredefinedPadResponse | null>(null)
  const [removeDialogPad, setRemoveDialogPad] = useState<PredefinedPadResponse | null>(null)

  // ── Bulk delete dialog
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [bulkDeleteUnderstood, setBulkDeleteUnderstood] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("")

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: predefinedPads = [], isLoading: isLoadingPads } = useQuery({
    queryKey: ["predefined-pads"],
    queryFn: () => predefinedPadsApi.list(),
    retry: false,
  })

  const { data: customerPads = [], isLoading: isLoadingCustomerPads } = useQuery({
    queryKey: ["pads", activeCustomer?.id],
    queryFn: () => padsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  const isLoading = isLoadingPads || isLoadingCustomerPads

  // ── Applied set: predefined pad names that have a matching customer pad
  const appliedNames = useMemo(() => {
    const s = new Set<string>()
    for (const p of customerPads) s.add(p.name)
    return s
  }, [customerPads])

  // ── Mutations ─────────────────────────────────────────────────────────────

  const applyMutation = useMutation({
    mutationFn: (pad: PredefinedPadResponse) =>
      padsApi.create({
        customer_id: activeCustomer!.id,
        name: pad.name,
        allow_negative: pad.allow_negative,
        dates: pad.dates.map((d) => d.date),
      }),
    onSuccess: (_, pad) => {
      queryClient.invalidateQueries({ queryKey: ["pads"] })
      toast.success(t("toastApplied", { name: pad.name }))
    },
    onError: () => { toast.error(t("toastApplyError")) },
  })

  const removeMutation = useMutation({
    mutationFn: (pad: PredefinedPadResponse) => {
      const customerPad = customerPads.find((p) => p.name === pad.name)
      if (!customerPad) throw new Error("Customer PAD not found")
      return padsApi.delete(customerPad.id)
    },
    onSuccess: (_, pad) => {
      queryClient.invalidateQueries({ queryKey: ["pads"] })
      toast.success(t("toastRemoved", { name: pad.name }))
    },
    onError: () => { toast.error(t("toastRemoveError")) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => predefinedPadsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["predefined-pads"] })
      if (selected?.id === id) setSelected(null)
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t("toastDeleted"))
    },
    onError: () => { toast.error(t("toastDeleteError")) },
  })

  // ── Derived / filtering / sorting / pagination ─────────────────────────────

  const filtered = useMemo(() => {
    let items = showOnlySelected
      ? predefinedPads.filter((p) => selectedIds.has(p.id))
      : predefinedPads

    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.country ?? "").toLowerCase().includes(q)
      )
    }

    return [...items].sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortField) {
        case "country": va = a.country ?? ""; vb = b.country ?? ""; break
        case "name": va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break
        case "dates": va = a.dates.length; vb = b.dates.length; break
        case "applied": va = appliedNames.has(a.name) ? 1 : 0; vb = appliedNames.has(b.name) ? 1 : 0; break
        case "starred": va = starredIds.has(a.id) ? 1 : 0; vb = starredIds.has(b.id) ? 1 : 0; break
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [predefinedPads, search, sortField, sortDir, showOnlySelected, selectedIds, starredIds, appliedNames])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((p) => selectedIds.has(p.id))
  const somePageSelected = pageItems.some((p) => selectedIds.has(p.id))

  function handleHeaderCheckbox() {
    if (allPageSelected) {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((p) => n.delete(p.id)); return n })
    } else {
      setSelectedIds((prev) => { const n = new Set(prev); pageItems.forEach((p) => n.add(p.id)); return n })
    }
  }

  function handleStar(id: string) {
    setStarredIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
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

  function handleSelectPad(pad: PredefinedPadResponse) {
    setSelected(pad)
    setDatesPage(1)
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

  // ── Sorted dates for detail pane (paginated)
  const selectedDates = useMemo(() => {
    if (!selected) return []
    return [...selected.dates].sort((a, b) => a.date.localeCompare(b.date))
  }, [selected])

  const datesTotalPages = Math.max(1, Math.ceil(selectedDates.length / DATES_PER_PAGE))
  const safeDatesPage = Math.min(datesPage, datesTotalPages)
  const datePageItems = selectedDates.slice((safeDatesPage - 1) * DATES_PER_PAGE, safeDatesPage * DATES_PER_PAGE)

  const isApplied = selected ? appliedNames.has(selected.name) : false

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className="flex flex-col shrink-0">
        {/* Toolbar */}
        <div className="flex items-center justify-end px-4 py-2 shrink-0 bg-background">
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
              <p className="text-sm">{t("noPads")}</p>
              <p className="text-xs opacity-60">{t("noPadsHint")}</p>
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
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predefinedPads.map((p) => p.id)))}>
                            {t("selectAll")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predefinedPads.filter((p) => !p.country).map((p) => p.id)))}>
                            {t("selectInternational")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predefinedPads.filter((p) => p.country?.toUpperCase() === "US").map((p) => p.id)))}>
                            {t("selectUS")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predefinedPads.filter((p) => p.country?.toUpperCase() === "CA").map((p) => p.id)))}>
                            {t("selectCanadian")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedIds(new Set(predefinedPads.filter((p) => starredIds.has(p.id)).map((p) => p.id)))}>
                            {t("starred")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>
                  <TableHead className="w-10"><SortHeader field="country" label={t("colCountry")} /></TableHead>
                  <TableHead><SortHeader field="name" label={t("colName")} /></TableHead>
                  <TableHead><SortHeader field="dates" label={t("colDates")} /></TableHead>
                  <TableHead><SortHeader field="applied" label={t("colApplied")} /></TableHead>
                  <TableHead className="w-10" />
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
                {pageItems.map((pad) => {
                  const applied = appliedNames.has(pad.name)
                  return (
                    <TableRow
                      key={pad.id}
                      data-state={selected?.id === pad.id ? "selected" : undefined}
                      onClick={() => handleSelectPad(pad)}
                      onContextMenu={(e) => { e.preventDefault(); handleStar(pad.id) }}
                      className="cursor-pointer"
                    >
                      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(pad.id)}
                          onCheckedChange={(c) => setSelectedIds((prev) => {
                            const n = new Set(prev); c ? n.add(pad.id) : n.delete(pad.id); return n
                          })}
                        />
                      </TableCell>
                      <TableCell className="text-base text-center">{countryDisplay(pad.country)}</TableCell>
                      <TableCell className="font-medium">{pad.name}</TableCell>
                      <TableCell className="text-sm text-[var(--muted-foreground)]">{pad.dates.length}</TableCell>
                      <TableCell>
                        {applied && (
                          <Badge variant="secondary" className="text-xs">{t("appliedBadge")}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        {applied ? (
                          <button
                            onClick={() => setRemoveDialogPad(pad)}
                            disabled={!activeCustomer}
                            className="text-destructive hover:text-destructive/70 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label={t("removeButton")}
                            title={t("removeButton")}
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => setApplyDialogPad(pad)}
                            disabled={!activeCustomer}
                            className="text-[var(--muted-foreground)] hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label={t("applyButton")}
                            title={t("applyButton")}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleStar(pad.id)} className="hover:text-amber-400 transition-colors cursor-pointer" aria-label="Toggle star">
                          <Star className={cn("h-4 w-4", starredIds.has(pad.id) ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]")} />
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
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
                  variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
                  onClick={() => setShowOnlySelected((v) => !v)}
                  title={showOnlySelected ? "Show all" : "Show only selected"}
                >
                  <Focus className={cn("h-4 w-4", showOnlySelected && "text-primary")} />
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
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-t">
        {selected ? (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 max-w-2xl">
            <p className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
              {t("datesHeading")} ({selectedDates.length})
            </p>
            {selectedDates.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">{t("noDates")}</p>
            ) : (
              <>
                <div className="rounded-md border divide-y">
                  {datePageItems.map((d) => (
                    <div key={d.id} className="px-3 py-1.5 text-sm font-mono">
                      {d.date}
                    </div>
                  ))}
                </div>
                {datesTotalPages > 1 && (
                  <Pagination className="w-auto mx-0">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious onClick={() => setDatesPage((p) => Math.max(1, p - 1))} disabled={safeDatesPage === 1} />
                      </PaginationItem>
                      {buildPaginationPages(safeDatesPage, datesTotalPages).map((p, i) =>
                        p === "ellipsis" ? (
                          <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                        ) : (
                          <PaginationItem key={p}>
                            <PaginationLink isActive={safeDatesPage === p} onClick={() => setDatesPage(p)}>{p}</PaginationLink>
                          </PaginationItem>
                        )
                      )}
                      <PaginationItem>
                        <PaginationNext onClick={() => setDatesPage((p) => Math.min(datesTotalPages, p + 1))} disabled={safeDatesPage === datesTotalPages} />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
            {t("noSelection")}
          </div>
        )}
      </div>

      {/* ── Apply Confirmation Dialog ── */}
      <Dialog open={!!applyDialogPad} onOpenChange={(open) => { if (!open) setApplyDialogPad(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("applyConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("applyConfirmDescription", { name: applyDialogPad?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setApplyDialogPad(null)}>{t("confirmCancel")}</Button>
            <Button
              variant="default" size="sm"
              disabled={applyMutation.isPending}
              onClick={async () => {
                if (!applyDialogPad) return
                await applyMutation.mutateAsync(applyDialogPad)
                setApplyDialogPad(null)
              }}
            >
              {applyMutation.isPending ? t("applying") : t("applyButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove Confirmation Dialog ── */}
      <Dialog open={!!removeDialogPad} onOpenChange={(open) => { if (!open) setRemoveDialogPad(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("removeConfirmDescription", { name: removeDialogPad?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setRemoveDialogPad(null)}>{t("confirmCancel")}</Button>
            <Button
              variant="destructive" size="sm"
              disabled={removeMutation.isPending}
              onClick={async () => {
                if (!removeDialogPad) return
                await removeMutation.mutateAsync(removeDialogPad)
                setRemoveDialogPad(null)
              }}
            >
              {removeMutation.isPending ? t("removing") : t("removeButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Delete Dialog ── */}
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
              <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("bulkDeleteTypeToConfirm")}</label>
              <Input
                value={bulkDeleteConfirmText}
                onChange={(e) => setBulkDeleteConfirmText(e.target.value)}
                placeholder={t("bulkDeleteTypePlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setBulkDeleteDialogOpen(false)}>{t("bulkDeleteCancel")}</Button>
            <Button
              variant="destructive" size="sm" onClick={handleBulkDelete}
              disabled={!bulkDeleteUnderstood || bulkDeleteConfirmText !== t("bulkDeleteTypePlaceholder") || deleteMutation.isPending}
            >
              {t("bulkDeleteConfirm", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
