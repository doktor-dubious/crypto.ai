"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { MapPin, ExternalLink } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ChatOutletRef } from "@/lib/api"

export function OutletDetailModal({
  outlet,
  open,
  onOpenChange,
}: {
  outlet: ChatOutletRef | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("insights")
  const router = useRouter()

  if (!outlet) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{outlet.name}</DialogTitle>
          <DialogDescription className="flex items-center gap-1 text-xs">
            {outlet.city || outlet.state ? (
              <>
                <MapPin className="h-3 w-3" />
                {[outlet.city, outlet.state].filter(Boolean).join(", ")}
              </>
            ) : (
              t("noLocation")
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {outlet.value != null && (
            <div className="flex items-center justify-between rounded-md bg-[var(--muted)] px-3 py-2">
              <span className="text-xs text-[var(--muted-foreground)]">
                {outlet.value_label ?? t("value")}
              </span>
              <span className="text-sm font-medium text-[var(--foreground)]">
                {outlet.value.toLocaleString()}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("close")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false)
              router.push(`/outlets?highlight=${outlet.outlet_id}`)
            }}
          >
            <ExternalLink className="mr-1 h-3 w-3" />
            {t("openInOutlets")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
