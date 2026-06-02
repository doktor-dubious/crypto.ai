"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import type { SimulationParametersOverride } from "@/lib/api"

export type ParamKey =
  | "variation_adjustment"
  | "eo_methodology"
  | "eo_extrapolation"
  | "weekday_profile_correction"
  | "covariate_handling"
  | "covariate_weekday"
  | "covariate_price"
  | "covariate_pad"

type ParamValue = boolean | number | string

export type ParametersState = Record<ParamKey, { override: boolean; value: ParamValue }>

export const DEFAULT_PARAMS_STATE: ParametersState = {
  variation_adjustment: { override: false, value: false },
  eo_methodology: { override: false, value: 1 },
  eo_extrapolation: { override: false, value: 1 },
  weekday_profile_correction: { override: false, value: false },
  covariate_handling: { override: false, value: "external" },
  covariate_weekday: { override: false, value: true },
  covariate_price: { override: false, value: true },
  covariate_pad: { override: false, value: true },
}

export function buildParametersPayload(state: ParametersState): SimulationParametersOverride | undefined {
  const out: SimulationParametersOverride = {}
  if (state.variation_adjustment.override) out.variation_adjustment = state.variation_adjustment.value as boolean
  if (state.eo_methodology.override) out.eo_methodology = state.eo_methodology.value as number
  if (state.eo_extrapolation.override) out.eo_extrapolation = state.eo_extrapolation.value as number
  if (state.weekday_profile_correction.override) out.weekday_profile_correction = state.weekday_profile_correction.value as boolean
  if (state.covariate_handling.override) out.covariate_handling = state.covariate_handling.value as "none" | "native" | "external"
  if (state.covariate_weekday.override) out.covariate_weekday = state.covariate_weekday.value as boolean
  if (state.covariate_price.override) out.covariate_price = state.covariate_price.value as boolean
  if (state.covariate_pad.override) out.covariate_pad = state.covariate_pad.value as boolean
  return Object.keys(out).length > 0 ? out : undefined
}

const selectClassName =
  "flex h-8 rounded-md border border-[var(--input-border)] bg-[var(--input-background)] px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"

function Row({
  label,
  state,
  paramKey,
  onChange,
  children,
}: {
  label: string
  paramKey: ParamKey
  state: ParametersState
  onChange: (next: ParametersState) => void
  children: (disabled: boolean) => ReactNode
}) {
  const entry = state[paramKey]
  return (
    <div className="grid grid-cols-[auto_1fr_minmax(12rem,20rem)] items-center gap-4 py-1.5 border-b border-[var(--border)] last:border-b-0">
      <Checkbox
        checked={entry.override}
        onCheckedChange={(c) =>
          onChange({ ...state, [paramKey]: { ...entry, override: !!c } })
        }
        aria-label={`Override ${label}`}
      />
      <span className={entry.override ? "text-sm" : "text-sm text-[var(--muted-foreground)]"}>
        {label}
      </span>
      <div className="flex justify-end">{children(!entry.override)}</div>
    </div>
  )
}

export function SimulationParametersForm({
  state,
  onChange,
}: {
  state: ParametersState
  onChange: (next: ParametersState) => void
}) {
  const t = useTranslations("simulations.new")
  const tc = useTranslations("simulations.completed")

  const setField = (key: ParamKey, value: ParamValue) =>
    onChange({ ...state, [key]: { ...state[key], value } })

  return (
    <div className="flex flex-col gap-1 max-w-3xl">
      <p className="text-xs text-[var(--muted-foreground)] mb-2">
        {t("paramsOverrideHint")}
      </p>

      <div className="grid grid-cols-[auto_1fr_minmax(12rem,20rem)] gap-4 pb-2 border-b border-[var(--border)] text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
        <span>{t("paramsColOverride")}</span>
        <span>{t("paramsColParameter")}</span>
        <span className="text-right">—</span>
      </div>

      <Row label={tc("paramVariationAdjustment")} paramKey="variation_adjustment" state={state} onChange={onChange}>
        {(disabled) => (
          <Switch
            disabled={disabled}
            checked={state.variation_adjustment.value as boolean}
            onCheckedChange={(v) => setField("variation_adjustment", v)}
          />
        )}
      </Row>

      <Row label={tc("paramEoMethodology")} paramKey="eo_methodology" state={state} onChange={onChange}>
        {(disabled) => (
          <select
            className={selectClassName}
            disabled={disabled}
            value={state.eo_methodology.value as number}
            onChange={(e) => setField("eo_methodology", Number(e.target.value))}
          >
            <option value={1}>{tc("eoMethodInterpolate")}</option>
            <option value={2}>{tc("eoMethodSnap")}</option>
          </select>
        )}
      </Row>

      <Row label={tc("paramEoExtrapolation")} paramKey="eo_extrapolation" state={state} onChange={onChange}>
        {(disabled) => (
          <select
            className={selectClassName}
            disabled={disabled}
            value={state.eo_extrapolation.value as number}
            onChange={(e) => setField("eo_extrapolation", Number(e.target.value))}
          >
            <option value={1}>{tc("eoExtrapE99")}</option>
            <option value={2}>{tc("eoExtrapE95")}</option>
            <option value={3}>{tc("eoExtrapE90")}</option>
          </select>
        )}
      </Row>

      <Row label={tc("paramWeekdayProfileCorrection")} paramKey="weekday_profile_correction" state={state} onChange={onChange}>
        {(disabled) => (
          <Switch
            disabled={disabled}
            checked={state.weekday_profile_correction.value as boolean}
            onCheckedChange={(v) => setField("weekday_profile_correction", v)}
          />
        )}
      </Row>

      <Row label={tc("paramCovariateHandling")} paramKey="covariate_handling" state={state} onChange={onChange}>
        {(disabled) => (
          <select
            className={selectClassName}
            disabled={disabled}
            value={state.covariate_handling.value as string}
            onChange={(e) => setField("covariate_handling", e.target.value)}
          >
            <option value="none">{tc("covHandlingNone")}</option>
            <option value="external">{tc("covHandlingExternal")}</option>
            <option value="native">{tc("covHandlingNative")}</option>
          </select>
        )}
      </Row>

      <Row label={tc("paramCovariateWeekday")} paramKey="covariate_weekday" state={state} onChange={onChange}>
        {(disabled) => (
          <Switch
            disabled={disabled}
            checked={state.covariate_weekday.value as boolean}
            onCheckedChange={(v) => setField("covariate_weekday", v)}
          />
        )}
      </Row>

      <Row label={tc("paramCovariatePrice")} paramKey="covariate_price" state={state} onChange={onChange}>
        {(disabled) => (
          <Switch
            disabled={disabled}
            checked={state.covariate_price.value as boolean}
            onCheckedChange={(v) => setField("covariate_price", v)}
          />
        )}
      </Row>

      <Row label={tc("paramCovariatePad")} paramKey="covariate_pad" state={state} onChange={onChange}>
        {(disabled) => (
          <Switch
            disabled={disabled}
            checked={state.covariate_pad.value as boolean}
            onCheckedChange={(v) => setField("covariate_pad", v)}
          />
        )}
      </Row>
    </div>
  )
}
