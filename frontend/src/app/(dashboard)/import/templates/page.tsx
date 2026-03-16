"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Search, Star, Trash2, ArrowUpDown, ChevronDown, ChevronUp, Plus, GripVertical,
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
import { useCustomer } from "@/components/providers/customer-provider"
import { useLock } from "@/components/providers/lock-provider"
import {
  importTemplatesApi,
  type ImportTemplateResponse,
  type ImportTemplateUpdate,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type SortField = "name" | "separator" | "starred"

// ─── Available element types (right-side palette) ─────────────────────────────

interface AvailableElement {
  type: string
  labelKey: string
  column: "miscellaneous" | "distribution" | "accountInfo"
}

const AVAILABLE_ELEMENTS: AvailableElement[] = [
  // Miscellaneous
  { type: "unused", labelKey: "elementUnused", column: "miscellaneous" },
  { type: "account_id", labelKey: "elementAccountId", column: "miscellaneous" },
  // Distribution
  { type: "date", labelKey: "elementDate", column: "distribution" },
  { type: "delivery_quantity", labelKey: "elementDeliveryQuantity", column: "distribution" },
  { type: "delivery_adjustment", labelKey: "elementDeliveryAdjustment", column: "distribution" },
  { type: "sold", labelKey: "elementSold", column: "distribution" },
  { type: "scan", labelKey: "elementScan", column: "distribution" },
  { type: "return", labelKey: "elementReturn", column: "distribution" },
  { type: "delivery_sequence", labelKey: "elementDeliverySequence", column: "distribution" },
  { type: "sold_sequence", labelKey: "elementSoldSequence", column: "distribution" },
  { type: "scan_sequence", labelKey: "elementScanSequence", column: "distribution" },
  { type: "return_sequence", labelKey: "elementReturnSequence", column: "distribution" },
  // Account Info
  { type: "name", labelKey: "elementName", column: "accountInfo" },
  { type: "address", labelKey: "elementAddress", column: "accountInfo" },
  { type: "zip", labelKey: "elementZip", column: "accountInfo" },
  { type: "state", labelKey: "elementState", column: "accountInfo" },
  { type: "country", labelKey: "elementCountry", column: "accountInfo" },
]

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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4">
      <label className="text-xs font-medium text-[var(--muted-foreground)] pt-2.5">{label}</label>
      <div>{children}</div>
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
  const { isLocked } = useLock()
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
  const [activeTab, setActiveTab] = useState(() => loadItJson<string>(cid, "activeTab", "details"))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Draft state
  const [draft, setDraft] = useState<ImportTemplateUpdate>({})

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
      setActiveTab(loadItJson<string>(cid, "activeTab", "details"))
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

  const addElementMutation = useMutation({
    mutationFn: ({ templateId, data }: { templateId: string; data: { name: string; type: string; element_index: number } }) =>
      importTemplatesApi.addElement(templateId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-templates"] })
      toast.success(t("toastElementAdded"))
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
    setActiveTab("details")
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

  // ── Add element from palette ───────────────────────────────────────────────

  function handleAddElement(elem: AvailableElement) {
    if (!selected) return
    const nextIndex = selected.elements.length
    addElementMutation.mutate({
      templateId: selected.id,
      data: { name: t(elem.labelKey as Parameters<typeof t>[0]), type: elem.type, element_index: nextIndex },
    })
  }

  function handleRemoveElement(elementId: string) {
    removeElementMutation.mutate(elementId)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Master table ── */}
      <div className="flex flex-col shrink-0">

        {/* Toolbar */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 shrink-0 bg-background">
          {selectedIds.size > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowOnlySelected(!showOnlySelected)}
              >
                {showOnlySelected ? t("showAll") : t("showSelected")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-[var(--destructive)]"
                onClick={() => setBulkDeleteDialogOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }}
              className="h-7 pl-8 w-52 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3 w-3" />
            {t("newButton")}
          </Button>
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

        {/* Pagination + status */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-1.5 text-xs text-[var(--muted-foreground)] shrink-0">
            <span>
              {t("showing", {
                from: (safePage - 1) * ITEMS_PER_PAGE + 1,
                to: Math.min(safePage * ITEMS_PER_PAGE, filtered.length),
                total: filtered.length,
              })}
            </span>
            {totalPages > 1 && (
              <Pagination>
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
      </div>

      {/* ── Detail pane ── */}
      {selected && (
        <div className="flex-1 min-h-0 overflow-y-auto border-t border-[var(--border)]">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
            <div className="shrink-0 border-b border-[var(--border)] px-4 pt-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold truncate">{selected.name}</h2>
              </div>
              <div className="relative">
                <TabsList ref={tabsListRef} className="bg-transparent p-0 h-auto gap-4 relative">
                  <TabsTrigger value="details" className="bg-transparent px-0 pb-2 text-xs data-[state=active]:shadow-none cursor-pointer">
                    {t("tabDetails")}
                  </TabsTrigger>
                  <TabsTrigger value="elements" className="bg-transparent px-0 pb-2 text-xs data-[state=active]:shadow-none cursor-pointer">
                    {t("tabElements")}
                  </TabsTrigger>
                  <TabsTrigger value="actions" className="bg-transparent px-0 pb-2 text-xs data-[state=active]:shadow-none cursor-pointer">
                    {t("tabActions")}
                  </TabsTrigger>
                </TabsList>
                <div
                  className="absolute bottom-0 h-0.5 bg-[var(--foreground)] transition-all duration-200"
                  style={indicatorStyle}
                />
              </div>
            </div>

            {/* Details tab */}
            <TabsContent value="details" className="flex-1 overflow-y-auto p-4 space-y-4 mt-0">
              <FieldRow label={t("fieldName")}>
                <Input
                  value={draft.name ?? selected.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className="h-9 text-sm"
                  disabled={isLocked}
                />
              </FieldRow>
              <FieldRow label={t("fieldDescription")}>
                <Textarea
                  value={draft.description ?? selected.description ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || null }))}
                  className="text-sm min-h-[60px]"
                  disabled={isLocked}
                />
              </FieldRow>
              <FieldRow label={t("fieldSeparator")}>
                <Input
                  value={draft.separator ?? selected.separator}
                  onChange={(e) => setDraft((d) => ({ ...d, separator: e.target.value }))}
                  className="h-9 text-sm w-24 font-mono"
                  disabled={isLocked}
                />
              </FieldRow>
              <FieldRow label={t("fieldHeaderLines")}>
                <Input
                  type="number"
                  value={draft.header_lines ?? selected.header_lines}
                  onChange={(e) => setDraft((d) => ({ ...d, header_lines: parseInt(e.target.value) || 0 }))}
                  className="h-9 text-sm w-24"
                  disabled={isLocked}
                />
              </FieldRow>
              <FieldRow label={t("fieldFooterLines")}>
                <Input
                  type="number"
                  value={draft.footer_lines ?? selected.footer_lines}
                  onChange={(e) => setDraft((d) => ({ ...d, footer_lines: parseInt(e.target.value) || 0 }))}
                  className="h-9 text-sm w-24"
                  disabled={isLocked}
                />
              </FieldRow>
              <FieldRow label={t("fieldMoveFile")}>
                <Checkbox
                  checked={draft.move_file ?? selected.move_file}
                  onCheckedChange={(c) => setDraft((d) => ({ ...d, move_file: !!c }))}
                  disabled={isLocked}
                />
              </FieldRow>
              <FieldRow label={t("fieldResetProductionGroup")}>
                <Checkbox
                  checked={draft.reset_production_group ?? selected.reset_production_group}
                  onCheckedChange={(c) => setDraft((d) => ({ ...d, reset_production_group: !!c }))}
                  disabled={isLocked}
                />
              </FieldRow>
              <FieldRow label={t("fieldAddToProductionGroup")}>
                <Checkbox
                  checked={draft.add_to_production_group ?? selected.add_to_production_group}
                  onCheckedChange={(c) => setDraft((d) => ({ ...d, add_to_production_group: !!c }))}
                  disabled={isLocked}
                />
              </FieldRow>

              {draftDirty && !isLocked && (
                <div className="flex justify-end pt-2">
                  <Button size="sm" onClick={handleSaveDraft} disabled={updateMutation.isPending}>
                    Save
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* Elements tab — left: assigned, right: available palette */}
            <TabsContent value="elements" className="flex-1 overflow-hidden mt-0">
              <div className="flex h-full">
                {/* Left: assigned elements */}
                <div className="flex-1 overflow-y-auto p-4 border-r border-[var(--border)]">
                  <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
                    {t("assignedElements")}
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
                          <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
                          <span className="text-xs text-[var(--muted-foreground)] w-6 tabular-nums">{idx + 1}</span>
                          <span className="flex-1 truncate">{elem.name}</span>
                          <span className="text-xs text-[var(--muted-foreground)] font-mono">{elem.type}</span>
                          {!isLocked && (
                            <button
                              onClick={() => handleRemoveElement(elem.id)}
                              className="opacity-0 group-hover:opacity-100 text-[var(--destructive)] hover:text-[var(--destructive)] transition-opacity cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: available element palette */}
                <div className="w-72 shrink-0 overflow-y-auto p-4">
                  <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">
                    {t("availableElements")}
                  </h3>
                  <div className="space-y-4">
                    {/* Miscellaneous */}
                    <div>
                      <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5">{t("colMiscellaneous")}</h4>
                      <div className="space-y-0.5">
                        {AVAILABLE_ELEMENTS.filter((e) => e.column === "miscellaneous").map((elem) => (
                          <button
                            key={elem.type}
                            onClick={() => handleAddElement(elem)}
                            disabled={isLocked}
                            className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-sm hover:bg-[var(--accent)] transition-colors text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Plus className="h-3 w-3 text-[var(--muted-foreground)]" />
                            {t(elem.labelKey as Parameters<typeof t>[0])}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Distribution */}
                    <div>
                      <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5">{t("colDistribution")}</h4>
                      <div className="space-y-0.5">
                        {AVAILABLE_ELEMENTS.filter((e) => e.column === "distribution").map((elem) => (
                          <button
                            key={elem.type}
                            onClick={() => handleAddElement(elem)}
                            disabled={isLocked}
                            className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-sm hover:bg-[var(--accent)] transition-colors text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Plus className="h-3 w-3 text-[var(--muted-foreground)]" />
                            {t(elem.labelKey as Parameters<typeof t>[0])}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Account Info */}
                    <div>
                      <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5">{t("colAccountInfo")}</h4>
                      <div className="space-y-0.5">
                        {AVAILABLE_ELEMENTS.filter((e) => e.column === "accountInfo").map((elem) => (
                          <button
                            key={elem.type}
                            onClick={() => handleAddElement(elem)}
                            disabled={isLocked}
                            className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-sm hover:bg-[var(--accent)] transition-colors text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Plus className="h-3 w-3 text-[var(--muted-foreground)]" />
                            {t(elem.labelKey as Parameters<typeof t>[0])}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Actions tab */}
            <TabsContent value="actions" className="flex-1 overflow-y-auto p-4 mt-0">
              <div className="rounded-lg border border-[var(--destructive)]/20 p-4">
                <h3 className="text-sm font-semibold text-[var(--destructive)] mb-1">{t("deleteAction")}</h3>
                <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("deleteActionDescription")}</p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isLocked}
                >
                  {t("deleteActionButton")}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
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
    </div>
  )
}
