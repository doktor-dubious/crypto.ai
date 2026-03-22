// FastAPI backend client
// Server-side: calls BACKEND_INTERNAL_URL directly
// Client-side: routes through Next.js rewrite at /backend/

function getBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"
  }
  return ""
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl()
  const prefix = base ? "" : "/backend"
  const url = `${base}${prefix}/api/v1${path}`

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ─── Types (mirrored from FastAPI schemas) ────────────────────────────────────

export type TaskStatus = "pending" | "started" | "success" | "failure" | "revoked"
export type TaskType = "prediction" | "simulation" | "finetune"

export interface TaskRecordResponse {
  id: string
  task_id: string
  type: TaskType
  status: TaskStatus
  customer_id: string | null
  started_at: string | null
  completed_at: string | null
  error: string | null
  progress: number
  progress_message: string | null
  name: string | null
  worker_name: string | null
  peak_memory_mb: number | null
  cpu_time_s: number | null
  created_at: string
  updated_at: string
}

export interface TaskListResponse {
  items: TaskRecordResponse[]
  total: number
}

export interface CeleryWorkerTask {
  task_id: string
  name: string
  worker: string
  args: unknown[]
}

export interface CustomerResponse {
  id: string
  type: number
  name: string
  description: string | null
  notes: string | null
  active: boolean
  last_opened_at: string | null
  created_at: string
  updated_at: string
}

export interface PredictionRequest {
  customer_id: string
  outlet_ids?: string[]
  outlet_group_id?: string
  prediction_from: string
  prediction_to: string
  delay?: number
  engine?: "statistical" | "timesfm" | "timesfm_finetuned" | "custom"
  batch_size?: number
  prediction_strategy_id?: string | null
  worker?: string | null
}

export interface PredictionTaskStatus {
  task_id: string
  status: "pending" | "running" | "completed" | "failed"
  progress: number
  message: string | null
  created_at: string
  completed_at: string | null
}

// ─── API methods ──────────────────────────────────────────────────────────────

export const tasksApi = {
  list: (params?: {
    customer_id?: string
    type?: string
    status?: string
    limit?: number
    offset?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.customer_id) qs.set("customer_id", params.customer_id)
    if (params?.type) qs.set("type", params.type)
    if (params?.status) qs.set("status", params.status)
    qs.set("limit", String(params?.limit ?? 100))
    if (params?.offset) qs.set("offset", String(params.offset))
    return apiFetch<TaskListResponse>(`/tasks?${qs}`)
  },

  cancel: (taskId: string) =>
    apiFetch<void>(`/tasks/${taskId}`, { method: "DELETE" }),

  active: () =>
    apiFetch<CeleryWorkerTask[]>("/tasks/active"),

  pingWorkers: () =>
    apiFetch<{ alive: boolean }>("/tasks/workers/ping"),

  restartWorkers: () =>
    apiFetch<void>("/tasks/workers/restart", { method: "POST" }),

  listWorkers: () =>
    apiFetch<string[]>("/tasks/workers/list"),
}

export interface CustomerUpdate {
  name?: string | null
  description?: string | null
  notes?: string | null
}

export const customersApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    qs.set("limit", String(params?.limit ?? 100))
    return apiFetch<CustomerResponse[]>(`/customers?${qs}`)
  },

  get: (id: string) => apiFetch<CustomerResponse>(`/customers/${id}`),

  update: (id: string, data: CustomerUpdate) =>
    apiFetch<CustomerResponse>(`/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  opened: (id: string) =>
    apiFetch<CustomerResponse>(`/customers/${id}/opened`, { method: "POST" }),
}

export interface CompletedPredictionResponse {
  id: string
  customer_id: string
  status: "success" | "failure" | "revoked"
  task_id: string | null
  outlet_group_id: string | null
  outlet_group_name: string | null
  prediction_strategy_id: string | null
  strategy_name: string | null
  date: string | null
  engine: string | null
  requested_engine: string | null
  engine_params: Record<string, unknown> | null
  batch_size: number | null
  delay: number | null
  use_financials: boolean | null
  use_pad: boolean | null
  outlet_count: number
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface CompletedPredictionListResponse {
  items: CompletedPredictionResponse[]
  total: number
}

export interface PredictionAnalyticsSummary {
  outlet_count: number
  avg_predicted: number | null
  avg_confidence: number | null
  avg_eo: number | null
  total_delivered: number | null
  total_eo: number | null
  total_predicted: number | null
  total_lower_bound: number | null
  total_upper_bound: number | null
  min_predicted: number | null
  max_predicted: number | null
}

export interface PredictionComparisonItem {
  id: string
  name: string
  date: string | null
  draw: number
  expected_demand: number
  expected_sale: number
  expected_return: number
  sold_out_pct: number
  expected_profit: number | null
}

export interface PredictionComparisonResponse {
  items: PredictionComparisonItem[]
}

export const predictionsApi = {
  createAsync: (data: PredictionRequest) =>
    apiFetch<PredictionTaskStatus>("/predictions/async", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  list: (customerId: string, params?: { search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams({ customer_id: customerId })
    if (params?.search) qs.set("search", params.search)
    qs.set("limit", String(params?.limit ?? 50))
    if (params?.offset) qs.set("offset", String(params.offset))
    return apiFetch<CompletedPredictionListResponse>(`/predictions?${qs}`)
  },

  getAnalytics: (predictionId: string) =>
    apiFetch<PredictionAnalyticsSummary>(`/predictions/${predictionId}/analytics`),

  compare: (customerId: string, predictionIds: string[]) =>
    apiFetch<PredictionComparisonResponse>(`/predictions/compare?customer_id=${customerId}`, {
      method: "POST",
      body: JSON.stringify(predictionIds),
    }),

  delete: (predictionId: string) =>
    apiFetch<void>(`/predictions/${predictionId}`, { method: "DELETE" }),
}

export interface PredictionEngineResponse {
  id: string
  slug: string
  name: string
  description: string | null
  notes: string | null
}

export interface PredictionEngineCreate {
  slug: string
  name: string
  description?: string | null
  notes?: string | null
}

export interface PredictionEngineUpdate {
  name?: string | null
  description?: string | null
  notes?: string | null
}

export interface PredictionEngineParameterResponse {
  id: string
  prediction_engine_id: string
  prediction_strategy_id: string | null
  name: string
  value: string
  parameter: string | null
  description: string | null
  sort_order: number
  selected: boolean
}

export interface PredictionEngineParameterCreate {
  name: string
  value: string
  parameter?: string | null
  description?: string | null
  sort_order?: number
}

export const predictionEnginesApi = {
  list: () => apiFetch<PredictionEngineResponse[]>("/prediction-engines"),

  create: (data: PredictionEngineCreate) =>
    apiFetch<PredictionEngineResponse>("/prediction-engines", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: PredictionEngineUpdate) =>
    apiFetch<PredictionEngineResponse>(`/prediction-engines/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/prediction-engines/${id}`, { method: "DELETE" }),

  listParameters: (engineId: string) =>
    apiFetch<PredictionEngineParameterResponse[]>(`/prediction-engines/${engineId}/parameters`),

  createParameter: (engineId: string, data: PredictionEngineParameterCreate) =>
    apiFetch<PredictionEngineParameterResponse>(`/prediction-engines/${engineId}/parameters`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  toggleParameterSelected: (paramId: string) =>
    apiFetch<PredictionEngineParameterResponse[]>(
      `/prediction-engines/parameters/${paramId}/toggle-selected`,
      { method: "POST" },
    ),

  deleteParameter: (paramId: string) =>
    apiFetch<void>(`/prediction-engines/parameters/${paramId}`, { method: "DELETE" }),
}

// ─── Finetuning ──────────────────────────────────────────────────────────────

export interface FinetuneRequest {
  prediction_engine_id: string
  customer_id: string
  outlet_group_id?: string | null
  start_date: string
  end_date: string
  context_length?: number
  horizon?: number
  epochs?: number
  learning_rate?: number
  batch_size?: number
  worker?: string | null
}

export interface FinetuneTaskResponse {
  task_id: string
  status: string
  progress: number
  message: string | null
  created_at: string
}

export interface FinetuneCountResponse {
  count: number
}

export const finetuneApi = {
  start: (data: FinetuneRequest) =>
    apiFetch<FinetuneTaskResponse>("/prediction-engines/finetune", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  count: (engineId: string) =>
    apiFetch<FinetuneCountResponse>(`/prediction-engines/${engineId}/finetune/count`),
}

export interface PredictionStrategyResponse {
  id: string
  customer_id: string
  name: string
  description: string | null
  type: number
  prediction_engine_id: string | null
  increase_total_by_number: number | null
  increase_total_by_percentage: number | null
  increase_outlets_by_number: number | null
  increase_outlets_by_percentage: number | null
  fixed_total_draw: number | null
  total_return_percentage: number | null
  outlet_return_percentage: number | null
  ignore_fixed: boolean
  ignore_minimum: boolean
  ignore_maximum: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface PredictionStrategyCreate {
  customer_id: string
  name: string
  description?: string | null
  type?: number
}

export interface PredictionStrategyUpdate {
  name?: string | null
  description?: string | null
  type?: number | null
  prediction_engine_id?: string | null
  increase_total_by_number?: number | null
  increase_total_by_percentage?: number | null
  increase_outlets_by_number?: number | null
  increase_outlets_by_percentage?: number | null
  fixed_total_draw?: number | null
  total_return_percentage?: number | null
  outlet_return_percentage?: number | null
  ignore_fixed?: boolean | null
  ignore_minimum?: boolean | null
  ignore_maximum?: boolean | null
}

export const STRATEGY_TYPE_LABELS: Record<number, string> = {
  1: "Economic Optimal",
}

export const predictionStrategiesApi = {
  list: (customerId: string) =>
    apiFetch<PredictionStrategyResponse[]>(`/prediction-strategies?customer_id=${customerId}`),

  create: (data: PredictionStrategyCreate) =>
    apiFetch<PredictionStrategyResponse>("/prediction-strategies", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: PredictionStrategyUpdate) =>
    apiFetch<PredictionStrategyResponse>(`/prediction-strategies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/prediction-strategies/${id}`, { method: "DELETE" }),

  listParameters: (strategyId: string) =>
    apiFetch<PredictionEngineParameterResponse[]>(`/prediction-strategies/${strategyId}/parameters`),

  createParameter: (strategyId: string, data: PredictionEngineParameterCreate) =>
    apiFetch<PredictionEngineParameterResponse>(`/prediction-strategies/${strategyId}/parameters`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
}

export interface PadDateResponse {
  id: string
  pad_id: string
  date: string
  active: boolean
  created_at: string
}

export interface PadResponse {
  id: string
  customer_id: string
  name: string
  historic_days: number
  allow_negative: boolean
  boost: number
  boost_pct: number
  active: boolean
  dates: PadDateResponse[]
  created_at: string
  updated_at: string
}

export const padsApi = {
  list: (customerId: string) =>
    apiFetch<PadResponse[]>(`/pads?customer_id=${customerId}`),

  create: (data: { customer_id: string; name: string; allow_negative?: boolean; dates: string[] }) =>
    apiFetch<PadResponse>("/pads", { method: "POST", body: JSON.stringify(data) }),

  delete: (padId: string) =>
    apiFetch<void>(`/pads/${padId}`, { method: "DELETE" }),

  addDates: (padId: string, dates: string[]) =>
    apiFetch<PadResponse>(`/pads/${padId}/dates`, { method: "POST", body: JSON.stringify({ dates }) }),

  removeDate: (padId: string, date: string) =>
    apiFetch<void>(`/pads/${padId}/dates/${date}`, { method: "DELETE" }),
}

export interface PredefinedPadDateResponse {
  id: string
  predefined_pad_id: string
  date: string
  active: boolean
  created_at: string
}

export interface PredefinedPadResponse {
  id: string
  name: string
  description: string | null
  country: string | null
  allow_negative: boolean
  active: boolean
  dates: PredefinedPadDateResponse[]
  created_at: string
  updated_at: string
}

export const predefinedPadsApi = {
  list: (params?: { country?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.country) qs.set("country", params.country)
    qs.set("limit", String(params?.limit ?? 500))
    return apiFetch<PredefinedPadResponse[]>(`/predefined-pads?${qs}`)
  },
  delete: (id: string) => apiFetch<void>(`/predefined-pads/${id}`, { method: "DELETE" }),
}

export interface ConfigurationResponse {
  id: string
  peak_period: boolean
  minimum_delivery: number
  cost_per_unit: number | null
  profit_per_unit: number | null
  eo_to_delivery_rounding: number
  prediction_engine_id: string | null
  weekday_correction_mon: boolean
  weekday_correction_tue: boolean
  weekday_correction_wed: boolean
  weekday_correction_thu: boolean
  weekday_correction_fri: boolean
  weekday_correction_sat: boolean
  weekday_correction_sun: boolean
  weekday_only_mon: boolean
  weekday_only_tue: boolean
  weekday_only_wed: boolean
  weekday_only_thu: boolean
  weekday_only_fri: boolean
  weekday_only_sat: boolean
  weekday_only_sun: boolean
  weekday_profile_correction: boolean
  weekday_profile_correction_strength: number
  weekday_profile_correction_threshold: number
  weekday_profile_correction_method: number
  variation_adjustment: boolean
  variation_history_days: number
  open_monday: boolean
  open_tuesday: boolean
  open_wednesday: boolean
  open_thursday: boolean
  open_friday: boolean
  open_saturday: boolean
  open_sunday: boolean
  simultaneous_tasks: number
  periodic_check_workers: number
  auto_restart_workers: boolean
}

export interface CustomerConfigurationResponse {
  id: string
  customer_id: string
  peak_period: boolean | null
  minimum_delivery: number | null
  cost_per_unit: number | null
  profit_per_unit: number | null
  eo_to_delivery_rounding: number | null
  prediction_engine_id: string | null
  group_id: string | null
  production_group_id: string | null
  currency_id: string | null
  currency_symbol: string | null
  weekday_correction_mon: boolean | null
  weekday_correction_tue: boolean | null
  weekday_correction_wed: boolean | null
  weekday_correction_thu: boolean | null
  weekday_correction_fri: boolean | null
  weekday_correction_sat: boolean | null
  weekday_correction_sun: boolean | null
  weekday_only_mon: boolean | null
  weekday_only_tue: boolean | null
  weekday_only_wed: boolean | null
  weekday_only_thu: boolean | null
  weekday_only_fri: boolean | null
  weekday_only_sat: boolean | null
  weekday_only_sun: boolean | null
  weekday_profile_correction: boolean | null
  weekday_profile_correction_strength: number | null
  weekday_profile_correction_threshold: number | null
  weekday_profile_correction_method: number | null
  variation_adjustment: boolean | null
  variation_history_days: number | null
  open_monday: boolean | null
  open_tuesday: boolean | null
  open_wednesday: boolean | null
  open_thursday: boolean | null
  open_friday: boolean | null
  open_saturday: boolean | null
  open_sunday: boolean | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface OutletGroupResponse {
  id: string
  customer_id: string
  name: string
  description: string | null
  active: boolean
  outlet_count: number
  created_at: string
  updated_at: string
}

export interface OutletGroupCreate {
  customer_id: string
  name: string
  description?: string | null
}

export interface OutletGroupUpdate {
  name?: string | null
  description?: string | null
}

export interface SalesDateRangeResponse {
  min_date: string | null
  max_date: string | null
}

export interface SalesResponse {
  id: string
  customer_id: string
  outlet_id: string
  date: string
  sold: number
  delivered: number | null
  scan_sold: number | null
  net_sold: number | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface AggregatedSalesDataPoint {
  date: string
  delivered: number | null
  sold: number
  returned: number | null
}

export interface AggregatedSalesResponse {
  data: AggregatedSalesDataPoint[]
  outlet_count: number
}

export interface EfficiencyDataPoint {
  date: string
  return_pct: number | null
  sold_out_pct: number | null
  delivered: number | null
  sold: number
  returned: number | null
  outlet_count: number
  sold_out_count: number
}

export interface EfficiencyResponse {
  data: EfficiencyDataPoint[]
  outlet_count: number
}

export interface FinancialsPerDateDataPoint {
  date: string
  revenue: number
  cost: number
  profit: number
  avg_profit: number
  outlet_count: number
}

export interface FinancialsPerDateResponse {
  data: FinancialsPerDateDataPoint[]
  outlet_count: number
}

export interface FinancialsPerOutletDataPoint {
  outlet_id: string
  ext_id: string
  name: string
  revenue: number
  cost: number
  profit: number
  avg_profit: number
  days: number
}

export interface FinancialsPerOutletResponse {
  data: FinancialsPerOutletDataPoint[]
}

export const salesApi = {
  getDateRange: (customerId: string) =>
    apiFetch<SalesDateRangeResponse>(`/sales/date-range?customer_id=${customerId}`),

  query: (params: {
    outlet_id: string
    start_date: string
    end_date: string
    limit?: number
  }) => {
    const qs = new URLSearchParams({
      outlet_id: params.outlet_id,
      start_date: params.start_date,
      end_date: params.end_date,
    })
    qs.set("limit", String(params.limit ?? 1000))
    return apiFetch<SalesResponse[]>(`/sales?${qs}`)
  },

  aggregated: (params: {
    customer_id: string
    outlet_ids: string[]
    start_date: string
    end_date: string
  }) =>
    apiFetch<AggregatedSalesResponse>("/sales/aggregated", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  efficiency: (params: {
    customer_id: string
    outlet_ids: string[]
    start_date: string
    end_date: string
  }) =>
    apiFetch<EfficiencyResponse>("/sales/efficiency", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  financialsPerDate: (params: {
    customer_id: string
    outlet_ids: string[]
    start_date: string
    end_date: string
  }) =>
    apiFetch<FinancialsPerDateResponse>("/sales/financials/per-date", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  financialsPerOutlet: (params: {
    customer_id: string
    outlet_ids: string[]
    start_date: string
    end_date: string
  }) =>
    apiFetch<FinancialsPerOutletResponse>("/sales/financials/per-outlet", {
      method: "POST",
      body: JSON.stringify(params),
    }),
}

export interface ConfigurationUpdate {
  peak_period?: boolean | null
  minimum_delivery?: number | null
  cost_per_unit?: number | null
  profit_per_unit?: number | null
  eo_to_delivery_rounding?: number | null
  prediction_engine_id?: string | null
  weekday_correction_mon?: boolean | null
  weekday_correction_tue?: boolean | null
  weekday_correction_wed?: boolean | null
  weekday_correction_thu?: boolean | null
  weekday_correction_fri?: boolean | null
  weekday_correction_sat?: boolean | null
  weekday_correction_sun?: boolean | null
  weekday_only_mon?: boolean | null
  weekday_only_tue?: boolean | null
  weekday_only_wed?: boolean | null
  weekday_only_thu?: boolean | null
  weekday_only_fri?: boolean | null
  weekday_only_sat?: boolean | null
  weekday_only_sun?: boolean | null
  weekday_profile_correction?: boolean | null
  weekday_profile_correction_strength?: number | null
  weekday_profile_correction_threshold?: number | null
  weekday_profile_correction_method?: number | null
  variation_adjustment?: boolean | null
  variation_history_days?: number | null
  open_monday?: boolean | null
  open_tuesday?: boolean | null
  open_wednesday?: boolean | null
  open_thursday?: boolean | null
  open_friday?: boolean | null
  open_saturday?: boolean | null
  open_sunday?: boolean | null
  simultaneous_tasks?: number | null
  periodic_check_workers?: number | null
  auto_restart_workers?: boolean | null
}

export const configurationApi = {
  get: () => apiFetch<ConfigurationResponse>("/configuration"),
  update: (data: ConfigurationUpdate) =>
    apiFetch<ConfigurationResponse>("/configuration", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
}

export interface CurrencyResponse {
  id: string
  iso_4217: string
  symbol: string
  name: string
}

export const currenciesApi = {
  list: () => apiFetch<CurrencyResponse[]>("/currencies"),
}

export const customerConfigurationApi = {
  get: (customerId: string) =>
    apiFetch<CustomerConfigurationResponse>(`/customers/${customerId}/configuration`),
  create: (customerId: string, data: Record<string, unknown>) =>
    apiFetch<CustomerConfigurationResponse>(`/customers/${customerId}/configuration`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  patch: (customerId: string, data: Partial<CustomerConfigurationResponse>) =>
    apiFetch<CustomerConfigurationResponse>(`/customers/${customerId}/configuration`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
}

export const outletGroupsApi = {
  list: (customerId: string) =>
    apiFetch<OutletGroupResponse[]>(`/outlet-groups?customer_id=${customerId}`),

  get: (id: string) =>
    apiFetch<OutletGroupResponse>(`/outlet-groups/${id}`),

  create: (data: OutletGroupCreate) =>
    apiFetch<OutletGroupResponse>(`/outlet-groups`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: OutletGroupUpdate) =>
    apiFetch<OutletGroupResponse>(`/outlet-groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/outlet-groups/${id}`, { method: "DELETE" }),

  getOutlets: (groupId: string) =>
    apiFetch<OutletResponse[]>(`/outlet-groups/${groupId}/outlets`),

  addOutlet: (groupId: string, outletId: string) =>
    apiFetch<{ message: string }>(`/outlet-groups/${groupId}/outlets`, {
      method: "POST",
      body: JSON.stringify({ outlet_id: outletId }),
    }),

  addOutletsBulk: (groupId: string, outletIds: string[]) =>
    apiFetch<{ added: number; duplicates: number }>(`/outlet-groups/${groupId}/outlets/bulk`, {
      method: "POST",
      body: JSON.stringify({ outlet_ids: outletIds }),
    }),

  removeOutlet: (groupId: string, outletId: string) =>
    apiFetch<void>(`/outlet-groups/${groupId}/outlets/${outletId}`, { method: "DELETE" }),
}

// ─── Prediction Adjustments ──────────────────────────────────────────────────

export enum AdjustmentType {
  PER_OUTLET_BY_NUMBER = 1,
  PER_OUTLET_BY_PERCENTAGE = 2,
  OVERALL_BY_NUMBER = 3,
  OVERALL_BY_PERCENTAGE = 4,
}

export interface PredictionAdjustmentResponse {
  id: string
  group_id: string
  name: string
  start_date: string
  end_date: string
  type: AdjustmentType
  value: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface PredictionAdjustmentCreate {
  group_id: string
  name: string
  start_date: string
  end_date: string
  type: AdjustmentType
  value: number
}

export const predictionAdjustmentsApi = {
  list: (customerId: string) =>
    apiFetch<PredictionAdjustmentResponse[]>(`/prediction-adjustments?customer_id=${customerId}`),

  create: (data: PredictionAdjustmentCreate) =>
    apiFetch<PredictionAdjustmentResponse>("/prediction-adjustments", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/prediction-adjustments/${id}`, { method: "DELETE" }),
}

// ─── Financial Dates ─────────────────────────────────────────────────────────

export interface FinancialDateResponse {
  id: string
  customer_id: string
  name: string
  description: string | null
  date: string
  method: number
  copy_from_weekday: number | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface FinancialDateCreate {
  customer_id: string
  name: string
  description?: string | null
  date: string
  method: number  // 0=copy, 1=fixed
  copy_from_weekday?: number | null  // 1-7 (ISO weekday)
  cost_per_unit?: number | null
  profit_per_unit?: number | null
  outlet_group_id?: string | null
}

export const financialDatesApi = {
  list: (customerId: string) =>
    apiFetch<FinancialDateResponse[]>(`/financial-dates?customer_id=${customerId}`),

  create: (data: FinancialDateCreate) =>
    apiFetch<FinancialDateResponse>("/financial-dates", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/financial-dates/${id}`, { method: "DELETE" }),
}

export interface OutletInfoResponse {
  id: string
  key: string
  value: string | null
  active: boolean
}

export interface OutletResponse {
  id: string
  customer_id: string
  ext_id: string
  ext_id_2: number | null
  name: string
  description: string | null
  notes: string | null
  address: string | null
  zip: string | null
  city: string | null
  state: string | null
  country: string | null
  start_date: string | null
  end_date: string | null
  scan: boolean
  season: boolean
  sublets: boolean
  active: boolean
  created_at: string
  updated_at: string
  info: OutletInfoResponse[]
}

export interface OutletUpdate {
  ext_id?: string | null
  name?: string | null
  description?: string | null
  notes?: string | null
  address?: string | null
  zip?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
}

export interface OutletConstraintWeekday {
  weekday: number
  open: boolean
  cost_per_unit: number | null
  profit_per_unit: number | null
  fixed: number | null
  minimum: number | null
  maximum: number | null
  add: number | null
  add_pct: number | null
}

export interface OutletConstraintsResponse {
  outlet_id: string
  weekdays: OutletConstraintWeekday[]
}

export interface DeliveryAnalyticsWeekday {
  weekday: number  // 1=Monday, 7=Sunday
  dates: string[]  // last 8 dates, oldest first
  sold_history: (number | null)[]
  delivered_history: (number | null)[]
  returned_history: (number | null)[]
  raw_prediction: number | null
  lower_bound: number | null
  upper_bound: number | null
  predicted: number | null
  cv: number | null
  economic_optimal: number | null
  delivered: number | null
  pad_effect: number | null
  pad_effect_pct: number | null
  weekday_correction: number | null
  cost_per_unit: number | null
  profit_per_unit: number | null
  fixed: number | null
  minimum: number | null
  maximum: number | null
  add: number | null
  add_pct: number | null
}

export interface DeliveryAnalyticsResponse {
  outlet_id: string
  weekdays: DeliveryAnalyticsWeekday[]
}

export const outletsApi = {
  list: (customerId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams({ customer_id: customerId })
    qs.set("limit", String(params?.limit ?? 5000))
    if (params?.offset) qs.set("offset", String(params.offset))
    return apiFetch<OutletResponse[]>(`/outlets?${qs}`)
  },

  update: (id: string, data: OutletUpdate) =>
    apiFetch<OutletResponse>(`/outlets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/outlets/${id}`, { method: "DELETE" }),

  addInfo: (outletId: string, data: { key: string; value: string | null }) =>
    apiFetch<OutletInfoResponse>(`/outlets/${outletId}/info`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteInfo: (outletId: string, infoId: string) =>
    apiFetch<void>(`/outlets/${outletId}/info/${infoId}`, { method: "DELETE" }),

  getDeliveryAnalytics: (outletId: string) =>
    apiFetch<DeliveryAnalyticsResponse>(`/outlets/${outletId}/delivery-analytics`),

  getConstraints: (outletId: string) =>
    apiFetch<OutletConstraintsResponse>(`/outlets/${outletId}/constraints`),

  updateConstraints: (outletId: string, data: { weekdays: OutletConstraintWeekday[] }) =>
    apiFetch<OutletConstraintsResponse>(`/outlets/${outletId}/constraints`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
}

export interface SimulationStrategyResponse {
  id: string
  customer_id: string
  prediction_strategy_id: string | null
  type: number
  delay: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface SimulationStrategyCreate {
  customer_id: string
  prediction_strategy_id?: string | null
  type?: number
  delay?: number
}

export interface SimulationStrategyUpdate {
  prediction_strategy_id?: string | null
  type?: number | null
  delay?: number | null
}

export const SIMULATION_TYPE_LABELS: Record<number, string> = {
  1: "By Prediction Strategy",
  2: "Fixed Delivery",
  3: "Same Delivery",
  4: "Same Sale",
}

export interface CompletedSimulationResponse {
  id: string
  task_id: string | null
  simulation_id: string | null
  status: "success" | "failure" | "revoked"
  customer_id: string
  name: string | null
  description: string | null
  simulation_from: string | null
  simulation_to: string | null
  engine: string | null
  actual_engine: string | null
  engine_params: Record<string, unknown> | null
  delay: number | null
  outlet_count: number
  outlet_group_id: string | null
  outlet_group_name: string | null
  prediction_strategy_name: string | null
  error: string | null
  created_at: string
  started_at: string | null
  ended_at: string | null
  actual_total_delivered: number | null
  actual_total_sale: number | null
  actual_total_returned: number | null
  d_total_delivered: number | null
  d_total_sold: number | null
  d_total_returned: number | null
  d_diff_delivered: number | null
  d_diff_return: number | null
  d_lost_sale: number | null
  d_more_sale: number | null
  d_g1: number | null
  d_g2: number | null
  d_g3: number | null
  d_g4: number | null
  p_total_delivered: number | null
  p_total_sold: number | null
  p_total_returned: number | null
  p_diff_delivered: number | null
  p_diff_return: number | null
  p_lost_sale: number | null
  p_more_sale: number | null
  p_g1: number | null
  p_g2: number | null
  p_g3: number | null
  p_g4: number | null
  eo_total_delivered: number | null
  eo_total_sold: number | null
  eo_total_returned: number | null
  eo_diff_delivered: number | null
  eo_diff_return: number | null
  eo_lost_sale: number | null
  eo_more_sale: number | null
  eo_g1: number | null
  eo_g2: number | null
  eo_g3: number | null
  eo_g4: number | null
}

export interface CompletedSimulationListResponse {
  items: CompletedSimulationResponse[]
  total: number
}

export interface SimulationRunRequest {
  customer_id: string
  name?: string | null
  description?: string | null
  simulation_from: string
  simulation_to: string
  simulation_type?: number
  delay?: number
  prediction_strategy_id?: string | null
  outlet_ids?: string[] | null
  outlet_group_id?: string | null
  batch_size?: number
  worker?: string | null
}

export interface SimulationTaskResponse {
  task_id: string
  status: string
  progress: number
  message: string | null
  created_at: string
}

export interface ZeroShotResponse {
  zero_shot: number
  zero_shot_plus_1: number
  zero_shot_minus_1: number
  zero_shot_plus_2: number
  zero_shot_minus_2: number
  zero_shot_plus_mul: number
  zero_shot_minus_mul: number
  no_actual_data: number
  total: number
}

export interface AccuracyStatsResponse {
  mae: number
  bias: number
  rmse: number
  mape: number | null
  r_squared: number | null
  count: number
}

export interface FilteredOverviewResponse {
  total_delivered: number | null
  total_sold: number | null
  total_returned: number | null
  actual_total_delivered: number | null
  actual_total_sale: number | null
  actual_total_returned: number | null
  diff_delivered: number | null
  lost_sale: number | null
  diff_return: number | null
  more_sale: number | null
  g1: number | null
  g2: number | null
  g3: number | null
  g4: number | null
  sold_out_pct: number | null
  actual_sold_out_pct: number | null
  default_cost: number | null
  default_profit: number | null
}

export interface DataDumpRow {
  outlet_id: string
  outlet_name: string
  date: string
  scenario_delivery: number | null
  scenario_sold: number | null
  scenario_returned: number | null
  actual_delivered: number | null
  actual_sold: number | null
  actual_returned: number | null
  q10: number | null
  q20: number | null
  q30: number | null
  q40: number | null
  q50: number | null
  q60: number | null
  q70: number | null
  q80: number | null
  q90: number | null
  g1: number | null
  g2: number | null
  g3: number | null
  g4: number | null
  g4_extra_sales: number | null
  g4_profit_unit: number | null
  g4_unit_probs: [number, number][] | null
  cv: number | null
  eo: number | null
}

export interface DataDumpResponse {
  rows: DataDumpRow[]
  total_count: number
}

export const simulationsApi = {
  runAsync: (data: SimulationRunRequest) =>
    apiFetch<SimulationTaskResponse>("/simulations/async", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  list: (customerId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams({ customer_id: customerId })
    qs.set("limit", String(params?.limit ?? 500))
    if (params?.offset) qs.set("offset", String(params.offset))
    return apiFetch<CompletedSimulationListResponse>(`/simulations?${qs}`)
  },

  delete: (simulationId: string) =>
    apiFetch<void>(`/simulations/${simulationId}`, { method: "DELETE" }),

  deleteByRecordId: (recordId: string) =>
    apiFetch<void>(`/simulations/records/${recordId}`, { method: "DELETE" }),

  resume: (recordId: string) =>
    apiFetch<SimulationTaskResponse>(`/simulations/records/${recordId}/resume`, {
      method: "POST",
    }),

  getZeroShot: (simulationId: string, column = "delivered", weekdays?: number[]) => {
    const qs = new URLSearchParams({ column })
    weekdays?.forEach((d) => qs.append("weekdays", String(d)))
    return apiFetch<ZeroShotResponse>(`/simulations/${simulationId}/zero-shot?${qs}`)
  },

  getModelFit: (simulationId: string, params?: { outletIds?: string[]; fromDate?: string; toDate?: string; weekdays?: number[] }) => {
    const qs = new URLSearchParams()
    params?.outletIds?.forEach((id) => qs.append("outlet_ids", id))
    if (params?.fromDate) qs.set("from_date", params.fromDate)
    if (params?.toDate) qs.set("to_date", params.toDate)
    params?.weekdays?.forEach((d) => qs.append("weekdays", String(d)))
    const q = qs.toString()
    return apiFetch<ModelFitResponse>(`/simulations/${simulationId}/model-fit${q ? `?${q}` : ""}`)
  },

  getOverview: (simulationId: string, column = "delivered", weekdays?: number[], outletIds?: string[]) => {
    const qs = new URLSearchParams({ column })
    weekdays?.forEach((d) => qs.append("weekdays", String(d)))
    outletIds?.forEach((id) => qs.append("outlet_ids", id))
    return apiFetch<FilteredOverviewResponse>(`/simulations/${simulationId}/overview?${qs}`)
  },

  getAccuracyStats: (simulationId: string, column = "delivered", weekdays?: number[]) => {
    const qs = new URLSearchParams({ column })
    weekdays?.forEach((d) => qs.append("weekdays", String(d)))
    return apiFetch<AccuracyStatsResponse>(`/simulations/${simulationId}/accuracy-stats?${qs}`)
  },

  getDataDump: (simulationId: string, params?: {
    column?: string
    outletIds?: string[]
    weekdays?: number[]
    fromDate?: string
    toDate?: string
    limit?: number
    offset?: number
    sortBy?: string
    sortDir?: string
    search?: string
    group?: string
  }) => {
    const qs = new URLSearchParams()
    if (params?.column) qs.set("column", params.column)
    params?.outletIds?.forEach((id) => qs.append("outlet_ids", id))
    params?.weekdays?.forEach((d) => qs.append("weekdays", String(d)))
    if (params?.fromDate) qs.set("from_date", params.fromDate)
    if (params?.toDate) qs.set("to_date", params.toDate)
    if (params?.limit != null) qs.set("limit", String(params.limit))
    if (params?.offset != null) qs.set("offset", String(params.offset))
    if (params?.sortBy) qs.set("sort_by", params.sortBy)
    if (params?.sortDir) qs.set("sort_dir", params.sortDir)
    if (params?.search) qs.set("search", params.search)
    if (params?.group) qs.set("group", params.group)
    const q = qs.toString()
    return apiFetch<DataDumpResponse>(`/simulations/${simulationId}/data-dump${q ? `?${q}` : ""}`)
  },
}

export interface ModelFitOutlet {
  id: string
  name: string
}

export interface ModelFitDataPoint {
  date: string
  actual_sale: number | null
  delivered: number | null
  eo: number | null
  predicted: number | null
  lower_bound: number | null
  upper_bound: number | null
  sim_delivered: number | null
  sim_sold: number | null
  sim_returned: number | null
  sim_profit: number | null
  actual_delivered: number | null
  actual_sold: number | null
  actual_returned: number | null
  actual_profit: number | null
}

export interface ModelFitResponse {
  outlets: ModelFitOutlet[]
  data: ModelFitDataPoint[]
}

// ─── Import Templates ────────────────────────────────────────────────────────

export interface ImportTemplateElementResponse {
  id: string
  template_id: string
  name: string
  description: string | null
  element_index: number
  type: string
  allow: string | null
  disallow: string | null
  allow_empty: boolean
  allow_negative: boolean
  allow_positive: boolean
  allow_zero: boolean
  date_format: string
  decimal_separator: string
  maximum_value: number
  empty_is_zero: boolean
  negative_parenthesis: boolean
  sequence_separator: string
  weekday_start: number | null
  strip: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface ImportTemplateResponse {
  id: string
  customer_id: string
  name: string
  description: string | null
  move_file: boolean
  header_lines: number
  footer_lines: number
  separator: string
  reset_production_group: boolean
  add_to_production_group: boolean
  elements: ImportTemplateElementResponse[]
  active: boolean
  created_at: string
  updated_at: string
}

export interface ImportTemplateCreate {
  customer_id: string
  name: string
  description?: string | null
  move_file?: boolean
  header_lines?: number
  footer_lines?: number
  separator?: string
  reset_production_group?: boolean
  add_to_production_group?: boolean
}

export interface ImportTemplateUpdate {
  name?: string | null
  description?: string | null
  move_file?: boolean | null
  header_lines?: number | null
  footer_lines?: number | null
  separator?: string | null
  reset_production_group?: boolean | null
  add_to_production_group?: boolean | null
}

export interface ImportTemplateElementCreate {
  name: string
  description?: string | null
  element_index?: number
  type: string
}

export const importTemplatesApi = {
  list: (customerId: string) =>
    apiFetch<ImportTemplateResponse[]>(`/import-templates?customer_id=${customerId}`),

  get: (id: string) =>
    apiFetch<ImportTemplateResponse>(`/import-templates/${id}`),

  create: (data: ImportTemplateCreate) =>
    apiFetch<ImportTemplateResponse>("/import-templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: ImportTemplateUpdate) =>
    apiFetch<ImportTemplateResponse>(`/import-templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/import-templates/${id}`, { method: "DELETE" }),

  addElement: (templateId: string, data: ImportTemplateElementCreate) =>
    apiFetch<ImportTemplateElementResponse>(`/import-templates/${templateId}/elements`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeElement: (elementId: string) =>
    apiFetch<void>(`/import-templates/elements/${elementId}`, { method: "DELETE" }),

  reorderElements: (templateId: string, elementIds: string[]) =>
    apiFetch<void>(`/import-templates/${templateId}/elements/reorder`, {
      method: "PUT",
      body: JSON.stringify(elementIds),
    }),
}

export interface SalesFilterResponse {
  id: string
  customer_id: string
  name: string
  description: string | null
  from_date: string
  to_date: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface SalesFilterCreate {
  customer_id: string
  name: string
  description?: string | null
  from_date: string
  to_date: string
}

export interface SalesFilterUpdate {
  name?: string | null
  description?: string | null
  from_date?: string | null
  to_date?: string | null
}

export const salesFiltersApi = {
  list: (customerId: string) =>
    apiFetch<SalesFilterResponse[]>(`/sales-filters?customer_id=${customerId}`),

  create: (data: SalesFilterCreate) =>
    apiFetch<SalesFilterResponse>("/sales-filters", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: SalesFilterUpdate) =>
    apiFetch<SalesFilterResponse>(`/sales-filters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/sales-filters/${id}`, { method: "DELETE" }),
}

// ─── System Logs ─────────────────────────────────────────────────────────────

export interface LogEntry {
  timestamp: string
  message: string
}

export interface LogResponse {
  entries: LogEntry[]
  total_lines: number
  page: number
  page_size: number
  total_pages: number
}

export const logsApi = {
  get: (params: { source: string; page?: number; page_size?: number; search?: string }) => {
    const qs = new URLSearchParams({ source: params.source })
    qs.set("page", String(params.page ?? 1))
    qs.set("page_size", String(params.page_size ?? 100))
    if (params.search) qs.set("search", params.search)
    return apiFetch<LogResponse>(`/logs?${qs}`)
  },
}

export const simulationStrategiesApi = {
  list: (customerId: string) =>
    apiFetch<SimulationStrategyResponse[]>(`/simulation-strategies?customer_id=${customerId}`),

  create: (data: SimulationStrategyCreate) =>
    apiFetch<SimulationStrategyResponse>("/simulation-strategies", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: SimulationStrategyUpdate) =>
    apiFetch<SimulationStrategyResponse>(`/simulation-strategies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/simulation-strategies/${id}`, { method: "DELETE" }),
}
