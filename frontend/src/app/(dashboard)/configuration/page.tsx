"use client"

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Info, Settings, Users, Search } from "lucide-react"
import { AnimateIcon } from "@/components/animate-ui/icons/icon"
import { CopyIcon } from "@/components/animate-ui/icons/copy"
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
  predictionStrategiesApi,
  tasksApi,
  llmsApi,
  type PredictionStrategyResponse,
  type WorkerInfo,
  outletGroupsApi,
  type CurrencyResponse,
  type CustomerResponse,
  type PredictionEngineResponse,
  type OutletGroupResponse,
  type LlmResponse,
  type LlmSubmodelResponse,
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
  customerId,
  draft,
  setDraft,
  t,
}: {
  customerId: string
  draft: Partial<CustomerResponse>
  setDraft: (fn: (d: Partial<CustomerResponse>) => Partial<CustomerResponse>) => void
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  return (
    <>
      <FieldRow label={t("fieldCustomerId")}>
        <div className="relative">
          <Input value={customerId} readOnly className="pr-9 bg-[var(--muted)]/40 text-[var(--muted-foreground)] cursor-default" />
          <AnimateIcon animateOnHover className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 cursor-pointer">
            <CopyIcon
              size={16}
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                navigator.clipboard.writeText(customerId)
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

      <FieldRow label={t("fieldPricePerUnit")} info={t("fieldPricePerUnitInfo")}>
        <Input
          type="number"
          step="0.01"
          value={draft.price_per_unit != null ? String(draft.price_per_unit) : ""}
          onChange={(e) => {
            const v = e.target.value
            set("price_per_unit", v === "" ? null : parseFloat(v))
          }}
          placeholder="—"
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

      <FieldRow label={t("covariateHandling")} info={t("covariateHandlingInfo")}>
        <select
          value={String(draft.covariate_handling ?? (isGorm ? "external" : ""))}
          onChange={(e) => set("covariate_handling", e.target.value === "" ? null : e.target.value)}
          className={selectClassName}
        >
          {!isGorm && <option value="">{t("covariateExternal")}</option>}
          <option value="none">{t("covariateNone")}</option>
          <option value="native">{t("covariateNative")}</option>
          <option value="external">{t("covariateExternal")}</option>
        </select>
      </FieldRow>

      <SwitchRow
        label={t("variationAdjustment")}
        info={t("variationAdjustmentInfo")}
        checked={draft.variation_adjustment as boolean ?? false}
        onCheckedChange={(v) => set("variation_adjustment", v)}
      />
      {(draft.variation_adjustment as boolean) && (
        <div className="mt-1 ml-4 space-y-3 border-l-2 border-[var(--border)] pl-4">
          <FieldRow label={t("variationHistoryDays")} info={t("variationHistoryDaysInfo")}>
            <Input
              type="number"
              min={30}
              max={1825}
              step={1}
              value={draft.variation_history_days != null ? String(draft.variation_history_days) : "365"}
              onChange={(e) => {
                const v = e.target.value
                set("variation_history_days", v === "" ? null : Math.max(30, Math.min(1825, parseInt(v, 10) || 365)))
              }}
              className="h-8 text-sm max-w-[140px]"
            />
          </FieldRow>
        </div>
      )}

      <FieldRow label={t("eoMethodology")} info={t("eoMethodologyInfo")}>
        <select
          value={String(draft.eo_methodology ?? (isGorm ? 1 : ""))}
          onChange={(e) => set("eo_methodology", e.target.value === "" ? null : parseInt(e.target.value, 10))}
          className={selectClassName}
        >
          {!isGorm && <option value="">{t("eoMethodologyInterpolate")}</option>}
          <option value="1">{t("eoMethodologyInterpolate")}</option>
          <option value="2">{t("eoMethodologySnap")}</option>
        </select>
      </FieldRow>

      <FieldRow label={t("eoExtrapolation")} info={t("eoExtrapolationInfo")}>
        <select
          value={String(draft.eo_extrapolation ?? (isGorm ? 1 : ""))}
          onChange={(e) => set("eo_extrapolation", e.target.value === "" ? null : parseInt(e.target.value, 10))}
          className={selectClassName}
        >
          {!isGorm && <option value="">{t("eoExtrapolationE99")}</option>}
          <option value="1">{t("eoExtrapolationE99")}</option>
          <option value="2">{t("eoExtrapolationE95")}</option>
          <option value="4">{t("eoExtrapolationDampened")}</option>
          <option value="3">{t("eoExtrapolationCap")}</option>
        </select>
      </FieldRow>

      <SwitchRow
        label={t("fallbackEngine")}
        info={t("fallbackEngineInfo")}
        checked={draft.fallback_engine as boolean ?? false}
        onCheckedChange={(v) => set("fallback_engine", v)}
      />
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
  const FULL_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const

  return (
    <>
      {/* Opening Days */}
      <div>
        <div className="mb-1">
          <h3 className="text-sm font-semibold">{t("sectionOpenDays")}</h3>
          <p className="text-xs text-muted-foreground">{t("sectionOpenDaysDesc")}</p>
        </div>
        <div className="mt-3">
          {FULL_DAYS.map((day) => {
            const key = `open_${day}` as const
            const labelKey = `open${day.charAt(0).toUpperCase()}${day.slice(1)}` as Parameters<typeof t>[0]
            return (
              <SwitchRow
                key={key}
                label={t(labelKey)}
                info={t("openDayInfo")}
                checked={draft[key] as boolean ?? true}
                onCheckedChange={(v) => set(key, v)}
              />
            )
          })}
        </div>
      </div>

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
            <FieldRow label={t("weekdayProfileCorrectionMethod")} info={t("weekdayProfileCorrectionMethodInfo")}>
              <select
                value={String(draft.weekday_profile_correction_method ?? 1)}
                onChange={(e) => setDraft((d) => ({ ...d, weekday_profile_correction_method: parseInt(e.target.value, 10) }))}
                className={selectClassName}
              >
                <option value="1">{t("weekdayProfileCorrectionMethodAdditive")}</option>
                <option value="2">{t("weekdayProfileCorrectionMethodMultiplicative")}</option>
              </select>
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

function FineTuningTab({
  draft,
  setDraft,
  isGorm,
  gormDefaults,
  t,
}: {
  draft: Record<string, unknown>
  setDraft: (fn: (d: Record<string, unknown>) => Record<string, unknown>) => void
  isGorm: boolean
  gormDefaults?: { finetuned_model_path?: string; finetune_sync_every?: number }
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }))

  const pathPlaceholder = gormDefaults?.finetuned_model_path || "models/timesfm_finetuned"
  const syncPlaceholder = gormDefaults?.finetune_sync_every ?? 5

  return (
    <>
      <FieldRow label={t("fieldFinetunedModelPath")} info={t("fieldFinetunedModelPathInfo")}>
        <Input
          value={(draft.finetuned_model_path as string) ?? (isGorm ? pathPlaceholder : "")}
          onChange={(e) => set("finetuned_model_path", e.target.value || (isGorm ? null : null))}
          placeholder={isGorm ? undefined : pathPlaceholder}
        />
      </FieldRow>

      <FieldRow label={t("fieldFinetuneSyncEvery")} info={t("fieldFinetuneSyncEveryInfo")}>
        <Input
          type="number"
          min={1}
          max={100}
          step={1}
          value={draft.finetune_sync_every != null ? String(draft.finetune_sync_every) : (isGorm ? String(syncPlaceholder) : "")}
          onChange={(e) => {
            const v = e.target.value
            if (v === "") {
              set("finetune_sync_every", isGorm ? syncPlaceholder : null)
            } else {
              set("finetune_sync_every", Math.max(1, Math.min(100, parseInt(v, 10) || syncPlaceholder)))
            }
          }}
          placeholder={isGorm ? undefined : String(syncPlaceholder)}
          className="h-8 text-sm max-w-[140px]"
        />
      </FieldRow>
    </>
  )
}

function InsightsTab({
  draft,
  setDraft,
  engines,
  strategies,
  workers,
  llms,
  llmSubmodels,
  t,
}: {
  draft: Record<string, unknown>
  setDraft: (d: Record<string, unknown>) => void
  engines: PredictionEngineResponse[]
  strategies: PredictionStrategyResponse[]
  workers: WorkerInfo[]
  llms: LlmResponse[]
  llmSubmodels: LlmSubmodelResponse[]
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  return (
    <div className="space-y-6">
      <FieldRow label={t("fieldInsightProvider")} info={t("fieldInsightProviderInfo")}>
        <select
          value={(draft.insight_model_id as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insight_model_id: e.target.value || null })}
          className={selectClassName}
        >
          <option value="">{t("fieldInsightProviderNone")}</option>
          {llms.map((llm) => (
            <option key={llm.id} value={llm.id}>{llm.name}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label={t("fieldInsightModel")} info={t("fieldInsightModelInfo")}>
        <select
          value={(draft.insight_submodel_id as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insight_submodel_id: e.target.value || null })}
          className={selectClassName}
        >
          <option value="">{t("fieldInsightModelNone")}</option>
          {llmSubmodels.map((sub) => (
            <option key={sub.id} value={sub.id}>{sub.name}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label={t("fieldInsightsSystemPrompt")} info={t("fieldInsightsSystemPromptInfo")}>
        <Textarea
          value={(draft.insights_system_prompt as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insights_system_prompt: e.target.value || null })}
          placeholder={t("fieldInsightsSystemPromptPlaceholder")}
          rows={8}
          className="font-mono text-xs"
        />
      </FieldRow>

      <FieldRow label={t("fieldInsightsPredictionEngine")} info={t("fieldInsightsPredictionEngineInfo")}>
        <select
          value={(draft.insights_prediction_engine_id as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insights_prediction_engine_id: e.target.value || null })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t("fieldInsightsDefault")}</option>
          {engines.map((e) => (
            <option key={e.id} value={e.id}>{e.name} ({e.slug})</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label={t("fieldInsightsPredictionStrategy")} info={t("fieldInsightsPredictionStrategyInfo")}>
        <select
          value={(draft.insights_prediction_strategy_id as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insights_prediction_strategy_id: e.target.value || null })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t("fieldInsightsDefault")}</option>
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label={t("fieldInsightsWorker")} info={t("fieldInsightsWorkerInfo")}>
        <select
          value={(draft.insights_worker as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insights_worker: e.target.value || null })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t("fieldInsightsDefault")}</option>
          {workers.map((w) => (
            <option key={w.name} value={w.name}>{w.name}</option>
          ))}
        </select>
      </FieldRow>
    </div>
  )
}

function GormInsightsTab({
  draft,
  setDraft,
  llms,
  llmSubmodels,
  t,
}: {
  draft: Record<string, unknown>
  setDraft: (d: Record<string, unknown>) => void
  llms: LlmResponse[]
  llmSubmodels: LlmSubmodelResponse[]
  t: ReturnType<typeof useTranslations<"configuration">>
}) {
  return (
    <div className="space-y-6">
      <FieldRow label={t("fieldInsightProvider")} info={t("fieldInsightProviderInfo")}>
        <select
          value={(draft.insight_model_id as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insight_model_id: e.target.value || null })}
          className={selectClassName}
        >
          <option value="">{t("fieldInsightProviderNone")}</option>
          {llms.map((llm) => (
            <option key={llm.id} value={llm.id}>{llm.name}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label={t("fieldInsightModel")} info={t("fieldInsightModelInfo")}>
        <select
          value={(draft.insight_submodel_id as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insight_submodel_id: e.target.value || null })}
          className={selectClassName}
        >
          <option value="">{t("fieldInsightModelNone")}</option>
          {llmSubmodels.map((sub) => (
            <option key={sub.id} value={sub.id}>{sub.name}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label={t("fieldInsightsHiddenPrompt")} info={t("fieldInsightsHiddenPromptInfo")}>
        <Textarea
          value={(draft.insights_hidden_prompt as string) ?? ""}
          onChange={(e) => setDraft({ ...draft, insights_hidden_prompt: e.target.value || null })}
          placeholder={t("fieldInsightsHiddenPromptPlaceholder")}
          rows={12}
          className="font-mono text-xs"
        />
      </FieldRow>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const TAB_CLASS = "bg-transparent! rounded-none border-b-2 border-r-0 border-l-0 border-t-0 border-transparent data-[state=active]:bg-transparent relative z-10 cursor-pointer"

const CFG_PREFIX = "gorm:config:"
function loadCfgV<T>(cid: string, k: string, fb: T): T { if (typeof window === "undefined") return fb; try { const r = localStorage.getItem(`${CFG_PREFIX}${cid}:${k}`); return r ? JSON.parse(r) : fb } catch { return fb } }
function saveCfgV(cid: string, k: string, v: unknown) { if (typeof window !== "undefined") localStorage.setItem(`${CFG_PREFIX}${cid}:${k}`, JSON.stringify(v)) }

export default function ConfigurationPage() {
  const t = useTranslations("configuration")
  const { activeCustomer } = useCustomer()
  const queryClient = useQueryClient()
  const cid = activeCustomer?.id ?? ""

  const [mode, setMode] = useState<"gorm" | "customer">(() => loadCfgV<"gorm" | "customer">(cid, "mode", "customer"))
  const [tab, setTab] = useState(() => loadCfgV<string>(cid, "tab", "details"))
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  // ── Persist ────────────────────────────────────────────────────────────────
  useEffect(() => { if (cid) saveCfgV(cid, "mode", mode) }, [cid, mode])
  useEffect(() => { if (cid) saveCfgV(cid, "tab", tab) }, [cid, tab])
  const prevCidRef = useRef(cid)
  useEffect(() => { if (prevCidRef.current && cid && prevCidRef.current !== cid) { setMode(loadCfgV(cid, "mode", "customer")); setTab(loadCfgV(cid, "tab", "details")) }; prevCidRef.current = cid }, [cid])

  // ── Data Queries ──
  const { data: gormConfig } = useQuery({
    queryKey: ["configuration"],
    queryFn: configurationApi.get,
    staleTime: 5 * 60 * 1000,
  })

  const { data: customerConfig } = useQuery({
    queryKey: ["customerConfiguration", activeCustomer?.id],
    queryFn: () => customerConfigurationApi.get(activeCustomer!.id),
    enabled: !!activeCustomer,
    staleTime: 5 * 60 * 1000,
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

  const { data: strategies = [] } = useQuery({
    queryKey: ["predictionStrategies", activeCustomer?.id],
    queryFn: () => predictionStrategiesApi.list(activeCustomer!.id),
    enabled: !!activeCustomer,
  })

  const { data: workers = [] } = useQuery({
    queryKey: ["workers"],
    queryFn: tasksApi.listWorkers,
    staleTime: 60_000,
  })

  const { data: currencies = [] } = useQuery({
    queryKey: ["currencies"],
    queryFn: currenciesApi.list,
  })

  const { data: llms = [] } = useQuery({
    queryKey: ["llms"],
    queryFn: llmsApi.list,
  })

  const { data: llmSubmodels = [] } = useQuery({
    queryKey: ["llmSubmodels"],
    queryFn: llmsApi.listSubmodels,
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
    if (!customerConfig) {
      // No config exists yet — dirty if the user has set any non-null value
      return Object.values(configDraft).some((v) => v != null)
    }
    const source = customerConfig as unknown as Record<string, unknown>
    return Object.keys(configDraft).some((k) => configDraft[k] !== source[k])
  }, [configDraft, customerConfig])

  const isGormDirty = useMemo(() => {
    if (!gormConfig) return false
    const source = gormConfig as unknown as Record<string, unknown>
    return Object.keys(gormDraft).some((k) => gormDraft[k] !== source[k])
  }, [gormDraft, gormConfig])

  const isDirty = mode === "gorm" ? isGormDirty : (tab === "details" ? isCustomerDirty : tab === "automatization" ? false : isConfigDirty)

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
    onError: (e) => toast.error(t("toastError"), { description: e instanceof Error ? e.message : undefined }),
  })

  const configMutation = useMutation({
    mutationFn: async () => {
      if (!customerConfig) {
        // No config exists yet — create one
        const data: Record<string, unknown> = {}
        for (const k of Object.keys(configDraft)) {
          if (configDraft[k] != null) data[k] = configDraft[k]
        }
        try {
          return await customerConfigurationApi.create(activeCustomer!.id, data)
        } catch (e) {
          // If create fails with 409/500 (config may already exist), try patch instead
          if (e instanceof Error && e.message.includes("500")) {
            return customerConfigurationApi.patch(activeCustomer!.id, data)
          }
          throw e
        }
      }
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
    onError: (e) => toast.error(t("toastError"), { description: e instanceof Error ? e.message : undefined }),
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
    onError: (e) => toast.error(t("toastError"), { description: e instanceof Error ? e.message : undefined }),
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
    <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col gap-0">
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
      <div className="flex h-full flex-col">
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
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-4">
          {mode === "gorm" ? (
            renderTabs(
              [
                { value: "core", label: t("tabCore") },
                { value: "weekday", label: t("tabWeekday") },
                { value: "workers", label: t("tabWorkers") },
                { value: "finetuning", label: t("tabFineTuning") },
                { value: "insights", label: t("tabInsights") },
              ],
              <>
                <TabsContent value="core" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
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
                <TabsContent value="weekday" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
                  <WeekdayTab draft={gormDraft} setDraft={setGormDraft} t={t} />
                </TabsContent>
                <TabsContent value="workers" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
                  <WorkersTab draft={gormDraft} setDraft={setGormDraft} t={t} />
                </TabsContent>
                <TabsContent value="finetuning" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
                  <FineTuningTab draft={gormDraft} setDraft={setGormDraft} isGorm={true} t={t} />
                </TabsContent>
                <TabsContent value="insights" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
                  <GormInsightsTab draft={gormDraft} setDraft={setGormDraft} llms={llms} llmSubmodels={llmSubmodels} t={t} />
                </TabsContent>
              </>
            )
          ) : activeCustomer ? (
            renderTabs(
              [
                { value: "details", label: t("tabDetails") },
                { value: "core", label: t("tabCore") },
                { value: "weekday", label: t("tabWeekday") },
                { value: "insights", label: t("tabInsights") },
              ],
              <>
                <TabsContent value="details" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
                  <CustomerDetailsTab customerId={cid} draft={customerDraft} setDraft={setCustomerDraft} t={t} />
                </TabsContent>
                <TabsContent value="core" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
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
                <TabsContent value="weekday" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
                  <WeekdayTab draft={configDraft} setDraft={setConfigDraft} t={t} />
                </TabsContent>
                <TabsContent value="insights" className="space-y-6 max-w-2xl mt-6 pl-[2px] overflow-visible">
                  <InsightsTab draft={configDraft} setDraft={setConfigDraft} engines={engines} strategies={strategies} workers={workers} llms={llms} llmSubmodels={llmSubmodels} t={t} />
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
