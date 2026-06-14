"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { coinsApi, type CoinCreate } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

export default function NewCoinPage() {
  const t = useTranslations("coinsNew")
  const router = useRouter()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<CoinCreate>({
    symbol: "",
    name: "",
    description: null,
    type: null,
  })

  const createMutation = useMutation({
    mutationFn: (data: CoinCreate) => coinsApi.create(data),
    onSuccess: (coin) => {
      toast.success(t("toastCreated").replace("{name}", coin.name))
      queryClient.invalidateQueries({ queryKey: ["coins"] })
      router.push("/coins")
    },
    onError: () => {
      toast.error(t("toastCreateError"))
    },
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!formData.symbol.trim()) {
      toast.error("Coin symbol is required")
      return
    }
    if (!formData.name.trim()) {
      toast.error("Coin name is required")
      return
    }
    createMutation.mutate(formData)
  }

  const handleClear = () => {
    setFormData({
      symbol: "",
      name: "",
      description: null,
      type: null,
    })
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Create Coin</h1>
        <p className="text-sm text-muted-foreground mt-1">Add a new cryptocurrency coin to the system</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 bg-card border rounded-lg p-6">
        <div>
          <Label htmlFor="symbol">{t("fieldSymbol")}</Label>
          <Input
            id="symbol"
            placeholder={t("fieldSymbolPlaceholder")}
            value={formData.symbol}
            onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
            required
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="name">{t("fieldName")}</Label>
          <Input
            id="name"
            placeholder={t("fieldNamePlaceholder")}
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </div>

        <div>
          <Label htmlFor="description">{t("fieldDescription")}</Label>
          <Textarea
            id="description"
            placeholder={t("fieldDescriptionPlaceholder")}
            value={formData.description || ""}
            onChange={(e) => setFormData({ ...formData, description: e.target.value || null })}
            rows={4}
          />
        </div>

        <div>
          <Label htmlFor="type">{t("fieldType")}</Label>
          <Input
            id="type"
            placeholder={t("fieldTypePlaceholder")}
            value={formData.type || ""}
            onChange={(e) => setFormData({ ...formData, type: e.target.value || null })}
          />
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            disabled={createMutation.isPending}
          >
            {t("clearButton")}
          </Button>
          <Button type="submit" disabled={createMutation.isPending || !formData.symbol.trim() || !formData.name.trim()}>
            {createMutation.isPending ? t("creating") : t("createButton")}
          </Button>
        </div>
      </form>
    </div>
  )
}
