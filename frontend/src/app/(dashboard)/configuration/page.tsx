"use client"

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Info, Settings, Users, Search } from "lucide-react"
import { useCustomer } from "@/components/providers/customer-provider"
import { ViewSwitcher } from "@/components/ui/view-switcher"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  configurationApi,
  customerConfigurationApi,
  customersApi,
  currenciesApi,
  predictionEnginesApi,
  outletGroupsApi,
  type CurrencyResponse,
  type CustomerResponse,
  type PredictionEngineResponse,
  type OutletGroupResponse,
} from "@/lib/api"

// ─── Sub-components (matching prediction→strategies patterns) ────────────────

function InfoIcon({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0 mt-px" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function FieldRow({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {info && <InfoIcon text={info} />}
      </div>
      {children}
    </div>
  )
}

function SwitchRow({
  label,
  info,
  checked,
  onCheckedChange,
}: {
  label: string
  info?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{label}</span>
        {info && <InfoIcon text={info} />}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

const selectClassName = "flex h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer"

function CurrencyCombobox({
  value,
  onChange,
  currencies,
  placeholder,
  searchPlaceholder,
}: {
  value: string
  onChange: (value: string) => void
  currencies: CurrencyResponse[]
  placeholder: string
  searchPlaceholder: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return currencies
    const q = search.toLowerCase()
    return currencies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q) ||
        c.iso_4217.toLowerCase().includes(q)
    )
  }, [currencies, search])

  const selected = currencies.find((c) => c.id === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={selectClassName}
      >
        <span className={`flex-1 text-left ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? `${selected.symbol} ${selected.name}` : placeholder}
        </span>
        <svg className="h-4 w-4 opacity-50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--popover)] shadow-md">
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-sm"
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); setSearch("") }}
              className="w-full px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-[var(--accent)] cursor-pointer"
            >
              {placeholder}
            </button>
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false); setSearch("") }}
                className={`w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--accent)] cursor-pointer ${c.id === value ? "font-medium bg-[var(--accent)]" : ""}`}
              >
                {c.symbol} {c.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                No results
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab content components ──────────────────────────────────────────────────

function CustomerDetailsTab({
  draft,
  setDraft,
  t,
}: {
  draft: Partial<CustomerResponse>
  setDraft: (fn: (d: Partial<CustomerResponse>) => Partial<CustomerResponse>) => void
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  return (
    <>
      <FieldRow label={t("fieldName")}>
        <Input
          value={draft.name ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </FieldRow>
      <FieldRow label={t("fieldDescription")}>
        <Textarea
          value={draft.description ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          rows={4}
          className="resize-none"
        />
      </FieldRow>
      <FieldRow label={t("fieldNotes")}>
        <Textarea
          value={draft.notes ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          rows={4}
          className="resize-none"
        />
      </FieldRow>
    </>
  )
}

function CoreTab({
  draft,
  setDraft,
  engines,
  groups,
  currencies,
  isGorm,
  t,
}: {
  draft: Record<string, unknown>
  setDraft: (fn: (d: Record<string, unknown>) => Record<string, unknown>) => void
  engines: PredictionEngineResponse[]
  groups: OutletGroupResponse[]
  currencies: CurrencyResponse[]
  isGorm: boolean
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }))

  return (
    <>
      {!isGorm && (
        <FieldRow label={t("fieldProductionGroup")} info={t("fieldProductionGroupInfo")}>
          <select
            value={(draft.group_id as string) ?? ""}
            onChange={(e) => set("group_id", e.target.value || null)}
            className={selectClassName}
          >
            <option value="">{t("fieldGroupNone")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </FieldRow>
      )}

      <FieldRow label={t("fieldPredictionEngine")} info={t("fieldPredictionEngineInfo")}>
        <select
          value={(draft.prediction_engine_id as string) ?? ""}
          onChange={(e) => set("prediction_engine_id", e.target.value || null)}
          className={selectClassName}
        >
          <option value="">{t("fieldEngineNone")}</option>
          {engines.map((engine) => (
            <option key={engine.id} value={engine.id}>{engine.name}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label={t("fieldMinimum")} info={t("fieldMinimumInfo")}>
        <Input
          type="number"
          min={1}
          step={1}
          value={draft.minimum_delivery != null ? String(draft.minimum_delivery) : ""}
          onChange={(e) => {
            const v = e.target.value
            set("minimum_delivery", v === "" ? null : Math.max(1, parseInt(v, 10) || 1))
          }}
          className="h-8 text-sm max-w-[140px]"
        />
      </FieldRow>

      <FieldRow label={t("fieldCostPerUnit")} info={t("fieldCostPerUnitInfo")}>
        <Input
          type="number"
          step="0.01"
          value={draft.cost_per_unit != null ? String(draft.cost_per_unit) : ""}
          onChange={(e) => {
            const v = e.target.value
            set("cost_per_unit", v === "" ? null : parseFloat(v))
          }}
          placeholder="—"
          className="h-8 text-sm max-w-[140px]"
        />
      </FieldRow>

      <FieldRow label={t("fieldProfitPerUnit")} info={t("fieldProfitPerUnitInfo")}>
        <Input
          type="number"
          step="0.01"
          value={draft.profit_per_unit != null ? String(draft.profit_per_unit) : ""}
          onChange={(e) => {
            const v = e.target.value
            set("profit_per_unit", v === "" ? null : parseFloat(v))
          }}
          placeholder="—"
          className="h-8 text-sm max-w-[140px]"
        />
      </FieldRow>

      {!isGorm && (
        <FieldRow label={t("fieldCurrency")} info={t("fieldCurrencyInfo")}>
          <CurrencyCombobox
            value={(draft.currency_id as string) ?? ""}
            onChange={(v) => set("currency_id", v || null)}
            currencies={currencies}
            placeholder={t("fieldCurrencyNone")}
            searchPlaceholder={t("fieldCurrencySearch")}
          />
        </FieldRow>
      )}

      <FieldRow label={t("fieldRounding")} info={t("fieldRoundingInfo")}>
        <select
          value={String(draft.eo_to_delivery_rounding ?? (isGorm ? 1 : ""))}
          onChange={(e) => set("eo_to_delivery_rounding", e.target.value === "" ? null : parseInt(e.target.value, 10))}
          className={selectClassName}
        >
          {!isGorm && <option value="">{t("roundingRound")}</option>}
          <option value="1">{t("roundingRound")}</option>
          <option value="2">{t("roundingCeil")}</option>
          <option value="3">{t("roundingFloor")}</option>
        </select>
      </FieldRow>
    </>
  )
}

function WeekdayTab({
  draft,
  setDraft,
  t,
}: {
  draft: Record<string, unknown>
  setDraft: (fn: (d: Record<string, unknown>) => Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  const set = (key: string, value: boolean) => setDraft((d) => ({ ...d, [key]: value }))

  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const

  return (
    <>
      {/* Weekday Correction */}
      <div>
        <div className="mb-1">
          <h3 className="text-sm font-semibold">{t("sectionCorrection")}</h3>
          <p className="text-xs text-muted-foreground">{t("sectionCorrectionDesc")}</p>
        </div>
        <div className="mt-3">
          {DAYS.map((day) => {
            const key = `weekday_correction_${day}` as const
            const labelKey = `weekdayCorrection${day.charAt(0).toUpperCase()}${day.slice(1)}` as Parameters<typeof t>[0]
            return (
              <SwitchRow
                key={key}
                label={t(labelKey)}
                info={t("weekdayCorrectionInfo")}
                checked={draft[key] as boolean ?? false}
                onCheckedChange={(v) => set(key, v)}
              />
            )
          })}
        </div>
      </div>

      {/* Weekday Isolation */}
      <div>
        <div className="mb-1">
          <h3 className="text-sm font-semibold">{t("sectionIsolation")}</h3>
          <p className="text-xs text-muted-foreground">{t("sectionIsolationDesc")}</p>
        </div>
        <div className="mt-3">
          {DAYS.map((day) => {
            const key = `weekday_only_${day}` as const
            const labelKey = `weekdayOnly${day.charAt(0).toUpperCase()}${day.slice(1)}` as Parameters<typeof t>[0]
            return (
              <SwitchRow
                key={key}
                label={t(labelKey)}
                info={t("weekdayOnlyInfo")}
                checked={draft[key] as boolean ?? false}
                onCheckedChange={(v) => set(key, v)}
              />
            )
          })}
        </div>
      </div>

      {/* Profile Correction */}
      <div>
        <div className="mb-1">
          <h3 className="text-sm font-semibold">{t("sectionProfile")}</h3>
        </div>
        <SwitchRow
          label={t("weekdayProfileCorrection")}
          info={t("weekdayProfileCorrectionInfo")}
          checked={draft.weekday_profile_correction as boolean ?? false}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, weekday_profile_correction: v }))}
        />
        {(draft.weekday_profile_correction as boolean) && (
          <div className="mt-3 ml-4 space-y-3 border-l-2 border-[var(--border)] pl-4">
            <FieldRow label={t("weekdayProfileCorrectionStrength")} info={t("weekdayProfileCorrectionStrengthInfo")}>
              <Input
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={draft.weekday_profile_correction_strength != null ? String(draft.weekday_profile_correction_strength) : "1.0"}
                onChange={(e) => {
                  const v = e.target.value
                  setDraft((d) => ({
                    ...d,
                    weekday_profile_correction_strength: v === "" ? null : Math.max(0, Math.min(1, parseFloat(v) || 0)),
                  }))
                }}
                className="h-8 text-sm max-w-[140px]"
              />
            </FieldRow>
            <FieldRow label={t("weekdayProfileCorrectionThreshold")} info={t("weekdayProfileCorrectionThresholdInfo")}>
              <Input
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={draft.weekday_profile_correction_threshold != null ? String(draft.weekday_profile_correction_threshold) : "0.0"}
                onChange={(e) => {
                  const v = e.target.value
                  setDraft((d) => ({
                    ...d,
                    weekday_profile_correction_threshold: v === "" ? null : Math.max(0, Math.min(1, parseFloat(v) || 0)),
                  }))
                }}
                className="h-8 text-sm max-w-[140px]"
              />
            </FieldRow>
          </div>
        )}
      </div>
    </>
  )
}

function WorkersTab({
  draft,
  setDraft,
  t,
}: {
  draft: Record<string, unknown>
  setDraft: (fn: (d: Record<string, unknown>) => Record<string, unknown>) => void
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }))

  return (
    <>
      <FieldRow label={t("fieldSimultaneousTasks")} info={t("fieldSimultaneousTasksInfo")}>
        <Input
          type="number"
          min={1}
          max={8}
          step={1}
          value={draft.simultaneous_tasks != null ? String(draft.simultaneous_tasks) : "1"}
          onChange={(e) => {
            const v = e.target.value
            set("simultaneous_tasks", v === "" ? 1 : Math.max(1, Math.min(8, parseInt(v, 10) || 1)))
          }}
          className="h-8 text-sm max-w-[140px]"
        />
      </FieldRow>

      <FieldRow label={t("fieldPeriodicCheck")} info={t("fieldPeriodicCheckInfo")}>
        <Input
          type="number"
          min={1}
          step={1}
          value={draft.periodic_check_workers != null ? String(draft.periodic_check_workers) : "2"}
          onChange={(e) => {
            const v = e.target.value
            set("periodic_check_workers", v === "" ? 2 : Math.max(1, parseInt(v, 10) || 2))
          }}
          className="h-8 text-sm max-w-[140px]"
        />
      </FieldRow>

      <SwitchRow
        label={t("fieldAutoRestart")}
        info={t("fieldAutoRestartInfo")}
        checked={draft.auto_restart_workers as boolean ?? true}
        onCheckedChange={(v) => set("auto_restart_workers", v)}
      />
    </>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const TAB_CLASS = "bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"

export default function ConfigurationPage() {
  const t = useTranslations("configuration")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<"gorm" | "customer">("customer")
  const [tab, setTab] = useState("details")
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Data Queries ──
  const { data: gormConfig } = useQuery({
    queryKey: ["configuration"],
    queryFn: configurationApi.get,
  })

  const { data: customerConfig } = useQuery({
    queryKey: ["customerConfiguration", activeCustomer?.id],
    queryFn: () => customerConfigurationApi.get(activeCustomer!.id),
    enabled: !!activeCustomer,
    retry: false,
  })

  const { data: engines = [] } = useQuery({
    queryKey: ["predictionEngines"],
    queryFn: predictionEnginesApi.list,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ["outletGroups", activeCustomer?.id],
    queryFn: () => outletGroupsApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const { data: currencies = [] } = useQuery({
    queryKey: ["currencies"],
    queryFn: currenciesApi.list,
  })

  // ── Draft State ──
  const [customerDraft, setCustomerDraft] = useState<Partial<CustomerResponse>>({})
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>({})
  const [gormDraft, setGormDraft] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (activeCustomer) {
      setCustomerDraft({
        name: activeCustomer.name,
        description: activeCustomer.description,
        notes: activeCustomer.notes,
      })
    }
  }, [activeCustomer])

  useEffect(() => {
    if (customerConfig) setConfigDraft({ ...customerConfig })
  }, [customerConfig])

  useEffect(() => {
    if (gormConfig) setGormDraft({ ...gormConfig })
  }, [gormConfig])

  useEffect(() => {
    if (mode === "gorm") setTab("core")
    else setTab("details")
  }, [mode])

  // ── Tab indicator ──
  useEffect(() => {
    if (!tabsListRef.current) return
    const el = tabsListRef.current.querySelector("[data-state='active']") as HTMLElement | null
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth })
  }, [tab, mode, activeCustomer])

  // ── Dirty Detection ──
  const isCustomerDirty = useMemo(() => {
    if (!activeCustomer) return false
    return (
      customerDraft.name !== activeCustomer.name ||
      customerDraft.description !== activeCustomer.description ||
      customerDraft.notes !== activeCustomer.notes
    )
  }, [customerDraft, activeCustomer])

  const isConfigDirty = useMemo(() => {
    if (!customerConfig) return false
    const source = customerConfig as unknown as Record<string, unknown>
    return Object.keys(configDraft).some((k) => configDraft[k] !== source[k])
  }, [configDraft, customerConfig])

  const isGormDirty = useMemo(() => {
    if (!gormConfig) return false
    const source = gormConfig as unknown as Record<string, unknown>
    return Object.keys(gormDraft).some((k) => gormDraft[k] !== source[k])
  }, [gormDraft, gormConfig])

  const isDirty = mode === "gorm" ? isGormDirty : (tab === "details" ? isCustomerDirty : isConfigDirty)

  // ── Mutations ──
  const customerMutation = useMutation({
    mutationFn: () =>
      customersApi.update(activeCustomer!.id, {
        name: customerDraft.name,
        description: customerDraft.description,
        notes: customerDraft.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      toast.success(t("toastCustomerUpdated"))
    },
    onError: () => toast.error(t("toastError")),
  })

  const configMutation = useMutation({
    mutationFn: () => {
      if (!customerConfig) return Promise.resolve(null)
      const changes: Record<string, unknown> = {}
      const source = customerConfig as unknown as Record<string, unknown>
      for (const k of Object.keys(configDraft)) {
        if (configDraft[k] !== source[k]) changes[k] = configDraft[k]
      }
      return customerConfigurationApi.patch(activeCustomer!.id, changes)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customerConfiguration", activeCustomer?.id] })
      toast.success(t("toastConfigUpdated"))
    },
    onError: () => toast.error(t("toastError")),
  })

  const gormMutation = useMutation({
    mutationFn: () => {
      if (!gormConfig) return Promise.resolve(null)
      const changes: Record<string, unknown> = {}
      const source = gormConfig as unknown as Record<string, unknown>
      for (const k of Object.keys(gormDraft)) {
        if (gormDraft[k] !== source[k]) changes[k] = gormDraft[k]
      }
      return configurationApi.update(changes)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuration"] })
      toast.success(t("toastConfigUpdated"))
    },
    onError: () => toast.error(t("toastError")),
  })

  function handleSave() {
    if (mode === "gorm") gormMutation.mutate()
    else if (tab === "details") customerMutation.mutate()
    else configMutation.mutate()
  }

  function handleCancel() {
    if (mode === "gorm") {
      if (gormConfig) setGormDraft({ ...gormConfig })
    } else if (tab === "details") {
      if (activeCustomer) {
        setCustomerDraft({
          name: activeCustomer.name,
          description: activeCustomer.description,
          notes: activeCustomer.notes,
        })
      }
    } else {
      if (customerConfig) setConfigDraft({ ...customerConfig })
    }
  }

  const isSaving = customerMutation.isPending || configMutation.isPending || gormMutation.isPending

  // ── Render ──

  const renderTabs = (tabValues: { value: string; label: string }[], content: ReactNode) => (
    <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden gap-0">
      <div className="relative w-full">
        <TabsList ref={tabsListRef} className="w-full bg-transparent border-b border-neutral-700 rounded-none p-0 h-auto flex">
          {tabValues.map((tv) => (
            <TabsTrigger key={tv.value} value={tv.value} className={TAB_CLASS}>
              {tv.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div
          className="absolute bottom-0 h-0.5 bg-white transition-all duration-300 ease-in-out z-0"
          style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
        />
      </div>
      {content}
    </Tabs>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header with ViewSwitcher */}
        <div className="shrink-0 px-4 py-3">
          <ViewSwitcher
            options={[
              { id: "gorm", label: t("gormMode"), icon: <Settings /> },
              {
                id: "customer",
                label: activeCustomer ? t("customerMode", { name: activeCustomer.name }) : t("noCustomer"),
                icon: <Users />,
              },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "gorm" | "customer")}
          />
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4">
          {mode === "gorm" ? (
            renderTabs(
              [
                { value: "core", label: t("tabCore") },
                { value: "weekday", label: t("tabWeekday") },
                { value: "workers", label: t("tabWorkers") },
              ],
              <>
                <TabsContent value="core" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-y-auto">
                  <CoreTab
                    draft={gormDraft}
                    setDraft={setGormDraft}
                    engines={engines}
                    groups={[]}
                    currencies={[]}
                    isGorm={true}
                    t={t}
                  />
                </TabsContent>
                <TabsContent value="weekday" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-y-auto">
                  <WeekdayTab draft={gormDraft} setDraft={setGormDraft} t={t} />
                </TabsContent>
                <TabsContent value="workers" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-y-auto">
                  <WorkersTab draft={gormDraft} setDraft={setGormDraft} t={t} />
                </TabsContent>
              </>
            )
          ) : activeCustomer ? (
            renderTabs(
              [
                { value: "details", label: t("tabDetails") },
                { value: "core", label: t("tabCore") },
                { value: "weekday", label: t("tabWeekday") },
              ],
              <>
                <TabsContent value="details" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-y-auto">
                  <CustomerDetailsTab draft={customerDraft} setDraft={setCustomerDraft} t={t} />
                </TabsContent>
                <TabsContent value="core" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-y-auto">
                  <CoreTab
                    draft={configDraft}
                    setDraft={setConfigDraft}
                    engines={engines}
                    groups={groups}
                    currencies={currencies}
                    isGorm={false}
                    t={t}
                  />
                </TabsContent>
                <TabsContent value="weekday" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-y-auto">
                  <WeekdayTab draft={configDraft} setDraft={setConfigDraft} t={t} />
                </TabsContent>
              </>
            )
          ) : (
            <p className="text-sm text-muted-foreground mt-4">{t("noCustomer")}</p>
          )}
        </div>

        {/* Sticky save/cancel bar */}
        {isDirty && (
          <div className="shrink-0 border-t flex items-center justify-end gap-2 px-4 py-2 bg-background">
            <Button variant="secondary" size="sm" onClick={handleCancel} className="cursor-pointer">
              {t("cancelChanges")}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="cursor-pointer">
              {isSaving ? t("saving") : t("saveChanges")}
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
