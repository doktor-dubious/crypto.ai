"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { customersApi } from "@/lib/api"
import { toast } from "sonner"

export default function CustomersNewPage() {
  const t = useTranslations("customersNew")
  const queryClient = useQueryClient()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [notes, setNotes] = useState("")

  const createMutation = useMutation({
    mutationFn: () =>
      customersApi.create({
        name: name.trim(),
        description: description.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      toast.success(t("toastCreated", { name: created.name }))
      handleClear()
    },
    onError: () => { toast.error(t("toastCreateError")) },
  })

  function handleClear() {
    setName("")
    setDescription("")
    setNotes("")
  }

  return (
    <div className="max-w-5xl px-6 py-6 flex flex-col gap-8">

      {/* ── Fields ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldName")}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("fieldNamePlaceholder")}
            className="h-8 text-sm"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldDescription")}</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("fieldDescriptionPlaceholder")}
            rows={2}
            className="resize-none text-sm"
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">{t("fieldNotes")}</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("fieldNotesPlaceholder")}
            rows={3}
            className="resize-none text-sm"
          />
        </div>

      </div>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleClear} className="cursor-pointer">
          {t("clearButton")}
        </Button>
        <Button
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !name.trim()}
          className="cursor-pointer"
        >
          {createMutation.isPending ? t("creating") : t("createButton")}
        </Button>
      </div>

    </div>
  )
}
