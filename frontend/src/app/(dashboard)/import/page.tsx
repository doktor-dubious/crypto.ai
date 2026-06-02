"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  Upload, Search, Bug, Flame, CheckCircle2, Pin, FileText,
  AlertCircle, Filter as FilterIcon, ChevronDown, Play, XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCustomer } from "@/components/providers/customer-provider"
import {
  importsApi, importTemplatesApi,
  type ImportFileInfo, type VerificationResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10
type Step = "select" | "verify" | "execute"

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
}

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const t = useTranslations("import")
  const steps: { key: Step; label: string; hint: string; color: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "select", label: t("stepSelect"), hint: t("stepSelectHint"), color: "emerald", Icon: Pin },
    { key: "verify", label: t("stepVerify"), hint: t("stepVerifyHint"), color: "rose", Icon: Bug },
    { key: "execute", label: t("stepExecute"), hint: t("stepExecuteHint"), color: "amber", Icon: Flame },
  ]
  const activeIndex = steps.findIndex((s) => s.key === step)

  return (
    <div className="flex items-center justify-between gap-0 mb-6 px-4">
      {steps.map((s, i) => {
        const isActive = i === activeIndex
        const isDone = i < activeIndex
        const circle = cn(
          "h-16 w-16 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
          isActive || isDone
            ? {
                emerald: "border-emerald-500 text-emerald-500 bg-emerald-500/5",
                rose: "border-rose-500 text-rose-500 bg-rose-500/5",
                amber: "border-amber-500 text-amber-500 bg-amber-500/5",
              }[s.color]
            : "border-[var(--border)] text-[var(--muted-foreground)]"
        )
        const labelCls = cn(
          "mt-2 text-sm font-medium",
          isActive ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        )
        return (
          <div key={s.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={cn(
                "flex flex-col items-center p-3 rounded-md w-full",
                isActive && "bg-[var(--accent)]/40"
              )}>
                <div className={circle}>
                  <s.Icon className="h-7 w-7" />
                </div>
                <div className={labelCls}>{s.label}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{s.hint}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className={cn(
                "h-0.5 flex-1 mx-2",
                i < activeIndex
                  ? {
                      emerald: "bg-emerald-500",
                      rose: "bg-rose-500",
                      amber: "bg-amber-500",
                    }[s.color]
                  : "bg-[var(--border)]"
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const t = useTranslations("import")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()
  const cid = activeCustomer?.id ?? ""

  const [step, setStep] = useState<Step>("select")
  const [selectedFile, setSelectedFile] = useState<ImportFileInfo | null>(null)
  const [search, setSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Verify step state
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [verifyResult, setVerifyResult] = useState<VerificationResponse | null>(null)
  const [groupEnabled, setGroupEnabled] = useState<Record<string, boolean>>({})
  const [verifySearch, setVerifySearch] = useState("")
  const [verifyPage, setVerifyPage] = useState(1)

  // ── Data fetching ────────────────────────────────────────────────────────

  const { data: listing, isLoading } = useQuery({
    queryKey: ["imports-files", cid],
    queryFn: () => importsApi.listFiles(cid),
    enabled: !!cid,
    retry: false,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => importsApi.uploadFile(cid, file),
    onSuccess: (info) => {
      queryClient.invalidateQueries({ queryKey: ["imports-files"] })
      toast.success(t("toastUploaded"))
      setSelectedFile(info)
      setStep("verify")
    },
    onError: (err) => toast.error(`${t("toastUploadError")}: ${(err as Error).message}`),
  })

  const { data: templates = [] } = useQuery({
    queryKey: ["import-templates", cid],
    queryFn: () => importTemplatesApi.list(cid),
    enabled: !!cid,
    retry: false,
  })

  const verifyMutation = useMutation({
    mutationFn: ({ tplId, filename }: { tplId: string; filename: string }) =>
      importsApi.verify(cid, tplId, filename),
    onSuccess: (result) => {
      setVerifyResult(result)
      setVerifyPage(1)
      setGroupEnabled(Object.fromEntries(result.groups.map((g) => [g.name, true])))
    },
    onError: (err) => toast.error(`${t("verifyFailed")}: ${(err as Error).message}`),
  })

  // Auto-select sole template
  useEffect(() => {
    if (templates.length === 1 && !templateId) setTemplateId(templates[0].id)
  }, [templates, templateId])

  // Reset verification state when leaving Verify step or changing file/template
  useEffect(() => {
    if (step !== "verify") {
      setVerifyResult(null)
      setVerifySearch("")
      setVerifyPage(1)
    }
  }, [step])

  // ── Filter / paginate ────────────────────────────────────────────────────

  const files = listing?.files ?? []
  const filtered = useMemo(() => {
    if (!search) return files
    const q = search.toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(q))
  }, [files, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
  const paginationPages = buildPaginationPages(safePage, totalPages)

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ""
  }

  function handleRowClick(info: ImportFileInfo) {
    setSelectedFile(info)
    setStep("verify")
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (!activeCustomer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-[var(--muted-foreground)]">
        <p className="text-sm">{t("noCustomer")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4">
      <StepIndicator step={step} />

      {step === "select" && (
        <div className="space-y-6">
          {/* Local upload */}
          <section>
            <h2 className="text-sm font-semibold mb-2">{t("localSectionTitle")}</h2>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileInputChange}
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending || !listing?.directory}
              >
                <Upload className="h-3.5 w-3.5" />
                {uploadMutation.isPending ? t("localUploading") : t("localChooseButton")}
              </Button>
              <span className="text-xs text-[var(--muted-foreground)]">{t("localDropHint")}</span>
            </div>
          </section>

          {/* Remote listing */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">{t("remoteSectionTitle")}</h2>
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

            {listing?.directory && (
              <p className="text-xs text-[var(--muted-foreground)] mb-3">
                {t("dirLabel")}: <code className="font-mono">{listing.directory}</code>
              </p>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-sm text-[var(--muted-foreground)]">
                Loading…
              </div>
            ) : !listing?.directory ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--muted-foreground)]">
                <p className="text-sm">{t("noDirectory")}</p>
                <p className="text-xs opacity-60">{t("noDirectoryHint")}</p>
              </div>
            ) : listing.error ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
                {listing.error}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--muted-foreground)]">
                <p className="text-sm">{t("noFiles")}</p>
                <p className="text-xs opacity-60">{t("noFilesHint")}</p>
              </div>
            ) : (
              <>
                <div className="rounded-md border border-[var(--border)] overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("remoteColFilename")}</TableHead>
                        <TableHead className="w-28 text-right">{t("remoteColSize")}</TableHead>
                        <TableHead className="w-40">{t("remoteColModified")}</TableHead>
                        <TableHead className="w-28">{t("remoteColStatus")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageItems.map((f) => (
                        <TableRow
                          key={f.name}
                          onClick={() => handleRowClick(f)}
                          className={cn(
                            "cursor-pointer",
                            f.imported && "bg-emerald-500/10 hover:bg-emerald-500/15"
                          )}
                        >
                          <TableCell className="font-mono text-xs flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)] shrink-0" />
                            {f.name}
                          </TableCell>
                          <TableCell className="text-right text-xs text-[var(--muted-foreground)] tabular-nums">
                            {formatBytes(f.size_bytes)}
                          </TableCell>
                          <TableCell className="text-xs text-[var(--muted-foreground)]">
                            {formatDate(f.modified_at)}
                          </TableCell>
                          <TableCell>
                            {f.imported ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {t("statusImported")}
                              </span>
                            ) : (
                              <span className="text-xs text-[var(--muted-foreground)]">{t("statusNew")}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between px-1 py-2 text-xs text-[var(--muted-foreground)]">
                  <span>
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
              </>
            )}
          </section>
        </div>
      )}

      {step === "verify" && (
        <VerifyStep
          cid={cid}
          selectedFile={selectedFile}
          templates={templates}
          templateId={templateId}
          setTemplateId={setTemplateId}
          verifyResult={verifyResult}
          isVerifying={verifyMutation.isPending}
          onVerify={() => {
            if (!templateId || !selectedFile) return
            verifyMutation.mutate({ tplId: templateId, filename: selectedFile.name })
          }}
          groupEnabled={groupEnabled}
          setGroupEnabled={setGroupEnabled}
          verifySearch={verifySearch}
          setVerifySearch={setVerifySearch}
          verifyPage={verifyPage}
          setVerifyPage={setVerifyPage}
          onCancel={() => setStep("select")}
          onContinue={() => setStep("execute")}
        />
      )}

      {step === "execute" && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-[var(--muted-foreground)]">
          <p className="text-sm font-medium">{t("executePlaceholder")}</p>
          {selectedFile && (
            <p className="text-xs font-mono">{selectedFile.name}</p>
          )}
          <p className="text-xs opacity-60 max-w-md text-center">{t("executePlaceholderHint")}</p>
          <Button variant="outline" size="sm" onClick={() => setStep("verify")}>
            {t("backButton")}
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Verify step ─────────────────────────────────────────────────────────────

type VerifyStepProps = {
  cid: string
  selectedFile: ImportFileInfo | null
  templates: { id: string; name: string }[]
  templateId: string | null
  setTemplateId: (id: string) => void
  verifyResult: VerificationResponse | null
  isVerifying: boolean
  onVerify: () => void
  groupEnabled: Record<string, boolean>
  setGroupEnabled: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  verifySearch: string
  setVerifySearch: (s: string) => void
  verifyPage: number
  setVerifyPage: (n: number) => void
  onCancel: () => void
  onContinue: () => void
}

function VerifyStep({
  selectedFile,
  templates,
  templateId,
  setTemplateId,
  verifyResult,
  isVerifying,
  onVerify,
  groupEnabled,
  setGroupEnabled,
  verifySearch,
  setVerifySearch,
  verifyPage,
  setVerifyPage,
  onCancel,
  onContinue,
}: VerifyStepProps) {
  const t = useTranslations("import")

  const activeGroups = useMemo(
    () => new Set(Object.entries(groupEnabled).filter(([, on]) => on).map(([n]) => n)),
    [groupEnabled]
  )

  const filteredIssues = useMemo(() => {
    if (!verifyResult) return []
    let list = verifyResult.issues
    if (activeGroups.size > 0 && activeGroups.size < verifyResult.groups.length) {
      list = list.filter((i) => activeGroups.has(i.message_group))
    }
    if (verifySearch) {
      const q = verifySearch.toLowerCase()
      list = list.filter((i) =>
        i.message.toLowerCase().includes(q) ||
        i.message_group.toLowerCase().includes(q) ||
        String(i.line_number).includes(q)
      )
    }
    return list
  }, [verifyResult, activeGroups, verifySearch])

  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / ITEMS_PER_PAGE))
  const safePage = Math.min(verifyPage, totalPages)
  const pageItems = filteredIssues.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
  const paginationPages = buildPaginationPages(safePage, totalPages)

  const selectedTemplateName = templates.find((tpl) => tpl.id === templateId)?.name

  return (
    <div className="flex flex-col gap-4">
      {/* File + template picker row */}
      <section className="rounded-md border border-[var(--border)] p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
          <span className="font-mono text-xs">{selectedFile?.name ?? "—"}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">
            {t("verifyTemplateLabel")}
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between h-8 w-72 px-3 rounded-md border border-[var(--border)] text-sm hover:bg-[var(--accent)] cursor-pointer">
                <span className="truncate">
                  {selectedTemplateName ?? t("verifyTemplatePlaceholder")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {templates.length === 0 ? (
                <DropdownMenuItem disabled>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {t("verifyNoTemplate")}
                  </span>
                </DropdownMenuItem>
              ) : templates.map((tpl) => (
                <DropdownMenuItem key={tpl.id} onClick={() => setTemplateId(tpl.id)}>
                  {tpl.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="outline"
            onClick={onVerify}
            disabled={!templateId || !selectedFile || isVerifying}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            {isVerifying ? t("verifyRunning") : t("verifyRunButton")}
          </Button>
        </div>
      </section>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3">
        <Button
          size="sm"
          onClick={onContinue}
          disabled={!verifyResult}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Flame className="h-3.5 w-3.5" />
          {t("verifyImportButton")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          className="gap-1.5 border-rose-500/50 text-rose-600 hover:bg-rose-500/10"
        >
          <XCircle className="h-3.5 w-3.5" />
          {t("verifyCancelButton")}
        </Button>
      </div>

      {/* Summary */}
      {verifyResult && (
        <>
          <section className="grid grid-cols-3 gap-0 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-6 py-4">
            <StatCell label={t("verifyStatLines")} value={verifyResult.total_lines} info={t("verifyStatLinesInfo")} />
            <StatCell label={t("verifyStatErrors")} value={verifyResult.error_count} info={t("verifyStatErrorsInfo")} />
            <StatCell label={t("verifyStatFilters")} value={verifyResult.filter_count} info={t("verifyStatFiltersInfo")} />
          </section>

          {/* Group chips */}
          {verifyResult.groups.length > 0 && (
            <section className="flex flex-col gap-1.5 border-y border-[var(--border)] py-3">
              <div className="flex items-center gap-2 mb-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() =>
                    setGroupEnabled(Object.fromEntries(verifyResult.groups.map((g) => [g.name, true])))
                  }
                >
                  <FilterIcon className="h-3 w-3" />
                  {t("verifyShowAll")}
                </Button>
              </div>
              {verifyResult.groups.map((g) => {
                const enabled = groupEnabled[g.name] ?? true
                const isFilter = g.severity === "Filter"
                return (
                  <label
                    key={g.name}
                    className="flex items-center gap-3 text-sm cursor-pointer select-none"
                  >
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(c) =>
                        setGroupEnabled((prev) => ({ ...prev, [g.name]: !!c }))
                      }
                    />
                    <span className={cn("font-medium", isFilter ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400")}>
                      {g.name}
                    </span>
                    <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{g.count.toLocaleString()}</span>
                  </label>
                )
              })}
            </section>
          )}

          {verifyResult.issues_truncated && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t("verifyTruncated")}
            </div>
          )}

          {/* Issues table */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-[var(--muted-foreground)]">
                {t("verifyShowing", {
                  from: filteredIssues.length === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1,
                  to: Math.min(safePage * ITEMS_PER_PAGE, filteredIssues.length),
                  total: filteredIssues.length,
                })}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                <Input
                  placeholder={t("verifySearchPlaceholder")}
                  value={verifySearch}
                  onChange={(e) => { setVerifySearch(e.target.value); setVerifyPage(1) }}
                  className="h-7 pl-8 w-52 text-xs"
                />
              </div>
            </div>

            {filteredIssues.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-1 text-[var(--muted-foreground)]">
                <p className="text-sm">{t("verifyNoIssues")}</p>
                <p className="text-xs opacity-60">{t("verifyNoIssuesHint")}</p>
              </div>
            ) : (
              <>
                <div className="rounded-md border border-[var(--border)] overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">{t("verifyColLineNumber")}</TableHead>
                        <TableHead className="w-24">{t("verifyColSeverity")}</TableHead>
                        <TableHead className="w-52">{t("verifyColMessageGroup")}</TableHead>
                        <TableHead>{t("verifyColMessage")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageItems.map((iss, i) => {
                        const isFilter = iss.severity === "Filter"
                        return (
                          <TableRow
                            key={`${iss.line_number}-${i}`}
                            className={cn(
                              isFilter ? "bg-amber-500/5" : "bg-rose-500/5"
                            )}
                          >
                            <TableCell className="text-xs tabular-nums">{iss.line_number}</TableCell>
                            <TableCell className={cn(
                              "text-xs font-medium",
                              isFilter ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"
                            )}>
                              {iss.severity}
                            </TableCell>
                            <TableCell className="text-xs text-[var(--muted-foreground)]">{iss.message_group}</TableCell>
                            <TableCell className="text-xs">{iss.message}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="flex justify-end mt-2">
                    <Pagination className="w-auto mx-0">
                      <PaginationContent className="gap-0.5">
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={() => setVerifyPage(Math.max(1, safePage - 1))}
                            className={cn("h-7 text-xs", safePage === 1 && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                        {paginationPages.map((p, i) =>
                          p === "ellipsis" ? (
                            <PaginationItem key={`e${i}`}><PaginationEllipsis /></PaginationItem>
                          ) : (
                            <PaginationItem key={p}>
                              <PaginationLink
                                onClick={() => setVerifyPage(p)}
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
                            onClick={() => setVerifyPage(Math.min(totalPages, safePage + 1))}
                            className={cn("h-7 text-xs", safePage === totalPages && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function StatCell({ label, value, info }: { label: string; value: number; info: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="text-xs text-[var(--muted-foreground)] w-20">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="flex-1 text-xs text-[var(--muted-foreground)] opacity-60 text-right">{info}</div>
    </div>
  )
}
