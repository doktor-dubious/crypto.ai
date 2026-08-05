"use client"

// Name / Description / Notes for a strategy being created off a workbench page.
// The parameters and the scope come from whatever is on screen — this dialog
// only asks for the things a human has to write down.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Globe, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

export function CreateStrategyDialog({
  open,
  abstract,
  defaultName,
  // > 0 when a coin GROUP is selected: one strategy per member will be created,
  // each suffixed with its coin symbol.
  groupCount,
  // "BTCUSDT · 5m" for a concrete strategy; null for an abstract one.
  scopeSummary,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean
  abstract: boolean
  defaultName: string
  groupCount: number
  scopeSummary: string | null
  saving: boolean
  onCancel: () => void
  onSubmit: (fields: { name: string; description: string; notes: string }) => void
}) {
  const t = useTranslations("strategies")
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState("")
  const [notes, setNotes] = useState("")

  // Re-seed each time the dialog opens — the suggested name follows the scope
  // and the kind, both of which can change between two opens.
  useEffect(() => {
    if (!open) return
    setName(defaultName)
    setDescription("")
    setNotes("")
  }, [open, defaultName])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {abstract ? <Globe className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {abstract ? t("createAbstract") : t("createStrategy")}
          </DialogTitle>
          <DialogDescription>
            {abstract
              ? t("createAbstractDescription")
              : groupCount > 0
                ? t("createGroupDescription", { count: groupCount })
                : t("createStrategyDescription", { scope: scopeSummary ?? "—" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <Field label={t("fieldName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            {groupCount > 0 && (
              <p className="text-[10px] text-[var(--muted-foreground)]">{t("createGroupNameHint")}</p>
            )}
          </Field>
          <Field label={t("fieldDescription")}>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("fieldDescriptionPlaceholder")}
            />
          </Field>
          <Field label={t("fieldNotes")}>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="resize-none"
              placeholder={t("fieldNotesPlaceholder")}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || saving}
            onClick={() => onSubmit({ name, description, notes })}
          >
            {saving ? t("creating") : t("create")}
          </Button>
        </DialogFooter>
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
