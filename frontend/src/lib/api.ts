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

  const isFormData = typeof FormData !== "undefined" && options?.body instanceof FormData
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> | undefined) }
  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json"
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ─── Types (mirrored from FastAPI schemas) ────────────────────────────────────

export type TaskStatus = "pending" | "started" | "success" | "failure" | "revoked" | "continued" | "stopped"
export type TaskType = "prediction" | "simulation" | "kline_simulation" | "import" | "finetune" | "optimization" | "orchestration"

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
    apiFetch<WorkerInfo[]>("/tasks/workers/list"),

  stop: (taskId: string) =>
    apiFetch<{ status: string; task_id: string }>(`/tasks/${taskId}/stop`, { method: "POST" }),
}

export interface WorkerInfo {
  name: string
  models: string[]
  gpu_index: number | null
  gpu_name: string | null
  gpu_vram_total_mb: number | null
  gpu_count: number | null
  uptime_s: number | null
}

// ─── Worker management (system/workers) ──────────────────────────────────────

export type WorkerStatus = "running" | "stopped" | "potential"

export interface WorkerStats {
  jobs_total: number
  jobs_instance: number
  jobs_running: number
  jobs_success: number
  jobs_failure: number
  last_job_at: string | null
  avg_cpu_time_s: number | null
  avg_peak_memory_mb: number | null
}

export interface ManagedWorker {
  name: string
  status: WorkerStatus
  health: string | null
  models: string[]
  gpu_name: string | null
  gpu_vram_total_mb: number | null
  gpu_count: number | null
  gpu_index: number | null
  uptime_s: number | null
  container_name: string | null
  service: string | null
  profile: string | null
  is_remote: boolean
  controllable: boolean
  stats: WorkerStats
}

export interface WorkerActionResponse { name: string; status: string; message: string }
export interface WorkerPingResult { name: string; alive: boolean; source: string | null }

export const workersApi = {
  list: () => apiFetch<ManagedWorker[]>("/workers"),
  get: (name: string) => apiFetch<ManagedWorker>(`/workers/${encodeURIComponent(name)}`),
  ping: (name: string) => apiFetch<WorkerPingResult>(`/workers/${encodeURIComponent(name)}/ping`),
  start: (name: string) => apiFetch<WorkerActionResponse>(`/workers/${encodeURIComponent(name)}/start`, { method: "POST" }),
  stop: (name: string) => apiFetch<WorkerActionResponse>(`/workers/${encodeURIComponent(name)}/stop`, { method: "POST" }),
  restart: (name: string) => apiFetch<WorkerActionResponse>(`/workers/${encodeURIComponent(name)}/restart`, { method: "POST" }),
  remove: (name: string) => apiFetch<WorkerActionResponse>(`/workers/${encodeURIComponent(name)}`, { method: "DELETE" }),
}

// ─── Live kline ingester (system/workers card) ───────────────────────────────

export interface LiveIngestIntervalStat {
  interval: string
  bars: number
  last_bar_at: string | null
}

export interface LiveIngestStatus {
  container_status: "running" | "stopped" | "absent" | "error"
  container_name: string | null
  streaming: boolean
  mode: string | null
  started_at: string | null
  uptime_s: number | null
  heartbeat_at: string | null
  coins: number | null
  intervals: string[]
  streams: number | null
  connections_up: number | null
  connections_total: number | null
  bars_session: number | null
  last_bar_at: string | null
  per_interval: LiveIngestIntervalStat[]
  last_error: string | null
  last_error_at: string | null
  message: string | null
}

export interface LiveIngestActionResponse { status: string; message: string }

export const liveIngestApi = {
  status: () => apiFetch<LiveIngestStatus>("/live-ingest/status"),
  start: () => apiFetch<LiveIngestActionResponse>("/live-ingest/start", { method: "POST" }),
  stop: () => apiFetch<LiveIngestActionResponse>("/live-ingest/stop", { method: "POST" }),
  restart: () => apiFetch<LiveIngestActionResponse>("/live-ingest/restart", { method: "POST" }),
  setMode: (mode: "ws" | "poll") =>
    apiFetch<LiveIngestActionResponse>(`/live-ingest/mode?mode=${mode}`, { method: "POST" }),
}

export interface CustomerUpdate {
  name?: string | null
  description?: string | null
  notes?: string | null
}

export const usersApi = {
  customers: (userId: string) =>
    apiFetch<CustomerResponse[]>(`/users/${userId}/customers`),
}

export const customersApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    qs.set("limit", String(params?.limit ?? 100))
    return apiFetch<CustomerResponse[]>(`/customers?${qs}`)
  },

  get: (id: string) => apiFetch<CustomerResponse>(`/customers/${id}`),

  create: (data: { name: string; description?: string | null; notes?: string | null }) =>
    apiFetch<CustomerResponse>(`/customers`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: CustomerUpdate) =>
    apiFetch<CustomerResponse>(`/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  opened: (id: string) =>
    apiFetch<CustomerResponse>(`/customers/${id}/opened`, { method: "POST" }),

  delete: (id: string) =>
    apiFetch<void>(`/customers/${id}`, { method: "DELETE" }),
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

export interface PredictionDataDumpRow {
  outlet_id: string
  outlet_name: string
  date: string
  delivered: number | null
  sold: number | null
  returned: number | null
  q10: number | null
  q20: number | null
  q30: number | null
  q40: number | null
  q50: number | null
  q60: number | null
  q70: number | null
  q80: number | null
  q90: number | null
  eo: number | null
  cv: number | null
  profit: number | null
}

export interface PredictionDataDumpResponse {
  rows: PredictionDataDumpRow[]
  total_count: number
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

  getDataDump: (predictionId: string, params?: {
    outletIds?: string[]
    limit?: number
    offset?: number
    sortBy?: string
    sortDir?: string
    search?: string
  }) => {
    const qs = new URLSearchParams()
    params?.outletIds?.forEach((id) => qs.append("outlet_ids", id))
    if (params?.limit) qs.set("limit", String(params.limit))
    if (params?.offset != null) qs.set("offset", String(params.offset))
    if (params?.sortBy) qs.set("sort_by", params.sortBy)
    if (params?.sortDir) qs.set("sort_dir", params.sortDir)
    if (params?.search) qs.set("search", params.search)
    const q = qs.toString()
    return apiFetch<PredictionDataDumpResponse>(`/predictions/${predictionId}/data-dump${q ? `?${q}` : ""}`)
  },
}

export interface PredictionEngineResponse {
  id: string
  slug: string
  name: string
  description: string | null
  notes: string | null
  finetuned_model_path: string | null
  finetune_sync_every: number | null
  finetune_sync_target: string | null
  finetune_sane_epochs: number | null
  finetune_max_mae: number | null
  finetune_allow_new_checkpoint: boolean
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
  finetuned_model_path?: string | null
  finetune_sync_every?: number | null
  finetune_sync_target?: string | null
  finetune_sane_epochs?: number | null
  finetune_max_mae?: number | null
  finetune_allow_new_checkpoint?: boolean
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

  availability: () => apiFetch<Record<string, boolean>>("/predictions/engines/availability"),

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

  listFinetuneModels: (engineId: string) =>
    apiFetch<string[]>(`/prediction-engines/${engineId}/finetune/models`),

  resetFinetune: (engineId: string) =>
    apiFetch<void>(`/prediction-engines/${engineId}/finetune/reset`, { method: "DELETE" }),
}

// ─── Finetuning ──────────────────────────────────────────────────────────────

export interface FinetuneRequest {
  prediction_engine_id: string
  coin_id: string
  quote_asset: string
  interval: string
  name?: string
  description?: string
  start_date?: string
  end_date?: string
  context_length?: number
  horizon?: number
  epochs?: number
  learning_rate?: number
  batch_size?: number
  early_stopping_patience?: number
  early_stopping_method?: string
  validation_split?: number
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
  customer_count: number
  outlet_count: number
}

export const finetuneApi = {
  start: (data: FinetuneRequest) =>
    apiFetch<FinetuneTaskResponse>("/prediction-engines/finetune", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  resume: (recordId: string, worker?: string) => {
    const qs = worker !== undefined ? `?worker=${encodeURIComponent(worker)}` : ""
    return apiFetch<FinetuneTaskResponse>(`/prediction-engines/finetune/resume/${recordId}${qs}`, {
      method: "POST",
    })
  },

  count: (engineId: string) =>
    apiFetch<FinetuneCountResponse>(`/prediction-engines/${engineId}/finetune/count`),
}

// ─── Fine-tune Tracking ──────────────────────────────────────────────────────

export interface FineTuneResponse {
  id: string
  customer_id: string | null
  name: string
  description: string | null
  started_at: string | null
  ended_at: string | null
  end_condition: string | null
  outlet_group_id: string | null
  outlet_group_name: string | null
  coin_id: string | null
  coin_symbol: string | null
  quote_asset: string | null
  interval: string | null
  finetune_from: string | null
  finetune_to: string | null
  finetuned_outlets: number
  pathological_outlets: number
  worker_name: string | null
  prediction_engine_id: string | null
  engine_name: string | null
  task_id: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface FineTuneListResponse {
  items: FineTuneResponse[]
  total: number
}

export const fineTunesApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    qs.set("limit", String(params?.limit ?? 500))
    if (params?.offset) qs.set("offset", String(params.offset))
    return apiFetch<FineTuneListResponse>(`/fine-tunes?${qs}`)
  },

  delete: (id: string) =>
    apiFetch<void>(`/fine-tunes/${id}`, { method: "DELETE" }),
}

export interface PredictionStrategyResponse {
  id: string
  customer_id: string
  name: string
  description: string | null
  type: number
  prediction_engine_id: string | null
  finetuned_model: string | null
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
  finetuned_model?: string | null
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
  price_per_unit: number | null
  cost_per_unit: number | null
  profit_per_unit: number | null
  eo_to_delivery_rounding: number
  prediction_engine_id: string | null
  insight_model_id: string | null
  insight_submodel_id: string | null
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
  covariate_handling: string
  variation_adjustment: boolean
  variation_history_days: number
  pad_baseline_window_days: number
  pad_history_days: number
  eo_methodology: number
  eo_extrapolation: number
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
  price_per_unit: number | null
  cost_per_unit: number | null
  profit_per_unit: number | null
  eo_to_delivery_rounding: number | null
  prediction_engine_id: string | null
  insight_model_id: string | null
  insight_submodel_id: string | null
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
  covariate_handling: string | null
  variation_adjustment: boolean | null
  variation_history_days: number | null
  pad_baseline_window_days: number | null
  pad_history_days: number | null
  eo_methodology: number | null
  eo_extrapolation: number | null
  fallback_engine: boolean | null
  insights_system_prompt: string | null
  insights_prediction_engine_id: string | null
  insights_prediction_strategy_id: string | null
  insights_worker: string | null
  open_monday: boolean | null
  open_tuesday: boolean | null
  open_wednesday: boolean | null
  open_thursday: boolean | null
  open_friday: boolean | null
  open_saturday: boolean | null
  open_sunday: boolean | null
  home_directory: string | null
  upload_directory: string | null
  upload_directory_storage: string | null
  forecast_directory: string | null
  forecast_directory_storage: string | null
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

// ─── Analysis Types ──────────────────────────────────────────────────────────

export interface AnalysisRequest {
  customer_id: string
  outlet_ids: string[]
  start_date: string
  end_date: string
}

export interface MissingDataGap {
  outlet_id: string
  outlet_name: string
  ext_id: string
  missing_dates: string[]
  gap_count: number
  expected_count: number
}

export interface ZeroSalesAnomaly {
  outlet_id: string
  outlet_name: string
  ext_id: string
  dates: string[]
  count: number
  total_sales_days: number
}

export interface FieldDiscrepancy {
  outlet_id: string
  outlet_name: string
  ext_id: string
  field: string
  avg_difference: number
  occurrence_count: number
  total_records: number
}

export interface LevelShift {
  outlet_id: string
  outlet_name: string
  ext_id: string
  weekday: number
  shift_date: string
  before_mean: number
  after_mean: number
  magnitude: number
  magnitude_pct: number
}

export interface DataQualitySummary {
  total_missing_dates: number
  total_zero_sales: number
  total_discrepancies: number
  total_level_shifts: number
  outlets_with_issues: number
  total_expected_dates: number
  total_sales_records: number
  total_outlets_with_scan_or_net: number
  total_outlets_analyzed: number
  total_outlets: number
}

export interface DataQualityResponse {
  missing_data: MissingDataGap[]
  zero_sales: ZeroSalesAnomaly[]
  discrepancies: FieldDiscrepancy[]
  level_shifts: LevelShift[]
  summary: DataQualitySummary
}

export interface DateOutlier {
  date: string
  value: number
  expected: number
  z_score: number
  direction: string
  is_pad_date: boolean
  pad_name: string | null
}

export interface RecurringDateOutlier {
  month: number
  day: number
  years: number[]
  avg_z_score: number
  direction: string
  is_registered_pad: boolean
  pad_name: string | null
}

export interface OutlierResponse {
  recurring_sales: RecurringDateOutlier[]
  non_recurring_sales: DateOutlier[]
  recurring_delivery: RecurringDateOutlier[]
  non_recurring_delivery: DateOutlier[]
}

export interface WeeklyDataPoint {
  date: string
  value: number
  trend_value: number
}

export interface TrendInfo {
  slope: number
  slope_per_week: number
  direction: string
  r_squared: number
  weekly_data: WeeklyDataPoint[]
}

export interface Changepoint {
  date: string
  before_mean: number
  after_mean: number
  magnitude_pct: number
}

export interface YearlyProfilePoint {
  week: number
  month: number
  value: number
}

export interface SeasonalityInfo {
  has_weekly: boolean
  has_yearly: boolean
  weekly_strength: number
  yearly_strength: number | null
  weekly_profile: { weekday: number; avg_value: number }[]
  yearly_profile: YearlyProfilePoint[]
}

export interface WeekdayEffectOutlet {
  outlet_id: string
  outlet_name: string
  ext_id: string
  effect_strength: number
  weekday_means: number[]
}

export interface DivergentOutlet {
  outlet_id: string
  outlet_name: string
  ext_id: string
  outlet_slope: number
  aggregate_slope: number
  divergence: number
}

export interface PatternsResponse {
  trend: TrendInfo
  changepoints: Changepoint[]
  seasonality: SeasonalityInfo
  weekday_effects: WeekdayEffectOutlet[]
  divergent_outlets: DivergentOutlet[]
}

export interface HighReturnOutlet {
  outlet_id: string
  outlet_name: string
  ext_id: string
  avg_return_pct: number
  days_with_data: number
}

export interface SoldOutOutlet {
  outlet_id: string
  outlet_name: string
  ext_id: string
  sold_out_pct: number
  sold_out_days: number
  total_days: number
}

export interface WeekdayEfficiency {
  outlet_id: string
  outlet_name: string
  ext_id: string
  weekday: number
  avg_return_pct: number | null
  sold_out_pct: number
  day_count: number
}

export interface FixedAccount {
  outlet_id: string
  outlet_name: string
  ext_id: string
  cv: number
  sold_eq_delivered_pct: number
  avg_sold: number
}

export interface DeliveryPerformanceResponse {
  high_return: HighReturnOutlet[]
  sold_out: SoldOutOutlet[]
  weekday_efficiency: WeekdayEfficiency[]
  fixed_accounts: FixedAccount[]
}

export interface OutletCluster {
  cluster_id: number
  outlet_ids: string[]
  outlet_names: string[]
  cluster_profile: number[]
}

export interface PredictabilityScore {
  outlet_id: string
  outlet_name: string
  ext_id: string
  cv: number
  difficulty: string
}

export interface CorrelationCluster {
  cluster_id: number
  outlet_ids: string[]
  outlet_names: string[]
  avg_correlation: number
}

export interface SegmentationResponse {
  seasonal_clusters: OutletCluster[]
  predictability: PredictabilityScore[]
  correlation_clusters: CorrelationCluster[]
}

// ─── Cohort Audit ─────────────────────────────────────────────────────────

export interface CohortAuditRequest {
  customer_id: string
  outlet_info_key: string
  start_date: string
  end_date: string
  outlet_info_values?: string[] | null
  sequenced?: boolean
  shared_driver?: boolean
  skip_threshold_pct?: number
  min_baseline?: number
  delivery_floor?: number
}

export interface CohortOutletStat {
  outlet_id: string
  outlet_name: string
  ext_id: string
  skip_count: number
  above_floor_skip_count: number
  skip_rate: number
  active_open_days: number
  rank: number
  inferred_sequence_rank: number | null
  no_report_count: number
}

export interface CohortSkipEvent {
  date: string
  weekday: number
  skipped_outlet_ids: string[]
  skipped_count: number
}

export interface CohortResult {
  cohort_value: string
  outlet_count: number
  skip_event_count: number
  total_skip_observations: number
  overall_skip_rate: number
  tcs: number | null
  tcs_p_value: number | null
  no_report_count: number
  weekday_distribution: number[]
  top_weekday: number | null
  outlets: CohortOutletStat[]
  skip_events: CohortSkipEvent[]
  inferred_tail_outlets: string[] | null
  sequence_confidence: "high" | "medium" | "low" | null
}

export interface CohortAuditResponse {
  cohorts: CohortResult[]
  universe_size: number
  cohorts_with_signal: number
  skip_detection_window: { start_date: string; end_date: string }
  notes: string[]
}

export interface OutletInfoKeyEntry {
  key: string
  outlet_count: number
}

export interface OutletInfoKeysResponse {
  keys: OutletInfoKeyEntry[]
}

export interface OutletInfoValueEntry {
  value: string
  outlet_count: number
}

export interface OutletInfoValuesResponse {
  key: string
  values: OutletInfoValueEntry[]
}

export interface CohortInvestigateParams {
  customer_id: string
  cohort_key: string
  cohort: CohortResult
  sequenced?: boolean
  shared_driver?: boolean
  start_date: string
  end_date: string
}

export const cohortAuditApi = {
  audit: (params: CohortAuditRequest) =>
    apiFetch<CohortAuditResponse>("/analysis/cohort-audit", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  keys: (customerId: string) =>
    apiFetch<OutletInfoKeysResponse>(
      `/analysis/outlet-info/keys?customer_id=${encodeURIComponent(customerId)}`,
    ),
  values: (customerId: string, key: string) =>
    apiFetch<OutletInfoValuesResponse>(
      `/analysis/outlet-info/values?customer_id=${encodeURIComponent(customerId)}&key=${encodeURIComponent(key)}`,
    ),
  investigate: async (
    params: CohortInvestigateParams,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ) => {
    const base = typeof window === "undefined"
      ? (process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000")
      : ""
    const prefix = base ? "" : "/backend"
    const url = `${base}${prefix}/api/v1/analysis/cohort-investigate`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API ${res.status}: ${text}`)
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (chunk) onChunk(chunk)
    }
  },
}

export const analysisApi = {
  dataQuality: (params: AnalysisRequest) =>
    apiFetch<DataQualityResponse>("/analysis/data-quality", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  outliers: (params: AnalysisRequest) =>
    apiFetch<OutlierResponse>("/analysis/outliers", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  patterns: (params: AnalysisRequest) =>
    apiFetch<PatternsResponse>("/analysis/patterns", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  deliveryPerformance: (params: AnalysisRequest) =>
    apiFetch<DeliveryPerformanceResponse>("/analysis/delivery-performance", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  segmentation: (params: AnalysisRequest) =>
    apiFetch<SegmentationResponse>("/analysis/segmentation", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  investigateOutlier: async (
    params: {
      customer_id: string
      outlet_ids: string[]
      month: number
      day: number
      years: number[]
      direction: string
    },
    onChunk: (text: string) => void,
  ) => {
    const base = typeof window === "undefined"
      ? (process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000")
      : ""
    const prefix = base ? "" : "/backend"
    const url = `${base}${prefix}/api/v1/analysis/investigate`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API ${res.status}: ${text}`)
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk(decoder.decode(value, { stream: true }))
    }
  },
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

export interface TokenLlmResponse {
  llm_id: string
  llm_name: string
  model_name: string | null
  used: number
  input_used: number
  output_used: number
  available: number
}

export interface TokenModelResponse {
  prediction_engine_id: string
  engine_name: string
  used: number
  available: number
}

export interface TokenResponse {
  id: string
  customer_id: string
  used: number
  available: number
  llms: TokenLlmResponse[]
  models: TokenModelResponse[]
}

export const tokenApi = {
  get: (customerId: string) =>
    apiFetch<TokenResponse | null>(
      `/tokens?customer_id=${customerId}`,
    ),
}

// ─── Health Check ────────────────────────────────────────────────────────────

export interface HealthCheckDateRange {
  earliest: string | null
  latest: string | null
}

export interface CoverageMetrics {
  total_outlets: number
  outlets_with_sales: number
  outlets_with_enough_history: number
  coverage_ratio: number
  min_history_threshold_days: number
  date_range: HealthCheckDateRange
  median_history_days: number | null
  date_alignment_std_days: number | null
  pct_records_with_delivered: number
  pct_records_with_scan_sold: number
  pct_records_with_net_sold: number
  total_sales_records: number
  days_since_last_sale: number | null
}

export interface DeadOutlet {
  outlet_id: string
  ext_id: string
  name: string
  last_sale_date: string
  days_since_last_sale: number
}

export interface DuplicateGroup {
  outlet_ids: string[]
  names: string[]
  addresses: (string | null)[]
}

export interface VolumeOutlet {
  outlet_id: string
  ext_id: string
  name: string
  total_sold: number
  pct_of_total: number
}

export interface StructuralFlags {
  dead_outlets: DeadOutlet[]
  dead_outlet_count: number
  duplicate_groups: DuplicateGroup[]
  duplicate_group_count: number
  volume_top10_pct: number
  volume_top10_outlets: VolumeOutlet[]
  delivery_config_coverage: number
  outlets_with_delivery_config: number
  outlets_without_delivery_config: number
}

export interface EngineReadiness {
  engine: string
  min_history: number
  qualifying_outlets: number
  total_outlets: number
  pct_qualifying: number
}

export interface ViabilityMetrics {
  engine_readiness: EngineReadiness[]
  aggregate_cv: number | null
  overall_status: string
}

export interface HealthCheckResponse {
  customer_id: string
  customer_name: string
  coverage: CoverageMetrics
  structural: StructuralFlags
  viability: ViabilityMetrics
}

export const healthCheckApi = {
  get: (customerId: string, outletIds?: string[]) =>
    apiFetch<HealthCheckResponse>(`/health-check/${customerId}`, {
      method: "POST",
      body: JSON.stringify({ outlet_ids: outletIds }),
    }),
}

export interface ConfigurationUpdate {
  peak_period?: boolean | null
  minimum_delivery?: number | null
  price_per_unit?: number | null
  cost_per_unit?: number | null
  profit_per_unit?: number | null
  eo_to_delivery_rounding?: number | null
  prediction_engine_id?: string | null
  insight_model_id?: string | null
  insight_submodel_id?: string | null
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
  covariate_handling?: string | null
  variation_adjustment?: boolean | null
  variation_history_days?: number | null
  pad_baseline_window_days?: number | null
  pad_history_days?: number | null
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

export interface CoinResponse {
  id: string
  symbol: string
  name: string
  description: string | null
  type: string | null
  categories: string[]
  // Binance market availability (null = not yet checked). Spot-taker fees need a
  // spot market; futures maker/taker fees need a USDⓈ-M perpetual.
  has_spot: boolean | null
  has_futures: boolean | null
  active: boolean
  created_at: string
  updated_at: string
}

export type CoinCreate = { symbol: string; name: string; description?: string | null; type?: string | null }
export type CoinUpdate = { symbol?: string; name?: string; description?: string | null; type?: string | null }

export const coinsApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    qs.set("limit", String(params?.limit ?? 100))
    qs.set("offset", String(params?.offset ?? 0))
    return apiFetch<CoinResponse[]>(`/coins?${qs}`)
  },
  get: (id: string) => apiFetch<CoinResponse>(`/coins/${id}`),
  create: (data: CoinCreate) =>
    apiFetch<CoinResponse>(`/coins`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: CoinUpdate) =>
    apiFetch<CoinResponse>(`/coins/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<boolean>(`/coins/${id}`, { method: "DELETE" }),
  // Fetch CoinGecko categories for the given coins (or all if omitted) in the
  // background; returns a task_id to poll.
  refreshCategories: (coinIds?: string[]) => {
    const qs = new URLSearchParams()
    coinIds?.forEach((id) => qs.append("coin_ids", id))
    const suffix = qs.toString() ? `?${qs}` : ""
    return apiFetch<{ task_id: string | null; count: number; name?: string }>(
      `/coins/refresh-categories${suffix}`,
      { method: "POST" },
    )
  },
  // Refresh Binance spot / futures availability flags for the given coins (or all
  // if omitted). Runs inline server-side (two HTTP calls total); returns counts.
  refreshMarkets: (coinIds?: string[]) => {
    const qs = new URLSearchParams()
    coinIds?.forEach((id) => qs.append("coin_ids", id))
    const suffix = qs.toString() ? `?${qs}` : ""
    return apiFetch<{
      count: number
      spot: number
      futures: number
      spot_source: boolean
      futures_source: boolean
    }>(`/coins/refresh-markets${suffix}`, { method: "POST" })
  },
}

// ─── Coin Groups ──────────────────────────────────────────────────────────────
// Named collections of coins (global). The reserved group with slug "favorites"
// backs the heart UI on the coins page.

export interface CoinGroup {
  id: string
  name: string
  description: string | null
  notes: string | null
  slug: string | null
  active: boolean
  member_coin_ids: string[]
  created_at: string
  updated_at: string
}

export interface CoinGroupCreate {
  name: string
  description?: string | null
  notes?: string | null
}

export interface CoinGroupUpdate {
  name?: string | null
  description?: string | null
  notes?: string | null
}

export const coinGroupsApi = {
  list: () => apiFetch<CoinGroup[]>(`/coin-groups`),
  favorites: () => apiFetch<CoinGroup>(`/coin-groups/favorites`),
  create: (data: CoinGroupCreate) =>
    apiFetch<CoinGroup>(`/coin-groups`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: CoinGroupUpdate) =>
    apiFetch<CoinGroup>(`/coin-groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiFetch<{ success: boolean }>(`/coin-groups/${id}`, { method: "DELETE" }),
  // coin_ids go in the body, not the query string: a group can hold hundreds of
  // coins and the resulting URL would exceed Node's max-HTTP-header limit at the
  // Next.js proxy hop (the request line counts toward it) even though FastAPI
  // itself accepts it.
  addMembers: (groupId: string, coinIds: string[]) =>
    apiFetch<CoinGroup>(`/coin-groups/${groupId}/members`, { method: "POST", body: JSON.stringify({ coin_ids: coinIds }) }),
  removeMembers: (groupId: string, coinIds: string[]) =>
    apiFetch<CoinGroup>(`/coin-groups/${groupId}/members`, { method: "DELETE", body: JSON.stringify({ coin_ids: coinIds }) }),
  addFavorites: (coinIds: string[]) =>
    apiFetch<CoinGroup>(`/coin-groups/favorites/members`, { method: "POST", body: JSON.stringify({ coin_ids: coinIds }) }),
  removeFavorites: (coinIds: string[]) =>
    apiFetch<CoinGroup>(`/coin-groups/favorites/members`, { method: "DELETE", body: JSON.stringify({ coin_ids: coinIds }) }),
}

// ─── Model Orchestrations ─────────────────────────────────────────────────────
// Groups are global (no customer scoping). A group screens a pool of candidate
// engines over a calibration universe (quote asset / interval / coins) and keeps
// the top-N as a weighted ensemble.

export interface OrchestrationGroupResponse {
  id: string
  name: string
  description: string | null
  notes: string | null
  model_composition: Record<string, number>
  top_n: number
  calibration_metric: string
  prediction_target: string | null
  quote_asset: string
  interval: string
  coin_ids: string[]
  status: string
  last_calibrated_at: string | null
  last_calibration_score: number | null
  created_at: string
  updated_at: string
  active: boolean
}

export interface EngineCompositionItem {
  engine_slug: string
  engine_name: string
  weight: number
  rank: number
}

export type OrchestrationMetric = "mase" | "smase" | "mae" | "mape" | "rmse" | "crps"

// Config snapshot the current weights were computed under (staleness basis).
export interface CalibratedBasis {
  slugs?: string[]
  prediction_target?: string | null
  metric?: string
  top_n?: number
}

export interface OrchestrationGroupDetailResponse extends OrchestrationGroupResponse {
  engines: EngineCompositionItem[]
  engine_slugs: string[]
  calibrated_slugs: string[]
  calibrated_basis: CalibratedBasis
  engine_workers: Record<string, string>
  engine_params: Record<string, Record<string, string>>
  task_id?: string | null
}

export interface CreateOrchestrationGroupRequest {
  name: string
  description?: string
  notes?: string
  engine_slugs: string[]
  metric: OrchestrationMetric
  top_n: number
  prediction_target?: string | null
  quote_asset: string
  interval: string
  coin_ids: string[]
  engine_params?: Record<string, Record<string, string>> | null
}

export interface UpdateOrchestrationGroupRequest {
  name?: string
  description?: string
  notes?: string
  metric?: OrchestrationMetric
  top_n?: number
  prediction_target?: string | null
  engine_slugs?: string[]
  engine_params?: Record<string, Record<string, string>>
  quote_asset?: string
  interval?: string
  coin_ids?: string[]
}

export interface CalibrateGroupRequest {
  engine_workers?: Record<string, string> | null
}

export interface CalibrateGroupResponse {
  id: string
  task_id: string
  status: string
}

export const orchestrationsApi = {
  list: () => apiFetch<OrchestrationGroupResponse[]>(`/orchestrations`),

  create: (data: CreateOrchestrationGroupRequest) =>
    apiFetch<OrchestrationGroupDetailResponse>(`/orchestrations`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  get: (groupId: string) =>
    apiFetch<OrchestrationGroupDetailResponse>(`/orchestrations/${groupId}`),

  update: (groupId: string, data: UpdateOrchestrationGroupRequest) =>
    apiFetch<OrchestrationGroupResponse>(`/orchestrations/${groupId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Selection: re-screen the full candidate pool and pick the top-N.
  select: (groupId: string, data: CalibrateGroupRequest) =>
    apiFetch<CalibrateGroupResponse>(`/orchestrations/${groupId}/select`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Reweight: keep the selected models fixed, refresh only their weights.
  reweight: (groupId: string, data: CalibrateGroupRequest) =>
    apiFetch<CalibrateGroupResponse>(`/orchestrations/${groupId}/reweight`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  delete: (groupId: string) =>
    apiFetch<void>(`/orchestrations/${groupId}`, { method: "DELETE" }),
}

export interface LlmResponse {
  id: string
  name: string
  description: string | null
}

export interface LlmSubmodelResponse {
  id: string
  name: string
  description: string | null
  llm_id: string | null
}

export const llmsApi = {
  list: () => apiFetch<LlmResponse[]>("/llms"),
  listSubmodels: () => apiFetch<LlmSubmodelResponse[]>("/llms/submodels"),
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
  price_per_unit: number | null
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

  get: (id: string) => apiFetch<OutletResponse>(`/outlets/${id}`),

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
  status: "success" | "failure" | "revoked" | "continued"
  customer_id: string
  name: string | null
  description: string | null
  simulation_from: string | null
  simulation_to: string | null
  engine: string | null
  actual_engine: string | null
  engine_params: Record<string, unknown> | null
  simulation_params: Record<string, unknown> | null
  delay: number | null
  outlet_count: number
  outlet_group_id: string | null
  outlet_group_name: string | null
  prediction_strategy_name: string | null
  error: string | null
  warnings: string[] | null
  days_completed: number | null
  days_total: number | null
  worker_name: string | null
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

export interface SimulationParametersOverride {
  variation_adjustment?: boolean
  eo_methodology?: number
  eo_extrapolation?: number
  weekday_profile_correction?: boolean
  covariate_handling?: "none" | "native" | "external"
  covariate_weekday?: boolean
  covariate_price?: boolean
  covariate_pad?: boolean
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
  parameters?: SimulationParametersOverride | null
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

  wrapUp: (recordId: string) =>
    apiFetch<{ ok: boolean; simulation_id: string }>(`/simulations/records/${recordId}/wrap-up`, {
      method: "POST",
    }),

  resume: (recordId: string, worker?: string) => {
    const qs = worker !== undefined ? `?worker=${encodeURIComponent(worker)}` : ""
    return apiFetch<SimulationTaskResponse>(`/simulations/records/${recordId}/resume${qs}`, {
      method: "POST",
    })
  },

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

  getOverview: (simulationId: string, column = "delivered", weekdays?: number[], outletIds?: string[], fromDate?: string, toDate?: string) => {
    const qs = new URLSearchParams({ column })
    weekdays?.forEach((d) => qs.append("weekdays", String(d)))
    outletIds?.forEach((id) => qs.append("outlet_ids", id))
    if (fromDate) qs.set("from_date", fromDate)
    if (toDate) qs.set("to_date", toDate)
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
  value_type: string
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
  value_type?: string
  allow?: string | null
  disallow?: string | null
  allow_empty?: boolean
  allow_negative?: boolean
  allow_positive?: boolean
  allow_zero?: boolean
  date_format?: string
  decimal_separator?: string
  maximum_value?: number
  empty_is_zero?: boolean
  negative_parenthesis?: boolean
  sequence_separator?: string
  weekday_start?: number | null
  strip?: string | null
}

export interface ImportTemplateElementUpdate {
  name?: string | null
  description?: string | null
  element_index?: number | null
  value_type?: string | null
  allow?: string | null
  disallow?: string | null
  allow_empty?: boolean | null
  allow_negative?: boolean | null
  allow_positive?: boolean | null
  allow_zero?: boolean | null
  date_format?: string | null
  decimal_separator?: string | null
  maximum_value?: number | null
  empty_is_zero?: boolean | null
  negative_parenthesis?: boolean | null
  sequence_separator?: string | null
  weekday_start?: number | null
  strip?: string | null
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

  clone: (id: string, name: string) =>
    apiFetch<ImportTemplateResponse>(`/import-templates/${id}/clone`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  addElement: (templateId: string, data: ImportTemplateElementCreate) =>
    apiFetch<ImportTemplateElementResponse>(`/import-templates/${templateId}/elements`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateElement: (elementId: string, data: ImportTemplateElementUpdate) =>
    apiFetch<ImportTemplateElementResponse>(`/import-templates/elements/${elementId}`, {
      method: "PATCH",
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

// ─── Imports (file listing + upload) ─────────────────────────────────────────

export interface ImportFileInfo {
  name: string
  size_bytes: number
  modified_at: string
  imported: boolean
}

export interface ImportFileListResponse {
  directory: string | null
  files: ImportFileInfo[]
  error: string | null
}

export interface VerificationIssue {
  line_number: number
  severity: string
  message_group: string
  message: string
}

export interface VerificationGroup {
  name: string
  severity: string
  count: number
}

export interface VerificationResponse {
  filename: string
  total_lines: number
  error_count: number
  filter_count: number
  issues_truncated: boolean
  groups: VerificationGroup[]
  issues: VerificationIssue[]
}

export const importsApi = {
  listFiles: (customerId: string) =>
    apiFetch<ImportFileListResponse>(`/imports/files?customer_id=${customerId}`),

  uploadFile: (customerId: string, file: File) => {
    const form = new FormData()
    form.append("customer_id", customerId)
    form.append("file", file)
    return apiFetch<ImportFileInfo>("/imports/upload", { method: "POST", body: form })
  },

  verify: (customerId: string, templateId: string, filename: string) =>
    apiFetch<VerificationResponse>("/imports/verify", {
      method: "POST",
      body: JSON.stringify({ customer_id: customerId, template_id: templateId, filename }),
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

// ─── Simulation Filters ──────────────────────────────────────────────────────

export interface SimulationFilterResponse {
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

export interface SimulationFilterCreate {
  customer_id: string
  name: string
  description?: string | null
  from_date: string
  to_date: string
}

export interface SimulationFilterUpdate {
  name?: string | null
  description?: string | null
  from_date?: string | null
  to_date?: string | null
}

export const simulationFiltersApi = {
  list: (customerId: string) =>
    apiFetch<SimulationFilterResponse[]>(`/simulation-filters?customer_id=${customerId}`),

  create: (data: SimulationFilterCreate) =>
    apiFetch<SimulationFilterResponse>("/simulation-filters", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: SimulationFilterUpdate) =>
    apiFetch<SimulationFilterResponse>(`/simulation-filters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/simulation-filters/${id}`, { method: "DELETE" }),
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

// ─── Optimization ─────────────────────────────────────────────────────────────

export interface OptimizeSettingsRequest {
  customer_id: string
  name?: string | null
  optimize_variation_adjustment: boolean
  optimize_eo_methodology: boolean
  optimize_eo_extrapolation: boolean
  optimize_covariate_handling: boolean
  optimize_covariate_weekday?: boolean
  optimize_covariate_price?: boolean
  optimize_covariate_pad?: boolean
  optimize_weekday_profile_correction: boolean
  optimize_history_window?: boolean
  history_window_from?: number
  history_window_to?: number
  history_window_iterations?: number
  optimize_correction_strength?: boolean
  correction_strength_from?: number
  correction_strength_to?: number
  correction_strength_iterations?: number
  optimize_correction_threshold?: boolean
  correction_threshold_from?: number
  correction_threshold_to?: number
  correction_threshold_iterations?: number
  simulation_from?: string | null
  simulation_to?: string | null
  simulation_days?: number
  delay?: number
  prediction_engine_id?: string | null
  prediction_strategy_id?: string | null
  outlet_group_id?: string | null
  worker?: string | null
}

export interface OptimizationCombinationResult {
  combination: Record<string, unknown>
  score: number | null
  metrics: {
    d_total_delivered?: number | null
    d_total_sold?: number | null
    d_total_returned?: number | null
    eo_total_sold?: number | null
    eo_total_delivered?: number | null
    eo_total_returned?: number | null
    sold_out_pct?: number | null
    mae?: number | null
    rmse?: number | null
    r_squared?: number | null
    mape?: number | null
    bias?: number | null
  }
  simulation_id: string | null
  error?: string
}

export interface OptimizationRunResponse {
  id: string
  customer_id: string
  name: string
  status: string
  optimize_variation_adjustment: boolean
  optimize_eo_methodology: boolean
  optimize_eo_extrapolation: boolean
  optimize_covariate_handling: boolean
  optimize_covariate_weekday: boolean
  optimize_covariate_price: boolean
  optimize_covariate_pad: boolean
  optimize_weekday_profile_correction: boolean
  simulation_days: number
  delay: number
  prediction_engine_id: string | null
  engine_name: string | null
  simulation_from: string | null
  simulation_to: string | null
  total_combinations: number
  completed_combinations: number
  best_combination: Record<string, unknown> | null
  best_score: number | null
  results: OptimizationCombinationResult[] | null
  diagnostics: OptimizationDiagnostics | null
  created_at: string
  completed_at: string | null
}

export interface OptimizationDiagnostics {
  g3_g4_by_tau: {
    interpolation: { g1: number; g2: number; g3: number; g4: number }
    extrapolation: { g1: number; g2: number; g3: number; g4: number }
  } | null
  quantile_calibration: {
    total_days: number
    below_q90: number
    pct_below_q90: number
    expected: number
    assessment: string
  } | null
  g3_by_weekday: {
    weekdays: Record<string, { g3_count: number; total: number; g3_rate: number }>
  } | null
  va_comparison: {
    with_va: { g1: number; g2: number; g3: number; g4: number; score: number }
    without_va: { g1: number; g2: number; g3: number; g4: number; score: number }
    assessment: string
  } | null
}

export interface ApplySettingsRequest {
  variation_adjustment?: boolean | null
  eo_methodology?: number | null
  eo_extrapolation?: number | null
  covariate_handling?: string | null
  weekday_profile_correction?: boolean | null
  variation_history_days?: number | null
  weekday_profile_correction_strength?: number | null
  weekday_profile_correction_threshold?: number | null
}

export const optimizationApi = {
  runAsync: (data: OptimizeSettingsRequest) =>
    apiFetch<{ task_id: string }>("/optimization/async", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  list: (customerId: string) =>
    apiFetch<OptimizationRunResponse[]>(`/optimization?customer_id=${customerId}`),

  get: (runId: string) =>
    apiFetch<OptimizationRunResponse>(`/optimization/${runId}`),

  apply: (runId: string, data: ApplySettingsRequest) =>
    apiFetch<void>(`/optimization/${runId}/apply`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  resume: (runId: string, worker?: string) => {
    const qs = worker !== undefined ? `?worker=${encodeURIComponent(worker)}` : ""
    return apiFetch<{ task_id: string }>(`/optimization/${runId}/resume${qs}`, {
      method: "POST",
    })
  },

  delete: (runId: string) =>
    apiFetch<void>(`/optimization/${runId}`, { method: "DELETE" }),
}

// ─── Finetune Examinations ──────────────────────────────────────────────────

export interface FinetuneExaminationResponse {
  id: string
  customer_id: string
  name: string
  description: string | null
  simulation_from: string | null
  simulation_to: string | null
  delay: number | null
  outlet_group_id: string | null
  prediction_strategy_id: string | null
  base_engine: string | null
  finetuned_engine: string | null
  finetuned_model: string | null
  base_simulation_id: string | null
  finetuned_simulation_id: string | null
  status: string
  error: string | null
  started_at: string | null
  completed_at: string | null
  task_id: string | null
  base_stats: AccuracyStatsResponse | null
  finetuned_stats: AccuracyStatsResponse | null
  base_zero_shot: ZeroShotResponse | null
  finetuned_zero_shot: ZeroShotResponse | null
  base_overview: FilteredOverviewResponse | null
  finetuned_overview: FilteredOverviewResponse | null
  conclusion: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface FinetuneExaminationListResponse {
  items: FinetuneExaminationResponse[]
  total: number
}

export interface FinetuneExaminationCreate {
  customer_id: string
  name: string
  description?: string | null
  simulation_from: string
  simulation_to: string
  delay?: number
  outlet_group_id?: string | null
  prediction_strategy_id?: string | null
  base_engine?: string
  finetuned_engine?: string
  finetuned_model?: string | null
  worker?: string | null
}

export const finetuneExaminationsApi = {
  list: (customerId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams({ customer_id: customerId })
    qs.set("limit", String(params?.limit ?? 500))
    if (params?.offset) qs.set("offset", String(params.offset))
    return apiFetch<FinetuneExaminationListResponse>(`/finetune-examinations?${qs}`)
  },

  get: (id: string) =>
    apiFetch<FinetuneExaminationResponse>(`/finetune-examinations/${id}`),

  create: (data: FinetuneExaminationCreate) =>
    apiFetch<FinetuneExaminationResponse>("/finetune-examinations", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/finetune-examinations/${id}`, { method: "DELETE" }),
}

// ─── Price History ────────────────────────────────────────────────────────────

export interface PriceHistoryResponse {
  id: string
  customer_id: string
  name: string
  description: string | null
  effective_date: string
  weekday: number
  price_per_unit: number | null
  cost_per_unit: number | null
  profit_per_unit: number | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface PriceHistoryCreate {
  customer_id: string
  name: string
  description?: string | null
  effective_date: string
  weekdays: number[]
  price_per_unit?: number | null
  cost_per_unit?: number | null
  profit_per_unit?: number | null
}

export const priceHistoryApi = {
  list: (customerId: string) =>
    apiFetch<PriceHistoryResponse[]>(
      `/price-history?customer_id=${customerId}`,
    ),

  create: (data: PriceHistoryCreate) =>
    apiFetch<PriceHistoryResponse[]>("/price-history", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<void>(`/price-history/${id}`, { method: "DELETE" }),
}

// ─── Chat / Insights ──────────────────────────────────────────────────────────

export interface ChatChartSeries {
  name: string
  data_key: string
  color?: string | null
}

export interface ChatChartConfig {
  type: string
  title?: string | null
  x_key: string
  series: ChatChartSeries[]
  data: Record<string, unknown>[]
}

export interface ChatOutletRef {
  outlet_id: string
  name: string
  city?: string | null
  state?: string | null
  value?: number | null
  value_label?: string | null
}

export interface ChatMessageResponse {
  id: string
  role: "user" | "assistant"
  content: string
  chart?: ChatChartConfig | null
  outlets?: ChatOutletRef[] | null
  created_at: string
}

export interface ChatSessionResponse {
  id: string
  customer_id: string
  title: string
  starred: boolean
  created_at: string
  updated_at: string
}

export interface ChatSessionDetailResponse {
  id: string
  customer_id: string
  title: string
  messages: ChatMessageResponse[]
  created_at: string
  updated_at: string
}

export interface ChatSendResponse {
  session_id: string
  message: ChatMessageResponse
}

export interface ChatStreamCallbacks {
  onStatus?: (status: string) => void
  onText?: (text: string) => void
  onChart?: (chart: ChatChartConfig) => void
  onOutlets?: (outlets: ChatOutletRef[]) => void
  onDone?: (data: { session_id: string; message_id: string }) => void
  onError?: (detail: string) => void
}

export const chatApi = {
  sendStream: async (
    data: { customer_id: string; user_id?: string | null; session_id?: string | null; message: string },
    callbacks: ChatStreamCallbacks,
  ) => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      const text = await res.text()
      callbacks.onError?.(text)
      throw new Error(`API ${res.status}: ${text}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      let currentEvent = ""
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7)
        } else if (line.startsWith("data: ")) {
          const rawData = line.slice(6)
          try {
            const parsed = JSON.parse(rawData)
            switch (currentEvent) {
              case "status": callbacks.onStatus?.(parsed.status); break
              case "text": callbacks.onText?.(parsed.text); break
              case "chart": callbacks.onChart?.(parsed as ChatChartConfig); break
              case "outlets": callbacks.onOutlets?.(parsed as ChatOutletRef[]); break
              case "done": callbacks.onDone?.(parsed); break
              case "error": callbacks.onError?.(parsed.detail); break
            }
          } catch { /* ignore parse errors */ }
          currentEvent = ""
        }
      }
    }
  },

  listSessions: (customerId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams({ customer_id: customerId })
    qs.set("limit", String(params?.limit ?? 50))
    if (params?.offset) qs.set("offset", String(params.offset))
    return apiFetch<ChatSessionResponse[]>(`/chat/sessions?${qs}`)
  },

  getSession: (sessionId: string) =>
    apiFetch<ChatSessionDetailResponse>(`/chat/sessions/${sessionId}`),

  updateSession: (sessionId: string, data: { title?: string; starred?: boolean }) =>
    apiFetch<ChatSessionResponse>(`/chat/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteSession: (sessionId: string) =>
    apiFetch<void>(`/chat/sessions/${sessionId}`, { method: "DELETE" }),
}

// -- Configuration Covariates ------------------------------------------------

export interface ConfigurationCovariateResponse {
  id: string
  customer_id: string | null
  name: string
  description: string | null
  type: number
  active: boolean
  created_at: string
  updated_at: string
}

export const configurationCovariatesApi = {
  list: (customerId?: string) =>
    apiFetch<ConfigurationCovariateResponse[]>(
      `/configuration-covariates${customerId ? `?customer_id=${customerId}` : ""}`
    ),

  update: (id: string, data: { active: boolean }) =>
    apiFetch<ConfigurationCovariateResponse>(`/configuration-covariates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  ensure: (customerId: string) =>
    apiFetch<ConfigurationCovariateResponse[]>(`/configuration-covariates/ensure/${customerId}`, {
      method: "POST",
    }),
}

// -- Pricing Analytics -------------------------------------------------------

export type ElasticityConfidence = "high" | "medium" | "low" | "insufficient_data"
export type PriceVariationViability = "adequate" | "marginal" | "insufficient"
export type ProjectionMode = "constant_elasticity" | "linear"

export interface OutletElasticity {
  outlet_id: string
  outlet_name: string | null
  beta_price: number | null
  elasticity: number | null
  mean_price: number | null
  mean_demand: number | null
  price_cv: number | null
  within_weekday_cv: number | null
  n_distinct_prices: number
  n_days_observed: number
  window_days: number
  confidence: ElasticityConfidence
  reason: string | null
  computed_at: string | null
}

export interface CustomerElasticitySummary {
  customer_id: string
  window_days: number
  n_outlets: number
  n_outlets_with_elasticity: number
  median_elasticity: number | null
  p10_elasticity: number | null
  p90_elasticity: number | null
  outlets: OutletElasticity[]
}

export interface OutletPriceVariation {
  outlet_id: string
  outlet_name: string | null
  window_days: number
  n_days_observed: number
  n_distinct_prices: number
  min_price: number | null
  max_price: number | null
  mean_price: number | null
  price_cv: number | null
  within_weekday_cv: number | null
  first_change_date: string | null
  last_change_date: string | null
  viability: PriceVariationViability
  reason: string | null
}

export interface CustomerPriceVariation {
  customer_id: string
  window_days: number
  n_outlets: number
  n_adequate: number
  n_marginal: number
  n_insufficient: number
  overall_viability: PriceVariationViability
  outlets: OutletPriceVariation[]
  deep_last_change_date: string | null
  deep_n_distinct_prices: number
}

export interface OutletScenarioOutcome {
  adjustment_pct: number
  new_price: number | null
  scenario_daily_demand: number | null
  scenario_daily_revenue: number | null
  scenario_daily_profit: number | null
  demand_delta_pct: number | null
  revenue_delta_pct: number | null
  profit_delta_pct: number | null
  extrapolation: boolean
}

export interface OutletPriceScenario {
  outlet_id: string
  outlet_name: string | null
  window_days: number
  projection: ProjectionMode
  elasticity: number | null
  confidence: ElasticityConfidence
  mean_price: number | null
  mean_demand: number | null
  mean_cost: number | null
  baseline_daily_revenue: number | null
  baseline_daily_profit: number | null
  min_observed_price: number | null
  max_observed_price: number | null
  scenarios: OutletScenarioOutcome[]
  reason: string | null
}

export interface CustomerScenarioOutcome {
  adjustment_pct: number
  scenario_daily_demand: number
  scenario_daily_revenue: number
  scenario_daily_profit: number | null
  demand_delta_pct: number
  revenue_delta_pct: number
  profit_delta_pct: number | null
  n_outlets_included: number
}

export interface CustomerPriceScenario {
  customer_id: string
  window_days: number
  projection: ProjectionMode
  adjustment_pcts: number[]
  n_outlets: number
  n_outlets_included: number
  n_outlets_excluded: number
  baseline_daily_demand: number
  baseline_daily_revenue: number
  baseline_daily_profit: number | null
  scenarios: CustomerScenarioOutcome[]
  outlets: OutletPriceScenario[] | null
}

export type RecommendationStatus =
  | "recommended"
  | "boundary_high"
  | "boundary_low"
  | "no_change"
  | "insufficient_data"

export interface OutletPriceRecommendation {
  outlet_id: string
  outlet_name: string | null
  window_days: number
  status: RecommendationStatus
  elasticity: number | null
  confidence: ElasticityConfidence
  mean_price: number | null
  mean_cost: number | null
  recommended_adjustment_pct: number | null
  recommended_price: number | null
  baseline_daily_profit: number | null
  projected_daily_profit: number | null
  profit_uplift_pct: number | null
  safe_range_min_adjustment: number | null
  safe_range_max_adjustment: number | null
  reason: string | null
}

export interface CustomerPriceRecommendation {
  customer_id: string
  window_days: number
  status: RecommendationStatus
  n_outlets: number
  n_outlets_included: number
  n_outlets_excluded: number
  baseline_daily_revenue: number
  baseline_daily_profit: number | null
  recommended_adjustment_pct: number | null
  projected_daily_revenue: number | null
  projected_daily_profit: number | null
  profit_uplift_pct: number | null
  safe_range_min_adjustment: number | null
  safe_range_max_adjustment: number | null
  reason: string | null
  outlets: OutletPriceRecommendation[] | null
}

export type CoverageState =
  | "with_log"
  | "with_legacy"
  | "missing_viable"
  | "missing_not_viable"

export type RidgeCapableEngine =
  | "flowstate"
  | "yinglong"
  | "toto"
  | "moirai2"
  | "timesfm"
  | "timesfm_finetuned"
  | "chronos2"
  | "chronos-bolt"
  | "sundial"
  | "kairos"
  | "tirex"
  | "toto2"
  | "ttm"
  | "tabpfn"
  | "gluon-chronos-bolt"
  | "gluon-chronos2"
  | "gluon-toto"

export interface OutletCoverage {
  outlet_id: string
  outlet_name: string | null
  state: CoverageState
  viability: PriceVariationViability
  n_days_observed: number
  price_cv: number | null
  within_weekday_cv: number | null
  computed_at: string | null
}

export interface CustomerCoverageSummary {
  customer_id: string
  window_days: number
  n_outlets: number
  n_with_log: number
  n_with_legacy: number
  n_missing_viable: number
  n_missing_not_viable: number
  outlets: OutletCoverage[]
}

export interface CoverageBackfillRequest {
  engine?: RidgeCapableEngine
  prediction_days?: number
  window_days?: number
  batch_size?: number
  worker?: string | null
}

export interface CoverageBackfillResponse {
  customer_id: string
  task_id: string | null
  n_outlets_dispatched: number
  engine: string
  message: string
}

export const pricingAnalyticsApi = {
  customerViability: (customerId: string, windowDays = 90) =>
    apiFetch<CustomerPriceVariation>(
      `/analytics/pricing/viability/customer/${customerId}?window_days=${windowDays}`
    ),
  customerElasticity: (customerId: string, windowDays = 90) =>
    apiFetch<CustomerElasticitySummary>(
      `/analytics/elasticity/customer/${customerId}?window_days=${windowDays}`
    ),
  customerScenario: (
    customerId: string,
    adjustmentPcts: number[],
    windowDays = 90,
    includeOutlets = false,
    projection: ProjectionMode = "constant_elasticity"
  ) => {
    const qs = new URLSearchParams()
    for (const p of adjustmentPcts) qs.append("adjustment_pcts", String(p))
    qs.set("window_days", String(windowDays))
    qs.set("include_outlets", String(includeOutlets))
    qs.set("projection", projection)
    return apiFetch<CustomerPriceScenario>(
      `/analytics/pricing/scenario/customer/${customerId}?${qs}`
    )
  },
  customerRecommendation: (
    customerId: string,
    windowDays = 90,
    includeOutlets = false
  ) => {
    const qs = new URLSearchParams()
    qs.set("window_days", String(windowDays))
    qs.set("include_outlets", String(includeOutlets))
    return apiFetch<CustomerPriceRecommendation>(
      `/analytics/pricing/recommendation/customer/${customerId}?${qs}`
    )
  },
  customerCoverage: (customerId: string, windowDays = 90) =>
    apiFetch<CustomerCoverageSummary>(
      `/analytics/elasticity/coverage/customer/${customerId}?window_days=${windowDays}`
    ),
  customerBackfill: (customerId: string, body: CoverageBackfillRequest = {}) =>
    apiFetch<CoverageBackfillResponse>(
      `/analytics/elasticity/backfill/customer/${customerId}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    ),
}

// -- Event-based elasticity --------------------------------------------------

export type EventConfidence = "high" | "medium" | "low" | "insufficient"

export interface PriceChangeEventOut {
  id: string
  customer_id: string
  outlet_id: string
  outlet_name: string | null
  weekday: number  // 1=Mon..7=Sun
  change_date: string
  price_before: number
  price_after: number
  pct_change: number
}

export interface ElasticityEventOut {
  id: string
  price_change_event_id: string
  outlet_id: string
  outlet_name: string | null
  engine: string
  post_days: number
  task_id: string | null
  forecast_mean: number | null
  actual_mean: number | null
  n_post_days: number
  epsilon: number | null
  confidence: EventConfidence
  reason: string | null
  computed_at: string | null
}

export interface EventWithEstimate {
  event: PriceChangeEventOut
  estimate: ElasticityEventOut | null
}

export interface OutletEventTimeline {
  outlet_id: string
  outlet_name: string | null
  events: EventWithEstimate[]
  median_epsilon: number | null
  n_events_with_estimate: number
  drift_slope: number | null
}

export interface CustomerEventSummary {
  customer_id: string
  engine: string
  post_days: number
  n_outlets: number
  n_events_total: number
  n_events_with_estimate: number
  median_epsilon: number | null
  p10_epsilon: number | null
  p90_epsilon: number | null
  drift_slope: number | null
  outlets: OutletEventTimeline[]
}

export interface EventBuildRequest {
  engine?: RidgeCapableEngine
  post_days?: number
  rebuild_existing?: boolean
}

export interface EventBuildResponse {
  customer_id: string
  n_events_detected: number
  n_events_dispatched: number
  task_ids: string[]
  engine: string
  post_days: number
  message: string
}

export const elasticityEventsApi = {
  customerSummary: (
    customerId: string,
    engine: string = "flowstate",
    postDays: number = 30,
  ) =>
    apiFetch<CustomerEventSummary>(
      `/analytics/elasticity-events/customer/${customerId}?engine=${engine}&post_days=${postDays}`,
    ),
  listEvents: (
    customerId: string,
    engine: string = "flowstate",
    postDays: number = 30,
  ) =>
    apiFetch<EventWithEstimate[]>(
      `/analytics/elasticity-events/customer/${customerId}/events?engine=${engine}&post_days=${postDays}`,
    ),
  build: (customerId: string, body: EventBuildRequest = {}) =>
    apiFetch<EventBuildResponse>(
      `/analytics/elasticity-events/build/customer/${customerId}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  recompute: (
    eventId: string,
    engine: string = "flowstate",
    postDays: number = 30,
  ) =>
    apiFetch<ElasticityEventOut>(
      `/analytics/elasticity-events/event/${eventId}/recompute?engine=${engine}&post_days=${postDays}`,
      { method: "POST" },
    ),
}

export interface KlineData {
  id: string
  coin_id: string
  quote_asset: string
  interval: string
  open_time: number
  close_time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  quote_asset_volume: number
  number_of_trades: number
  taker_buy_base_asset_volume: number
  taker_buy_quote_asset_volume: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface PredictionEngine {
  name: string
  description?: string
}

export type ImportStatus = "pending" | "started" | "success" | "failure" | "stopped"

export const binanceImportApi = {
  // Enqueue a Binance import as a background task; returns a task_id.
  startAsync: (params: { symbol: string; interval: string; coin_id: string; quote_asset: string; start_date?: string; end_date?: string }) => {
    const qs = new URLSearchParams()
    qs.set("symbol", params.symbol)
    qs.set("interval", params.interval)
    qs.set("coin_id", params.coin_id)
    qs.set("quote_asset", params.quote_asset)
    if (params.start_date) qs.set("start_date", params.start_date)
    if (params.end_date) qs.set("end_date", params.end_date)
    return apiFetch<{ task_id: string; status: string; name: string }>(`/binance-import/binance-async?${qs}`, { method: "POST" })
  },
  status: (taskId: string) =>
    apiFetch<{
      task_id: string
      status: ImportStatus
      progress: number
      progress_message: string | null
      error: string | null
      imported_count: number | null
    }>(`/binance-import/tasks/${taskId}`),
  // Top up every loaded (trading pair + timeframe) series for a coin with the
  // latest Binance data. Enqueues one background import per combo.
  refreshCoin: (coinId: string) =>
    apiFetch<{
      tasks: { task_id: string; name: string; quote_asset: string; interval: string }[]
      count: number
      message?: string
    }>(`/binance-import/refresh-coin?coin_id=${encodeURIComponent(coinId)}`, { method: "POST" }),
  // Same as refreshCoin, for many coins at once. Enqueues one import per
  // (standard interval) for each coin's USDT pair.
  refreshCoins: (coinIds: string[]) => {
    const qs = new URLSearchParams()
    coinIds.forEach((id) => qs.append("coin_ids", id))
    return apiFetch<{
      tasks: { task_id: string; name: string; quote_asset: string; interval: string }[]
      count: number
    }>(`/binance-import/refresh-coins?${qs}`, { method: "POST" })
  },
}

export const klinesApi = {
  list: (params?: {
    coin_id?: string
    interval?: string
    quote_asset?: string
    limit?: number
    offset?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.coin_id) qs.set("coin_id", params.coin_id)
    if (params?.interval) qs.set("interval", params.interval)
    if (params?.quote_asset) qs.set("quote_asset", params.quote_asset)
    qs.set("limit", String(params?.limit ?? 100))
    if (params?.offset) qs.set("offset", String(params.offset))
    return apiFetch<KlineData[]>(`/klines?${qs}`)
  },

  getTradingPairs: (coinId: string) =>
    apiFetch<{ pairs: string[] }>(`/klines/pairs/${coinId}`),

  getPairCounts: () =>
    apiFetch<Record<string, number>>("/klines/pair-counts"),

  // Most recent data-update timestamp (ISO 8601) per coin id.
  getLastUpdated: () =>
    apiFetch<Record<string, string>>("/klines/last-updated"),

  // Average daily traded value in USDT over the last `days` 1d bars, per coin id.
  getAvgDailyVolume: (days = 30) =>
    apiFetch<Record<string, number>>(`/klines/avg-daily-volume?days=${days}`),

  getTimeframes: (coinId: string, quoteAsset: string) =>
    apiFetch<{ timeframes: string[] }>(`/klines/timeframes/${coinId}/${quoteAsset}`),

  getDateRange: (coinId: string, quoteAsset: string, interval: string) =>
    apiFetch<{ start_date: string | null; end_date: string | null }>(
      `/klines/range/${coinId}/${quoteAsset}/${interval}`,
    ),

  deleteAll: (coinId: string, quoteAsset: string, interval: string) =>
    apiFetch<{ deleted_count: number }>(`/klines?coin_id=${coinId}&quote_asset=${quoteAsset}&interval=${interval}`, { method: "DELETE" }),

  getEngines: () =>
    apiFetch<string[]>("/predictions/engines").then((names) =>
      names.map((name) => ({ name })) as PredictionEngine[]
    ),

  simulate: (params: {
    coin_id: string
    quote_asset: string
    interval: string
    start_date: string
    end_date: string
    models: string[]
  }) => {
    const qs = new URLSearchParams()
    qs.set("coin_id", params.coin_id)
    qs.set("quote_asset", params.quote_asset)
    qs.set("interval", params.interval)
    qs.set("start_date", params.start_date)
    qs.set("end_date", params.end_date)
    params.models.forEach((m) => qs.append("models", m))
    return apiFetch<any>(`/klines/simulate?${qs}`, { method: "POST" })
  },

  // Enqueue a walk-forward simulation as a background task; returns a task_id.
  simulateAsync: (params: {
    coin_id: string
    quote_asset: string
    interval: string
    start_date: string
    end_date: string
    models: string[]
  }) => {
    const qs = new URLSearchParams()
    qs.set("coin_id", params.coin_id)
    qs.set("quote_asset", params.quote_asset)
    qs.set("interval", params.interval)
    qs.set("start_date", params.start_date)
    qs.set("end_date", params.end_date)
    params.models.forEach((m) => qs.append("models", m))
    return apiFetch<{ task_id: string; status: string }>(
      `/klines/simulate-async?${qs}`,
      { method: "POST" },
    )
  },

  // Poll a background simulation; `result` is populated once status is success.
  simulateStatus: (taskId: string) =>
    apiFetch<{
      task_id: string
      status: "pending" | "started" | "success" | "failure" | "stopped"
      progress: number
      progress_message: string | null
      error: string | null
      result: any | null
    }>(`/klines/simulate-tasks/${taskId}`),
}

// ── Persisted kline simulations (master/detail) ─────────────────────────────
export type KlineSimulationStatus = "pending" | "started" | "success" | "failure" | "stopped" | "degraded"

export interface KlineSimulationResponse {
  id: string
  coin_id: string
  coin_symbol: string | null
  quote_asset: string
  interval: string
  start_date: string
  end_date: string
  models: string[]
  name: string | null
  description: string | null
  strategy: string
  config: Record<string, unknown> | null
  task_id: string | null
  status: KlineSimulationStatus
  finished_at: string | null
  result: any | null
  // Price skill in [-1, 1]: directional return IC (computed for every run).
  score: number | null
  // Significance of the price score: t-statistic under the no-signal null.
  // Sortable to screen many runs for statistically real edge (look for >= 4).
  score_t: number | null
  // Volatility skill (corr of predicted vs realized range-vol) + its t.
  // Only set for forecast_vol runs; kept separate from `score` so each
  // column sorts one comparable metric.
  score_vol: number | null
  score_vol_t: number | null
  error: string | null
  starred: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export const klineSimulationsApi = {
  list: (params?: { search?: string; sort_field?: string; sort_dir?: "asc" | "desc"; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.search) qs.set("search", params.search)
    qs.set("sort_field", params?.sort_field ?? "created_at")
    qs.set("sort_dir", params?.sort_dir ?? "desc")
    qs.set("limit", String(params?.limit ?? 100))
    qs.set("offset", String(params?.offset ?? 0))
    return apiFetch<{ items: KlineSimulationResponse[]; total: number }>(`/kline-simulations?${qs}`)
  },
  get: (id: string) => apiFetch<KlineSimulationResponse>(`/kline-simulations/${id}`),
  create: (data: {
    coin_id: string
    quote_asset: string
    interval: string
    start_date: string
    end_date: string
    models: string[]
    name?: string | null
    description?: string | null
    strategy?: string
    config?: Record<string, unknown> | null
    forecast_vol?: boolean
    horizon?: number
    covariate_mode?: "off" | "native" | "external"
    worker?: string | null
  }) => apiFetch<KlineSimulationResponse>(`/kline-simulations`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { starred?: boolean }) =>
    apiFetch<KlineSimulationResponse>(`/kline-simulations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // Re-run a simulation from scratch with the same parameters; creates a new run.
  rerun: (id: string) =>
    apiFetch<KlineSimulationResponse>(`/kline-simulations/${id}/rerun`, { method: "POST" }),
  delete: (id: string) => apiFetch<{ success: boolean }>(`/kline-simulations/${id}`, { method: "DELETE" }),
  status: (id: string) =>
    apiFetch<{
      id: string
      task_id: string | null
      status: KlineSimulationStatus
      progress: number
      progress_message: string | null
      error: string | null
      result: any | null
    }>(`/kline-simulations/${id}/status`),
  predictions: (id: string, params?: { model?: string; sort_field?: string; sort_dir?: "asc" | "desc"; limit?: number; offset?: number; direction?: "correct" | "faulty"; forecast?: string }) => {
    const qs = new URLSearchParams()
    if (params?.model) qs.set("model", params.model)
    if (params?.direction) qs.set("direction", params.direction)
    if (params?.forecast && params.forecast !== "prediction") qs.set("forecast", params.forecast)
    qs.set("sort_field", params?.sort_field ?? "timestamp")
    qs.set("sort_dir", params?.sort_dir ?? "asc")
    qs.set("limit", String(params?.limit ?? 50))
    qs.set("offset", String(params?.offset ?? 0))
    return apiFetch<{ items: KlineSimulationPredictionResponse[]; total: number; models: string[]; coverage_inside: number; coverage_total: number; mape: number | null }>(
      `/kline-simulations/${id}/predictions?${qs}`,
    )
  },
  backtest: (id: string, params: { model?: string; threshold?: number; fee_bps?: number; min_edge_pct?: number; vol_mode?: string; cover_fees?: boolean; position_sizing?: string; pyramid_steps?: number; allow_short?: boolean }) => {
    const qs = new URLSearchParams()
    if (params.model) qs.set("model", params.model)
    qs.set("threshold", String(params.threshold ?? 0.6))
    qs.set("fee_bps", String(params.fee_bps ?? 15))
    qs.set("min_edge_pct", String(params.min_edge_pct ?? 0))
    if (params.vol_mode) qs.set("vol_mode", params.vol_mode)
    if (params.cover_fees) qs.set("cover_fees", "true")
    if (params.position_sizing && params.position_sizing !== "none") qs.set("position_sizing", params.position_sizing)
    if (params.position_sizing === "pyramiding" && params.pyramid_steps) qs.set("pyramid_steps", String(params.pyramid_steps))
    if (params.allow_short) qs.set("allow_short", "true")
    return apiFetch<BacktestResponse>(`/kline-simulations/${id}/backtest?${qs}`)
  },
  swings: (id: string, params: { threshold?: number; hold_bars?: number; fee_bps?: number; side?: string; use_model?: boolean; signals?: string; sl_mode?: string; sl_value?: number; tp_mode?: string; tp_value?: number; weights?: string }) => {
    const qs = new URLSearchParams()
    qs.set("threshold", String(params.threshold ?? 1.0))
    qs.set("hold_bars", String(params.hold_bars ?? 6))
    qs.set("fee_bps", String(params.fee_bps ?? 8))
    qs.set("side", params.side ?? "long")
    if (params.use_model) qs.set("use_model", "true")
    if (params.signals) qs.set("signals", params.signals)
    if (params.sl_mode && params.sl_mode !== "none") {
      qs.set("sl_mode", params.sl_mode)
      qs.set("sl_value", String(params.sl_value ?? 2))
    }
    if (params.tp_mode && params.tp_mode !== "none") {
      qs.set("tp_mode", params.tp_mode)
      qs.set("tp_value", String(params.tp_value ?? 3))
    }
    if (params.weights) qs.set("weights", params.weights)
    return apiFetch<SwingAnalysisResponse>(`/kline-simulations/${id}/swings?${qs}`)
  },
  swingsOptimize: (id: string, params: { fee_bps?: number; use_model?: boolean }) => {
    const qs = new URLSearchParams()
    qs.set("fee_bps", String(params.fee_bps ?? 4))
    if (params.use_model) qs.set("use_model", "true")
    return apiFetch<SwingOptimizeResponse>(`/kline-simulations/${id}/swings/optimize?${qs}`)
  },
}

// ── Standalone swing analysis (Trading → Trend Swings) ──────────────────────
// Pure kline analysis over an explicit scope — no simulation required.
// confirm_sim_id optionally borrows a run's stored P(up) for entry confirmation.
export interface SwingScope {
  coin_id: string
  quote_asset: string
  interval: string
  start_date: string
  end_date: string
}

function swingScopeQs(scope: SwingScope): URLSearchParams {
  const qs = new URLSearchParams()
  qs.set("coin_id", scope.coin_id)
  qs.set("quote_asset", scope.quote_asset)
  qs.set("interval", scope.interval)
  qs.set("start_date", scope.start_date)
  qs.set("end_date", scope.end_date)
  return qs
}

// ── Scalping-strategy analysis (Trading → Strategies → Scalping) ────────────
// One backtested round-trip in full — the rows behind the chart markers. Only
// the first ~25 are returned; the charts and every statistic cover them all.
export interface BacktestTradeRow {
  seq: number
  side: "long" | "short"
  entry_time: string
  entry_price: number
  exit_time: string
  exit_price: number
  bars_held: number
  ret_bps: number
  exit_reason: string
}

export interface ScalpSignalPoint {
  timestamp: string
  long_score: number | null
  short_score: number | null
}

export interface ScalpAnalysisResponse {
  strategy: string
  indicator: string
  params: Record<string, number>
  vol_gate: string
  vol_level: number
  htf_gate: string
  htf_tf: string
  htf_level: number
  // Base-timeframe bars in the trend lookback; 0 = htf_tf wasn't actually
  // higher than the scope's interval, so the gate is inert.
  htf_bars: number
  threshold: number
  hold_bars: number
  fee_bps: number
  side: string
  sl_mode: string
  sl_value: number
  tp_mode: string
  tp_value: number
  n_bars: number
  long_entries: number
  short_entries: number
  exit_counts: Record<string, number>
  segments: SwingSegmentStats[]
  equity_curve: { timestamp: string; strategy: number; buy_hold: number }[]
  trade_markers: { timestamp: string; exit_timestamp: string | null; ret: number; side: string }[]
  signal_curve: ScalpSignalPoint[]
  // First N round-trips in full, for the trade list under the charts.
  trade_rows: BacktestTradeRow[]
  // Hour/weekday/session cuts of this backtest's trades — only present when the
  // request asked for them (`buckets: true`), i.e. the workbench Analytics tab.
  bucket_analysis: PaperTradeAnalysis | null
}

export const scalpAnalysisApi = {
  analyze: (scope: SwingScope, params: { strategy: string; indicator?: string; threshold?: number; hold_bars?: number; fee_bps?: number; side?: string; sl_mode?: string; sl_value?: number; tp_mode?: string; tp_value?: number; params?: string; vol_gate?: string; vol_level?: number; htf_gate?: string; htf_tf?: string; htf_level?: number; buckets?: boolean; tz_offset_minutes?: number }) => {
    const qs = swingScopeQs(scope)
    qs.set("strategy", params.strategy)
    if (params.indicator) qs.set("indicator", params.indicator)
    qs.set("threshold", String(params.threshold ?? 1.0))
    qs.set("hold_bars", String(params.hold_bars ?? 6))
    qs.set("fee_bps", String(params.fee_bps ?? 4))
    qs.set("side", params.side ?? "both")
    if (params.sl_mode && params.sl_mode !== "none") {
      qs.set("sl_mode", params.sl_mode)
      qs.set("sl_value", String(params.sl_value ?? 2))
    }
    if (params.tp_mode && params.tp_mode !== "none") {
      qs.set("tp_mode", params.tp_mode)
      qs.set("tp_value", String(params.tp_value ?? 3))
    }
    if (params.params) qs.set("params", params.params)
    if (params.vol_gate && params.vol_gate !== "off") {
      qs.set("vol_gate", params.vol_gate)
      qs.set("vol_level", String(params.vol_level ?? 1.0))
    }
    if (params.htf_gate && params.htf_gate !== "off") {
      qs.set("htf_gate", params.htf_gate)
      qs.set("htf_tf", params.htf_tf ?? "4h")
      qs.set("htf_level", String(params.htf_level ?? 0.5))
    }
    if (params.buckets) {
      qs.set("buckets", "true")
      qs.set("tz_offset_minutes", String(params.tz_offset_minutes ?? 0))
    }
    return apiFetch<ScalpAnalysisResponse>(`/scalp-analysis?${qs}`)
  },
}

export const swingAnalysisApi = {
  analyze: (scope: SwingScope, params: { threshold?: number; hold_bars?: number; fee_bps?: number; side?: string; confirm_sim_id?: string | null; signals?: string; sl_mode?: string; sl_value?: number; tp_mode?: string; tp_value?: number; weights?: string; htf_gate?: string; htf_tf?: string; htf_level?: number; buckets?: boolean; tz_offset_minutes?: number }) => {
    const qs = swingScopeQs(scope)
    qs.set("threshold", String(params.threshold ?? 1.0))
    qs.set("hold_bars", String(params.hold_bars ?? 6))
    qs.set("fee_bps", String(params.fee_bps ?? 8))
    qs.set("side", params.side ?? "long")
    if (params.confirm_sim_id) qs.set("confirm_sim_id", params.confirm_sim_id)
    if (params.signals) qs.set("signals", params.signals)
    if (params.sl_mode && params.sl_mode !== "none") {
      qs.set("sl_mode", params.sl_mode)
      qs.set("sl_value", String(params.sl_value ?? 2))
    }
    if (params.tp_mode && params.tp_mode !== "none") {
      qs.set("tp_mode", params.tp_mode)
      qs.set("tp_value", String(params.tp_value ?? 3))
    }
    if (params.weights) qs.set("weights", params.weights)
    if (params.htf_gate && params.htf_gate !== "off") {
      qs.set("htf_gate", params.htf_gate)
      qs.set("htf_tf", params.htf_tf ?? "4h")
      qs.set("htf_level", String(params.htf_level ?? 0.5))
    }
    if (params.buckets) {
      qs.set("buckets", "true")
      qs.set("tz_offset_minutes", String(params.tz_offset_minutes ?? 0))
    }
    return apiFetch<SwingAnalysisResponse>(`/swing-analysis?${qs}`)
  },
  optimize: (scope: SwingScope, params: { fee_bps?: number; confirm_sim_id?: string | null; htf_gate?: string; htf_tf?: string; htf_level?: number }) => {
    const qs = swingScopeQs(scope)
    qs.set("fee_bps", String(params.fee_bps ?? 4))
    if (params.confirm_sim_id) qs.set("confirm_sim_id", params.confirm_sim_id)
    // The gate conditions every swept combo (it is never itself swept).
    if (params.htf_gate && params.htf_gate !== "off") {
      qs.set("htf_gate", params.htf_gate)
      qs.set("htf_tf", params.htf_tf ?? "4h")
      qs.set("htf_level", String(params.htf_level ?? 0.5))
    }
    return apiFetch<SwingOptimizeResponse>(`/swing-analysis/optimize?${qs}`)
  },
}

// ── Swing auto-optimizer (bounded sweep, train/validation split) ────────────
export interface SwingOptimizeStats {
  n_trades: number
  win_rate_pct: number
  avg_net_bps: number
  edge_t: number
  total_return_pct: number
}

export interface SwingOptimizeCombo {
  threshold: number
  hold_bars: number
  side: string
  sl_mode: string
  sl_value: number
  tp_mode: string
  tp_value: number
  signals: string[]
  train: SwingOptimizeStats
  val: SwingOptimizeStats
  full: SwingOptimizeStats
}

export interface SwingOptimizeResponse {
  evaluated: number
  total_combos: number
  partial: boolean
  fee_bps: number
  use_model: boolean
  model_available: boolean
  split_at: string
  results: SwingOptimizeCombo[]
}

// ── Swing/crest analysis (signal-composite backtest over a run's klines) ────
export interface SwingSegmentStats {
  label: string
  n_trades: number
  win_rate_pct: number
  avg_net_bps: number
  edge_t: number
  total_return_pct: number
  buy_hold_return_pct: number
  sharpe: number
  max_drawdown_pct: number
}

export interface SwingSignalDiag {
  key: string
  name: string
  enabled: boolean
  // Contribution multiplier applied (1.0 = equal-weight baseline).
  weight: number
  // z components: mean direction-aware contribution at entry bars.
  // Flags: fraction of entries where the flag fired.
  mean_z_at_entry: number | null
}

export interface SwingSignalPoint {
  timestamp: string
  long_score: number | null
  short_score: number | null
  streak: number | null
  volume: number | null
  range: number | null
  trades: number | null
  avg_trade: number | null
  wick: number | null
  taker: number | null
  stretch: number | null
}

export interface SwingAnalysisResponse {
  threshold: number
  hold_bars: number
  fee_bps: number
  side: string
  sl_mode: string
  sl_value: number
  tp_mode: string
  tp_value: number
  // Per-member contribution multipliers actually applied (1.0 = baseline).
  weights: Record<string, number>
  htf_gate: string
  htf_tf: string
  htf_level: number
  htf_bars: number
  // How trades exited: stop / take_profit / reversal / hold_max.
  exit_counts: Record<string, number>
  use_model: boolean
  model_available: boolean
  n_bars: number
  long_entries: number
  short_entries: number
  vetoed_tops: number
  segments: SwingSegmentStats[]
  signals: SwingSignalDiag[]
  equity_curve: { timestamp: string; strategy: number; buy_hold: number }[]
  trade_markers: { timestamp: string; exit_timestamp: string | null; ret: number; side: string }[]
  // Per-bar composite + component contributions (bucket-max decimated so
  // entry spikes survive). components_side says which side the component
  // values describe ("long" unless side=short).
  signal_curve: SwingSignalPoint[]
  components_side: string
  // First N round-trips in full, for the trade list under the charts.
  trade_rows: BacktestTradeRow[]
  // Hour/weekday/session cuts of this backtest's trades — only present when the
  // request asked for them (`buckets: true`), i.e. the workbench Analytics tab.
  bucket_analysis: PaperTradeAnalysis | null
}

// ─── Kline Strategies (crypto-simulation presets) ────────────────────────────

export interface KlineStrategyResponse {
  id: string
  name: string
  description: string | null
  simulation_strategy: string
  finetuned_model: string | null
  forecast_engine: string | null
  forecast_vol: boolean
  // Bars per forecast step (1 = next bar; H>1 = non-overlapping H-bar trend).
  horizon: number
  // Swing-signal covariates: off / native (model-side API — TimesFM, Chronos-2)
  // / external (trailing-Ridge walk-forward adjustment, works with any engine).
  covariate_mode: "off" | "native" | "external"
  starred: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface KlineStrategyUpdate {
  name?: string
  description?: string | null
  simulation_strategy?: string
  finetuned_model?: string | null
  forecast_engine?: string | null
  forecast_vol?: boolean
  horizon?: number
  covariate_mode?: "off" | "native" | "external"
  starred?: boolean
}

export interface KlineStrategyParameterResponse {
  id: string
  strategy_id: string
  name: string
  value: string
  description: string | null
  selected: boolean
  created_at: string
  updated_at: string
}

export const klineStrategiesApi = {
  list: () => apiFetch<KlineStrategyResponse[]>("/kline-strategies?limit=1000"),

  get: (id: string) => apiFetch<KlineStrategyResponse>(`/kline-strategies/${id}`),

  create: (data: Partial<KlineStrategyUpdate> & { name: string }) =>
    apiFetch<KlineStrategyResponse>("/kline-strategies", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: KlineStrategyUpdate) =>
    apiFetch<KlineStrategyResponse>(`/kline-strategies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<{ success: boolean }>(`/kline-strategies/${id}`, { method: "DELETE" }),

  listParameters: (id: string) =>
    apiFetch<KlineStrategyParameterResponse[]>(`/kline-strategies/${id}/parameters`),

  addParameter: (id: string, data: { name: string; value: string; description?: string | null }) =>
    apiFetch<KlineStrategyParameterResponse>(`/kline-strategies/${id}/parameters`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateParameter: (id: string, paramId: string, data: { selected?: boolean; name?: string; value?: string; description?: string | null }) =>
    apiFetch<KlineStrategyParameterResponse>(`/kline-strategies/${id}/parameters/${paramId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteParameter: (id: string, paramId: string) =>
    apiFetch<{ success: boolean }>(`/kline-strategies/${id}/parameters/${paramId}`, {
      method: "DELETE",
    }),

  copyEngineParameters: (id: string, engineSlug: string) =>
    apiFetch<KlineStrategyParameterResponse[]>(
      `/kline-strategies/${id}/copy-engine-parameters?engine_slug=${encodeURIComponent(engineSlug)}`,
      { method: "POST" },
    ),
}

export interface KlineSimulationPredictionResponse {
  id: string
  model_name: string
  timestamp: string
  actual: number
  predicted: number
  error: number
  pct_error: number
  prev_close: number | null
  quantiles: number[] | null
  prob_up: number | null
  in_interval: boolean | null
  pred_vol: number | null
  realized_vol: number | null
}

export interface BacktestResponse {
  model: string
  strategy?: string
  vol_mode?: string | null
  vol_source?: string | null
  position_sizing?: string
  pyramid_steps?: number
  threshold: number
  fee_bps: number
  min_edge_pct: number
  cover_fees?: boolean
  allow_short?: boolean
  effective_min_edge_pct?: number
  periods_per_year: number
  n_bars: number
  n_trades: number
  n_fills?: number
  long_bars: number
  short_bars?: number
  exposure_pct: number
  win_rate_pct: number
  total_return_pct: number
  buy_hold_return_pct: number
  avg_return_per_trade_pct: number
  sharpe: number
  max_drawdown_pct: number
  equity_curve: { timestamp: string; strategy: number; buy_hold: number }[]
  trade_markers: { timestamp: string; ret: number; side?: string }[]
}

// ─── Strategy Templates ───────────────────────────────────────────────────────
// Named, global bundles of a trading strategy's signal parameters (no scope),
// loadable/editable on the strategy's Analytics page and later on Paper Trade.

export interface StrategyTemplateScope {
  coin_id?: string
  quote_asset?: string
  interval?: string
}

export interface StrategyTemplate {
  id: string
  name: string
  strategy: string
  params: Record<string, unknown>
  // Null on an ABSTRACT strategy — its coin / pair / timeframe are picked when a
  // paper run is started, not stored here.
  scope: StrategyTemplateScope | null
  is_abstract: boolean
  description: string | null
  notes: string | null
  // Paper Trade: gate each new entry behind an AI GO/NO_GO verdict.
  ai_confirmation: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export const strategyTemplatesApi = {
  list: (strategy?: string) =>
    apiFetch<StrategyTemplate[]>(`/strategy-templates${strategy ? `?strategy=${encodeURIComponent(strategy)}` : ""}`),
  get: (id: string) => apiFetch<StrategyTemplate>(`/strategy-templates/${id}`),
  create: (data: { name: string; strategy: string; params: Record<string, unknown>; scope?: StrategyTemplateScope | null; is_abstract?: boolean; description?: string | null; notes?: string | null }) =>
    apiFetch<StrategyTemplate>(`/strategy-templates`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; params?: Record<string, unknown>; scope?: StrategyTemplateScope | null; is_abstract?: boolean; description?: string | null; notes?: string | null; ai_confirmation?: boolean }) =>
    apiFetch<StrategyTemplate>(`/strategy-templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiFetch<void>(`/strategy-templates/${id}`, { method: "DELETE" }),
}

// ─── Paper trade runs (Paper Trade page) ─────────────────────────────────────

export interface PaperTradePnl {
  total: number | null
  h1: number | null; h3: number | null; h6: number | null
  h12: number | null; h24: number | null; week: number | null; month: number | null
}

export interface PaperTradeRun {
  id: string
  template_id: string
  // What the user called this run; null on sweep runs → fall back to template_name.
  name: string | null
  status: string
  started_at: string
  stopped_at: string | null
  uptime_s: number | null
  last_trade_at: string | null
  initial_capital: number
  template_name: string
  strategy: string
  scope: StrategyTemplateScope | null
  n_trades: number
  position: "long" | "short" | null
  error: string | null
  pnl: PaperTradePnl
}

// Where a trade was executed. One field across all three tables, so the detail
// pane can merge them into one list.
export type TradeSource = "paper" | "testnet" | "live"

export interface PaperTrade {
  // trade_seq restarts at 0 in every run, so only (run_id, trade_seq) is unique
  // once several runs are pooled into one table.
  run_id: string
  source: TradeSource
  trade_seq: number
  status: "open" | "closed"
  side: "long" | "short"
  qty: number
  entry_time: string
  entry_price: number
  exit_time: string | null
  exit_price: number | null
  fee_bps: number | null
  ret: number | null
  realized_pnl: number | null
  exit_reason: string | null
  // Strategy-template snapshot, frozen at trade time.
  template_id: string | null
  template_name: string | null
  strategy: string | null
  scope: StrategyTemplateScope | null
  params: Record<string, unknown> | null
  // AI trade-confirmation verdict, frozen at first write. "ERROR" = the
  // advisor stayed unreachable and the trade was blocked fail-closed.
  ai_verdict: "GO" | "NO_GO" | "ERROR" | null
  ai_explanation: string | null
}

// ─── Paper-trade analysis (Paper Trade → Analyze) ────────────────────────────

/** One slice of closed trades (an hour, a weekday, a side …) with its stats.
 *  Returns are fee-inclusive, in basis points. `t_stat` tests the slice against
 *  zero; `t_vs_rest` tests it against every trade outside the slice — that's the
 *  one that says "better HERE than elsewhere". Neither is corrected for the
 *  number of slices tested. */
export interface AnalysisBucket {
  key: string
  label: string
  n_trades: number
  n_wins: number
  n_losses: number
  win_rate: number | null
  mean_bps: number | null
  median_bps: number | null
  sum_bps: number | null
  sum_pnl: number
  t_stat: number | null
  t_vs_rest: number | null
}

// One closed trade, flattened so the Analyze tab can recompute stats for an
// arbitrary hour × weekday × side selection without a round trip.
export interface AnalysisTrade {
  entry_time: string // ISO, UTC
  ret_bps: number
  pnl: number
  side: string
  exit_reason: string | null
}

export interface PaperTradeAnalysis {
  // Null for a BACKTEST's buckets (workbench Analytics tab) — those trades
  // belong to no template and no run, so n_runs is 0 and every sum_pnl is 0.
  template_id: string | null
  template_name: string | null
  scope: "template" | "run" | "backtest"
  tz_offset_minutes: number
  n_runs: number
  n_trades: number
  n_open: number
  first_entry: string | null
  last_entry: string | null
  coins: string[]
  overall: AnalysisBucket
  by_hour: AnalysisBucket[]
  by_hour_block: AnalysisBucket[]
  by_session: AnalysisBucket[]
  by_weekday: AnalysisBucket[]
  by_side: AnalysisBucket[]
  by_exit_reason: AnalysisBucket[]
  trades: AnalysisTrade[]
  trades_truncated: boolean
}

// One OHLCV bar in a trade-analysis window (times are ISO strings).
export interface TradeAnalysisKline {
  open_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Which bars determined a trade decision; `kind` selects the i18n explanation
// template and `data` holds its interpolation values.
export interface TradeSignalInfo {
  kind: string
  mark_times: string[]
  anchor_time: string | null
  data: Record<string, unknown>
}

// Kline snapshot around one trade. `exit_klines` is empty when the exit sits
// inside the entry window (then gap_bars is 0); a positive gap_bars counts the
// bars hidden between the two windows.
export interface TradeAnalysis {
  trade: PaperTrade
  symbol: string
  quote_asset: string
  interval: string
  entry_klines: TradeAnalysisKline[]
  exit_klines: TradeAnalysisKline[]
  gap_bars: number
  entry_signal: TradeSignalInfo | null
  exit_signal: TradeSignalInfo | null
}

export const paperTradeApi = {
  listRuns: (active = false) =>
    apiFetch<PaperTradeRun[]>(`/paper-trade/runs${active ? "?active=true" : ""}`),
  analyze: (templateId: string, scope: "template" | "run" = "template", tzOffsetMinutes = 0) =>
    apiFetch<PaperTradeAnalysis>(
      `/paper-trade/analysis?template_id=${encodeURIComponent(templateId)}&scope=${scope}&tz_offset_minutes=${tzOffsetMinutes}`,
    ),
  // A template can have many concurrent runs (sweeps fan one param-set across
  // coins); `runId` picks which one's trades to read. Omitted = current run.
  // `allRuns` pools every run instead — the detail pane's merged view.
  listTrades: (templateId: string, limit = 500, runId?: string, allRuns = false) =>
    apiFetch<PaperTrade[]>(
      `/paper-trade/trades?template_id=${encodeURIComponent(templateId)}&limit=${limit}` +
      (allRuns ? "&all_runs=true" : runId ? `&run_id=${encodeURIComponent(runId)}` : ""),
    ),
  // trade_seq is unique per run, so pass the run the clicked row came from.
  tradeAnalysis: (templateId: string, tradeSeq: number, runId?: string) =>
    apiFetch<TradeAnalysis>(
      `/paper-trade/trades/analysis?template_id=${encodeURIComponent(templateId)}&trade_seq=${tradeSeq}` +
      (runId ? `&run_id=${encodeURIComponent(runId)}` : ""),
    ),
  // `scope` overrides the strategy's saved coin / pair / timeframe — required
  // for an ABSTRACT strategy, which stores none of its own.
  // When this strategy has actually traded, pooled across every venue — the
  // window in which its backtest and its live record are comparable.
  tradeRange: (templateId: string) =>
    apiFetch<{ first_entry: string | null; last_exit: string | null; n_trades: number }>(
      `/paper-trade/trade-range?template_id=${encodeURIComponent(templateId)}`,
    ),
  // The same popup for a trade that exists only inside a BACKTEST: it has no
  // stored row to look up, so the row itself is posted with the setup behind it.
  backtestTradeAnalysis: (req: {
    coin_id: string; quote_asset: string; interval: string
    strategy: string; params: Record<string, unknown>
    seq: number; side: string
    entry_time: string; entry_price: number
    exit_time: string | null; exit_price: number | null
    ret_bps: number; exit_reason: string | null
  }) =>
    apiFetch<TradeAnalysis>(`/paper-trade/trades/backtest-analysis`, {
      method: "POST", body: JSON.stringify(req),
    }),
  start: (
    templateId: string,
    investment = 100,
    opts: { name?: string | null; scope?: StrategyTemplateScope | null } = {},
  ) => {
    const qs = new URLSearchParams({
      template_id: templateId,
      initial_capital: String(investment),
    })
    if (opts.name?.trim()) qs.set("name", opts.name.trim())
    if (opts.scope?.coin_id) qs.set("coin_id", opts.scope.coin_id)
    if (opts.scope?.quote_asset) qs.set("quote_asset", opts.scope.quote_asset)
    if (opts.scope?.interval) qs.set("interval", opts.scope.interval)
    return apiFetch<PaperTradeRun>(`/paper-trade/start?${qs}`, { method: "POST" })
  },
  // Stop one specific run (a template may have several running at once).
  stop: (runId: string) =>
    apiFetch<PaperTradeRun | null>(`/paper-trade/stop?run_id=${encodeURIComponent(runId)}`, { method: "POST" }),
}

// ─── Paper sweeps (rotating strategy×coin searches) ──────────────────────────

export interface SweepStatus {
  id: string
  name: string
  enabled: boolean
  max_concurrent: number
  dwell_days: number
  initial_capital: number
  n_templates: number
  n_coins: number
  n_combos_total: number
  n_combos_tried: number
  n_running: number
}

export interface SweepTemplateCoin {
  symbol: string
  status: string
  pnl_pct: number
  n_trades: number
}

export interface SweepTemplateStat {
  template_id: string
  template_name: string
  strategy: string
  n_runs: number
  n_running: number
  avg_pnl_pct: number
  median_pnl_pct: number
  win_rate_pct: number
  total_trades: number
  total_pnl_quote: number
  coins: SweepTemplateCoin[]
}

export interface SweepRunStat {
  run_id: string
  template_id: string
  template_name: string
  strategy: string
  coin_symbol: string
  interval: string
  status: string
  started_at: string
  days: number
  pnl_pct: number
  n_trades: number
}

// Two templates identical except for the higher-timeframe gate, with their
// runs matched on (coin, rotation wave) so the difference is a paired read.
export interface SweepPairStat {
  base_template_id: string
  base_template_name: string
  variant_template_id: string
  variant_template_name: string
  strategy: string
  variant_gate: string
  n_paired: number
  base_avg_pnl_pct: number
  variant_avg_pnl_pct: number
  delta_avg_pnl_pct: number
  delta_t: number
  base_trades: number
  variant_trades: number
}

export interface SweepLeaderboard {
  n_runs: number
  templates: SweepTemplateStat[]
  pairs: SweepPairStat[]
  top_runs: SweepRunStat[]
  bottom_runs: SweepRunStat[]
}

export const paperSweepApi = {
  list: () => apiFetch<SweepStatus[]>(`/paper-trade/sweeps`),
  leaderboard: (sweepId?: string, top = 20) =>
    apiFetch<SweepLeaderboard>(
      `/paper-trade/sweeps/leaderboard?top=${top}${sweepId ? `&sweep_id=${encodeURIComponent(sweepId)}` : ""}`,
    ),
  rotate: () => apiFetch<{ sweeps: number; stopped: number; started: number }>(`/paper-trade/sweeps/rotate`, { method: "POST" }),
  // Force-swap the whole wave: stops ALL running combos regardless of age.
  advance: (sweepId: string) =>
    apiFetch<{ stopped: number; started: number }>(
      `/paper-trade/sweeps/advance?sweep_id=${encodeURIComponent(sweepId)}`,
      { method: "POST" },
    ),
  setEnabled: (sweepId: string, enabled: boolean) =>
    apiFetch<SweepStatus | null>(
      `/paper-trade/sweeps/enabled?sweep_id=${encodeURIComponent(sweepId)}&enabled=${enabled}`,
      { method: "POST" },
    ),
}

// ─── Live trade runs (Live Trading page) ─────────────────────────────────────
// Same run/trade shapes as paper trading, plus real-exchange execution detail
// (order ids, commissions, testnet flag). Spot is long-only.

export interface LiveTradeAccount {
  configured: boolean
  testnet: boolean
  base_url: string
  can_trade: boolean | null
  balances: Record<string, number>
  error: string | null
}

export interface LiveTradeRun extends PaperTradeRun {
  is_testnet: boolean
  cash_quote: number
  open_qty: number | null
}

export interface LiveTrade extends PaperTrade {
  signal_time: string | null
  entry_order_id: number | null
  exit_order_id: number | null
  entry_commission: number | null
  exit_commission: number | null
}

export const liveTradeApi = {
  account: () =>
    apiFetch<LiveTradeAccount>(`/live-trade/account`),
  listRuns: (active = false) =>
    apiFetch<LiveTradeRun[]>(`/live-trade/runs${active ? "?active=true" : ""}`),
  // A template can hold several runs; `runId` picks which one's trades to read.
  // Omitted = current run. `allRuns` pools every run — each row's `source` says
  // whether it executed on the testnet or in production.
  listTrades: (templateId: string, limit = 500, runId?: string, allRuns = false) =>
    apiFetch<LiveTrade[]>(
      `/live-trade/trades?template_id=${encodeURIComponent(templateId)}&limit=${limit}` +
      (allRuns ? "&all_runs=true" : runId ? `&run_id=${encodeURIComponent(runId)}` : ""),
    ),
  runningTemplates: () =>
    apiFetch<string[]>(`/live-trade/running-templates`),
  // `testnet` picks the venue and is frozen onto the run for life; `scope`
  // overrides the strategy's saved market (required for an ABSTRACT strategy).
  start: (
    templateId: string,
    investment = 100,
    opts: { testnet?: boolean; name?: string | null; scope?: StrategyTemplateScope | null } = {},
  ) => {
    const qs = new URLSearchParams({
      template_id: templateId,
      initial_capital: String(investment),
    })
    if (opts.testnet !== undefined) qs.set("testnet", String(opts.testnet))
    if (opts.name?.trim()) qs.set("name", opts.name.trim())
    if (opts.scope?.coin_id) qs.set("coin_id", opts.scope.coin_id)
    if (opts.scope?.quote_asset) qs.set("quote_asset", opts.scope.quote_asset)
    if (opts.scope?.interval) qs.set("interval", opts.scope.interval)
    return apiFetch<LiveTradeRun>(`/live-trade/start?${qs}`, { method: "POST" })
  },
  // Which venues have usable credentials — testnet and production are separate
  // accounts with separate keys, so either can be unavailable on its own.
  venues: () => apiFetch<{ testnet: boolean; live: boolean }>(`/live-trade/venues`),
  // Stop one specific run — liquidates any open position with a real market sell.
  stop: (runId: string) =>
    apiFetch<LiveTradeRun | null>(`/live-trade/stop?run_id=${encodeURIComponent(runId)}`, { method: "POST" }),
}


// ─── Strategy optimizations (Optimize tab on a strategy's analytics page) ────
// Named "optimization", not "sweep": a paper SWEEP rotates live paper runs, and
// "sweep" is also a scalping strategy. Three meanings would be unreadable.

export interface OptimizationCoinSelection {
  mode: "single" | "group" | "random" | "all" | "liquidity"
  coin_id?: string | null
  group_id?: string | null
  count?: number
  quote_asset?: string
}

/** The variation grid. camelCase keys mirror the explorer's own param blob so a
 *  result applies straight back onto the page with no translation. */
export interface OptimizationSpec {
  coins: OptimizationCoinSelection
  intervals: string[]
  threshold: number[]
  holdBars: number[]
  sides: string[]
  voldiv: number[]
  btcFilter: number[]
  volGate: string[]
  htfGate: string[]
  slModes: string[]
  slValues: Record<string, number[]>
  tpModes: string[]
  tpValues: Record<string, number[]>
  // Signal knobs that differ per strategy, e.g. {"window": [24, 48]}.
  paramAxes?: Record<string, number[]>
  // "indicator" only: kinds tried, and each kind's own knobs.
  indicators?: string[]
  indicatorValues?: Record<string, Record<string, number[]>>
  // "swings" only: which named composite subsets voted.
  signalSubsets?: string[]
  // Held constant across the grid (fees, gate levels).
  fixed: Record<string, unknown>
  baseline?: { coin_id?: string; quote_asset?: string; interval?: string }
  baseline_params?: Record<string, unknown>
}

export interface StrategyOptimization {
  id: string
  name: string
  description: string | null
  notes: string | null
  strategy: string
  spec: OptimizationSpec
  start_date: string
  end_date: string
  seed: number
  max_combos: number
  sampled: boolean
  n_cartesian: number
  status: "pending" | "running" | "success" | "error" | "stopped"
  n_total: number
  n_done: number
  n_skipped: number
  started_at: string | null
  finished_at: string | null
  error: string | null
  created_at: string
  eta_seconds: number | null
  elapsed_seconds: number | null
}

export interface OptimizationResult {
  id: string
  coin_id: string
  coin_symbol: string | null
  quote_asset: string
  interval: string
  params: Record<string, unknown>
  is_baseline: boolean
  n_trades: number
  avg_net_bps: number
  edge_t: number
  win_rate_pct: number
  total_return_pct: number
  train_n_trades: number
  train_avg_net_bps: number
  train_edge_t: number
  val_n_trades: number
  val_avg_net_bps: number
  val_edge_t: number
  // Payoff SHAPE over the full range — null on results predating these.
  // Negative skew = many small wins paid for by rare large losses (the mean
  // reversion signature); positive = the reverse. t and Sharpe are blind to both.
  skew: number | null
  max_drawdown_pct: number | null
  worst_trade_bps: number | null
  // Enough trades in BOTH halves to be worth ranking on.
  qualified: boolean
}

export interface OptimizationEstimate {
  n_markets: number
  n_param_combos: number
  n_cartesian: number
  n_to_run: number
  sampled: boolean
  est_seconds: number
}

export const strategyOptimizationsApi = {
  list: (strategy?: string) =>
    apiFetch<StrategyOptimization[]>(
      `/strategy-optimizations${strategy ? `?strategy=${encodeURIComponent(strategy)}` : ""}`,
    ),
  get: (id: string) => apiFetch<StrategyOptimization>(`/strategy-optimizations/${id}`),
  results: (id: string, limit = 2000) =>
    apiFetch<OptimizationResult[]>(`/strategy-optimizations/${id}/results?limit=${limit}`),
  // Costed before anything is committed, so the dialog's counter and the runner
  // agree on one definition of "how big is this".
  estimate: (body: Record<string, unknown>) =>
    apiFetch<OptimizationEstimate>(`/strategy-optimizations/estimate`, {
      method: "POST", body: JSON.stringify(body),
    }),
  create: (body: Record<string, unknown>) =>
    apiFetch<StrategyOptimization>(`/strategy-optimizations`, {
      method: "POST", body: JSON.stringify(body),
    }),
  update: (id: string, data: { name?: string; description?: string | null; notes?: string | null }) =>
    apiFetch<StrategyOptimization>(`/strategy-optimizations/${id}`, {
      method: "PATCH", body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/strategy-optimizations/${id}`, { method: "DELETE" }),
}
