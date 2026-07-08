"use client"

// Trading Strategy Template modal, opened from the topbar icon on the analytics
// pages. Left: the strategy's saved templates (selected one marked; "Save as New"
// captures the page's current params). Right (only when a template is selected):
// name / description / notes, with Revert (template params → page) and Save
// (page params + edited fields → template). When nothing is selected the list
// fills the whole modal.

import { useEffect, useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Check, Plus, Trash2, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { strategyTemplatesApi, type StrategyTemplate } from "@/lib/api"
import type { TemplateBridge } from "@/components/trading/template-context"

export function TemplateModal({
  bridge,
  open,
  onOpenChange,
}: {
  bridge: TemplateBridge
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("templateModal")
  const queryClient = useQueryClient()
  const { strategy } = bridge
  const queryKey = ["strategyTemplates", strategy]

  const { data: templates = [] } = useQuery({
    queryKey,
    queryFn: () => strategyTemplatesApi.list(strategy),
    enabled: open,
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(
    () => templates.find((tp) => tp.id === selectedId) ?? null,
    [templates, selectedId],
  )

  // Editable right-side fields, synced whenever the selected template changes.
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [notes, setNotes] = useState("")
  useEffect(() => {
    setName(selected?.name ?? "")
    setDescription(selected?.description ?? "")
    setNotes(selected?.notes ?? "")
  }, [selected])

  // Reset selection each time the modal (re)opens → list starts full-width.
  useEffect(() => {
    if (!open) setSelectedId(null)
  }, [open])

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const createMutation = useMutation({
    mutationFn: () =>
      strategyTemplatesApi.create({
        name: defaultName(templates),
        strategy,
        params: bridge.getParams(),
        scope: bridge.getScope(),
        description: "",
        notes: "",
      }),
    onSuccess: (tpl) => {
      invalidate()
      setSelectedId(tpl.id) // open its details for editing
      toast.success(t("created", { name: tpl.name }))
    },
    onError: () => toast.error(t("saveError")),
  })

  const saveMutation = useMutation({
    mutationFn: (id: string) =>
      strategyTemplatesApi.update(id, {
        name: name.trim() || selected?.name,
        description: description.trim() || null,
        notes: notes.trim() || null,
        params: bridge.getParams(),
        scope: bridge.getScope(),
      }),
    onSuccess: (tpl) => {
      invalidate()
      toast.success(t("saved", { name: tpl.name }))
    },
    onError: () => toast.error(t("saveError")),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => strategyTemplatesApi.delete(id),
    onSuccess: (_, id) => {
      invalidate()
      if (selectedId === id) setSelectedId(null)
      toast.success(t("deleted"))
    },
    onError: () => toast.error(t("deleteError")),
  })

  function revert() {
    if (!selected) return
    bridge.applyParams(selected.params)
    toast.success(t("reverted", { name: selected.name }))
    onOpenChange(false) // close so the updated page is visible
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("p-0 gap-0 max-w-3xl", selected && "sm:max-w-3xl")}>
        <DialogHeader className="px-5 py-3.5 border-b">
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[22rem]">
          {/* ── Left: template list ── */}
          <div
            className={cn(
              "flex flex-col",
              selected ? "w-1/2 border-r" : "w-full",
            )}
          >
            <div className="flex-1 overflow-y-auto p-2 max-h-[26rem]">
              {templates.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-[var(--muted-foreground)]">
                  {t("empty")}
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {templates.map((tpl) => (
                    <li key={tpl.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(tpl.id)}
                        className={cn(
                          "group flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm text-left cursor-pointer transition-colors",
                          selectedId === tpl.id
                            ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                            : "hover:bg-[var(--muted)]/50",
                        )}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Check
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              selectedId === tpl.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="truncate">{tpl.name}</span>
                        </span>
                        <span
                          role="button"
                          aria-label={t("delete")}
                          className="shrink-0 opacity-0 group-hover:opacity-60 hover:opacity-100! hover:text-destructive transition-opacity"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteMutation.mutate(tpl.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end border-t px-3 py-2.5">
              <Button
                size="sm"
                className="gap-1.5 cursor-pointer"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("saveAsNew")}
              </Button>
            </div>
          </div>

          {/* ── Right: selected template details ── */}
          {selected && (
            <div className="flex w-1/2 flex-col">
              <div className="flex-1 space-y-3 overflow-y-auto p-4 max-h-[26rem]">
                <Field label={t("name")}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label={t("description")}>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("descriptionPlaceholder")}
                  />
                </Field>
                <Field label={t("notes")}>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={5}
                    className="resize-none"
                    placeholder={t("notesPlaceholder")}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2 border-t px-3 py-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 cursor-pointer"
                  onClick={revert}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("revert")}
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 cursor-pointer"
                  disabled={!name.trim() || saveMutation.isPending}
                  onClick={() => saveMutation.mutate(selected.id)}
                >
                  <Save className="h-3.5 w-3.5" />
                  {t("save")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[var(--muted-foreground)]">{label}</label>
      {children}
    </div>
  )
}

// A friendly, reasonably-unique default name for a freshly saved template.
function defaultName(existing: StrategyTemplate[]): string {
  const base = "New template"
  const names = new Set(existing.map((t) => t.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}
