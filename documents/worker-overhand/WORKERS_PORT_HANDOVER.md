# Handover: Port the Worker Management feature from gorm.ai → crypto.ai

**Audience:** a Claude working inside the `crypto.ai` project.
**Source of truth:** the sibling repo `gorm.ai`, on the same machine at
`/home/rune/workspace/projects/gorm.ai`. You can `Read` any path below directly.
**Your repo:** `/home/rune/workspace/projects/crypto.ai` (Python package
`crypto_ai`, so every `gorm_ai.…` import below becomes `crypto_ai.…`).

crypto.ai is a fork of gorm.ai with a near-identical structure (FastAPI +
Celery/Redis + Next.js), so most of this is copy-then-rename, plus a short list
of project-specific values to adapt (see **§7 Adaptation checklist**).

---

## 1. What this feature is (scope of the port)

Five things, in dependency order:

1. **Worker selection when starting a prediction/simulation, incl. "Any worker".**
   Routing a task to a worker that actually carries the required model, based on
   a Redis *worker registry* each worker self-populates. *Mostly pre-existing in
   both repos — verify it works; the heartbeat below is what makes it reliable.*
2. **Registry heartbeat (NEW this session).** Keeps idle workers in the registry
   so the "worker" dropdowns don't silently go empty after 2h idle.
3. **The whole `system/workers` page (NEW).** A master table of all workers
   (running / stopped / potential) + a tabbed detail pane (Details / Statistics /
   Actions), backed by a new `/api/v1/workers` API.
4. **Per-worker ping (NEW).** `GET /workers/{name}/ping` + a Ping button in the
   detail pane (distinct from the pre-existing *global* `/tasks/workers/ping`).
5. **Health-check fix (NEW).** Worker containers were falsely "unhealthy" because
   they inherited the image's HTTP `HEALTHCHECK`; give them a worker-appropriate
   check in compose.

Also don't miss (easy to forget): **per-instance vs all-time job counts** in the
Statistics tab, and **localStorage persistence of the selected detail tab**.

---

## 2. Architecture in one paragraph

A worker has **no database record**. It exists only as (a) a compose service
*definition*, (b) a running Docker *container*, and (c) an ephemeral *Redis
registry* entry it writes on boot. The new `/workers` API merges three sources:
**Docker** (container state/health + start/stop control — the app container has
`/var/run/docker.sock` mounted), **Redis** (models/GPU/uptime, incl. remote
workers with no local container), and **Postgres `task_records`** (per-worker job
stats via `GROUP BY worker_name`). The old `/tasks/workers/*` endpoints stay as
they are (the orchestration/prediction worker dropdown + sidebar liveness use
them); the new `/workers/*` router is additive.

---

## 3. Part A — Worker selection & "Any worker" (verify; mostly pre-existing)

crypto.ai already has the registry + routing helpers (confirmed: its
`src/crypto_ai/tasks/celery_app.py` references `WORKER_REGISTRY_PREFIX`,
`resolve_worker_for_engine`, `get_worker_models_map`, `MODEL_WORKER_ENGINES`).
**Verify these exist and are used**, don't rebuild them:

In `tasks/celery_app.py`:
- Redis registry keys (all keyed by full Celery hostname `celery@<name>`):
  `WORKER_REGISTRY_PREFIX` (liveness), `WORKER_MODELS_PREFIX`,
  `WORKER_GPU_PREFIX` / `_NAME_` / `_VRAM_` / `_COUNT_`, `WORKER_STARTED_PREFIX`.
  `WORKER_REGISTRY_TTL = 7200` (2h).
- Set on `@worker_ready`, refreshed on `@task_prerun`/`@task_postrun` via
  `_refresh_worker_registry(hostname)`, deleted on `@worker_shutdown`.
- `MODEL_WORKER_ENGINES: frozenset` — engines that MUST run on a model-carrying
  worker. **Adapt this to crypto's engines** (gorm's are timesfm/chronos/…).
- `get_worker_models_map() -> {name: [slugs]}` (live workers only),
  `resolve_worker_for_engine(slug)` and `resolve_worker_for_engines(slugs)` —
  the latter two implement "Any worker": pick a capable worker's queue, or raise
  a clear error if none is online. Returning `None` = universal engine → default
  `celery` queue.

Dispatch: a task destined for a specific model sets `.set(queue=<worker_name>)`
on its Celery signature. Workers listen on `celery,<their name>`. In gorm the
orchestration chord does this in `tasks/orchestration.py::dispatch_calibration_chord`;
the prediction/simulation paths call `resolve_worker_for_engine(s)`. **Check the
crypto equivalents route the same way** and that the frontend "Any worker" option
maps to *not* pinning a worker (lets the backend resolve).

Frontend worker dropdown uses `GET /tasks/workers/list` (`WorkerInfo[]`) and
filters by `w.models.includes(slug)`. That endpoint only lists *live/registered*
workers — which is exactly why Part B matters.

---

## 4. Part B — Registry heartbeat (NEW) — `tasks/celery_app.py`

**Bug it fixes:** registry keys have a 2h TTL, refreshed only on worker start and
on task start. A worker idle > 2h loses its keys and vanishes from
`/tasks/workers/list` → every worker dropdown goes empty even though the workers
are alive. (The `list` endpoint's ping-fallback re-adds them but with empty
`models`, so the frontend filters them all out.)

**Fix:** a daemon thread in the worker's main process re-runs the registry
refresh every 30 min, independent of the task pool. (A Celery *beat* task is
wrong here — it runs on whichever worker grabs it, not on every worker; each
worker must refresh its **own** key.)

Add `import threading` to the imports. After the `WORKER_REGISTRY_TTL = 7200` /
`TASK_STOP_PREFIX` constants, add:

```python
# Keeps this worker's registry keys alive while idle. task_prerun refreshes the
# TTL on task start, but a worker idle longer than the TTL would expire and drop
# out of /tasks/workers/list despite being alive. Runs in the worker main
# process (not the pool), so it fires whether idle or busy, and refreshes its
# OWN key (a beat task couldn't guarantee that). 4 beats per TTL tolerates misses.
WORKER_HEARTBEAT_INTERVAL = WORKER_REGISTRY_TTL // 4  # 30 min

_heartbeat_stop = threading.Event()
_heartbeat_thread: threading.Thread | None = None


def _start_registry_heartbeat(hostname: str) -> None:
    """Start a daemon thread that periodically refreshes this worker's registry."""
    global _heartbeat_thread
    if _heartbeat_thread is not None and _heartbeat_thread.is_alive():
        return
    _heartbeat_stop.clear()

    def _beat() -> None:
        # Event.wait returns True on stop (shutdown), False on timeout (beat).
        while not _heartbeat_stop.wait(WORKER_HEARTBEAT_INTERVAL):
            _refresh_worker_registry(hostname)

    _heartbeat_thread = threading.Thread(
        target=_beat, name="worker-registry-heartbeat", daemon=True
    )
    _heartbeat_thread.start()
    logger.info(
        "Worker %s: registry heartbeat started (every %ss, TTL %ss)",
        hostname, WORKER_HEARTBEAT_INTERVAL, WORKER_REGISTRY_TTL,
    )


def _stop_registry_heartbeat() -> None:
    """Signal the heartbeat thread to exit (called on worker shutdown)."""
    _heartbeat_stop.set()
```

Wire it into the lifecycle signals:
- At the **end of `on_worker_ready`** (after the registration try/except):
  ```python
      # Keep the registry keys alive while the worker sits idle between tasks.
      if hostname:
          _start_registry_heartbeat(hostname)
  ```
- As the **first line of `on_worker_shutdown`**:
  ```python
      _stop_registry_heartbeat()
  ```

Reference: `gorm.ai/src/gorm_ai/tasks/celery_app.py` (search `_start_registry_heartbeat`).
Note the caveat: a worker blocked in a *single* task longer than the TTL still
can't beat — that's what the pre-existing `keep_worker_registry_alive` /
`refresh_worker_registry()` public alias in long tasks is for. Leave that as-is.

---

## 5. Part C — Backend `/workers` API (NEW)

Four new/edited backend files. Copy the two big new files from the sibling and
rename `gorm_ai`→`crypto_ai`; the edits are tiny.

### 5.1 `schemas/worker.py` (new) — copy verbatim

Reference: `gorm.ai/src/gorm_ai/schemas/worker.py`. Full content:

```python
"""Schemas for the worker-management page (system/workers)."""

from datetime import datetime

from pydantic import BaseModel


class WorkerStats(BaseModel):
    jobs_total: int = 0
    jobs_instance: int = 0  # jobs started since the current process came up
    jobs_running: int = 0
    jobs_success: int = 0
    jobs_failure: int = 0
    last_job_at: datetime | None = None
    avg_cpu_time_s: float | None = None
    avg_peak_memory_mb: float | None = None


class ManagedWorker(BaseModel):
    name: str
    status: str  # running | stopped | potential
    health: str | None = None  # docker health: healthy/unhealthy/starting/none
    models: list[str] = []
    gpu_name: str | None = None
    gpu_vram_total_mb: int | None = None
    gpu_count: int | None = None
    gpu_index: int | None = None
    uptime_s: int | None = None
    container_name: str | None = None
    service: str | None = None
    profile: str | None = None
    is_remote: bool = False
    controllable: bool = False
    stats: WorkerStats = WorkerStats()


class WorkerActionResponse(BaseModel):
    name: str
    status: str  # running | stopped | removed | error
    message: str


class WorkerPingResult(BaseModel):
    name: str
    alive: bool
    source: str | None = None  # ping | registry | container | none
```

### 5.2 `services/worker_management.py` (new) — copy + adapt 2 constants

Reference: `gorm.ai/src/gorm_ai/services/worker_management.py`. **Copy it
verbatim, rename `gorm_ai`→`crypto_ai`, then change TWO things:**

1. **`KNOWN_WORKER_SERVICES`** — set to crypto's *actual* compose worker
   services. gorm's list is `celery-worker` (default) + `celery-worker-granite` +
   `celery-worker-tabpfn`. Enumerate crypto's `docker-compose.yml`: for each
   `celery-worker*` service record `{service, default_name (its WORKER_NAME —
   crypto's default is `CRYPTO`, not `local`), profile (from `profiles:` or None),
   models (its WORKER_MODELS split on comma)}`. If crypto has only the one default
   worker, the list is just that one entry (no "potential" rows — fine).
2. **`_compose_project()` fallback** — change the final `return "gormai"` to
   `return "cryptoai"`. (It normally auto-detects the project from the backend
   container's own label; the fallback only matters if that lookup fails. Getting
   it wrong risks controlling the *other* project's workers — this is the single
   most important adaptation.)

Everything else is project-agnostic. Key mechanics to understand (so you can
verify it):
- `_worker_containers()` lists containers with label
  `com.docker.compose.project=<project>` whose service label starts with
  `celery-worker` (running **and** stopped, `all=True`).
- Identity join key = each container's `WORKER_NAME` env (that's what the
  registry and `task_records.worker_name` use). `_find_worker_container(name)`
  maps a name back to a container via that env.
- `list_workers()` merges: (1) local containers → running/stopped;
  (2) registry names with no container → **remote** workers (`is_remote`, not
  controllable); (3) known services with no container → **potential**.
- `_stats_by_worker()` = all-time `GROUP BY worker_name`. `_instance_counts()` =
  one query counting each live worker's jobs since **its own** registry
  `started_ts` (the per-instance metric). Both merged into `WorkerStats`.
- `ping()` checks inspect-ping → registry → container-running, returning the
  `source`.  `action()` runs start/stop/restart/remove via the Docker SDK in a
  thread; "remove" = stop + `remove(force=True)`.

The full file is ~415 lines — read it from the sibling rather than retyping.

### 5.3 `api/routes/workers.py` (new) — copy verbatim (rename import)

Reference: `gorm.ai/src/gorm_ai/api/routes/workers.py`. Full content:

```python
"""Worker management API routes (system/workers page).

Distinct from the task-scoped `/tasks/workers/*` endpoints (which back the
orchestration worker dropdown and the sidebar liveness check). These endpoints
return the richer running/stopped/potential view and per-worker controls.
"""

from fastapi import APIRouter, HTTPException

from crypto_ai.api.deps import WorkerManagementServiceDep
from crypto_ai.schemas.worker import (
    ManagedWorker,
    WorkerActionResponse,
    WorkerPingResult,
)

router = APIRouter()


@router.get("", response_model=list[ManagedWorker])
async def list_workers(service: WorkerManagementServiceDep) -> list[ManagedWorker]:
    """Running, stopped, and potential (defined-but-not-created) workers."""
    return await service.list_workers()


@router.get("/{name}", response_model=ManagedWorker)
async def get_worker(name: str, service: WorkerManagementServiceDep) -> ManagedWorker:
    worker = await service.get_worker(name)
    if worker is None:
        raise HTTPException(status_code=404, detail=f"Worker '{name}' not found")
    return worker


@router.get("/{name}/ping", response_model=WorkerPingResult)
async def ping_worker(name: str, service: WorkerManagementServiceDep) -> WorkerPingResult:
    return await service.ping(name)


@router.post("/{name}/start", response_model=WorkerActionResponse)
async def start_worker(name: str, service: WorkerManagementServiceDep) -> WorkerActionResponse:
    return await service.action(name, "start")


@router.post("/{name}/stop", response_model=WorkerActionResponse)
async def stop_worker(name: str, service: WorkerManagementServiceDep) -> WorkerActionResponse:
    return await service.action(name, "stop")


@router.post("/{name}/restart", response_model=WorkerActionResponse)
async def restart_worker(name: str, service: WorkerManagementServiceDep) -> WorkerActionResponse:
    return await service.action(name, "restart")


@router.delete("/{name}", response_model=WorkerActionResponse)
async def remove_worker(name: str, service: WorkerManagementServiceDep) -> WorkerActionResponse:
    """Stop and remove the worker's container (recreatable via compose)."""
    return await service.action(name, "remove")
```

### 5.4 `api/deps.py` (edit) — 3 insertions

```python
# with the other service imports:
from crypto_ai.services.worker_management import WorkerManagementService

# with the other get_*_service factories:
def get_worker_management_service(session: DbSession) -> WorkerManagementService:
    """Get worker management service."""
    return WorkerManagementService(session)

# with the other *Dep aliases:
WorkerManagementServiceDep = Annotated[
    WorkerManagementService, Depends(get_worker_management_service)
]
```

### 5.5 `api/routes/__init__.py` (edit) — 2 insertions

```python
# add `workers` to the `from crypto_ai.api.routes import ( … )` block, then:
api_router.include_router(workers.router, prefix="/workers", tags=["workers"])
```

**Do NOT touch the existing `/tasks/workers/*` routes** — the orchestration/
prediction dropdown and sidebar depend on them.

---

## 6. Part D — Frontend `system/workers` page (NEW)

crypto.ai's nav is **already wired** for `/system/workers` (confirmed:
`SYSTEM_SUBNAV_ITEMS` in `app-sidebar.tsx`, `ROUTE_TITLE_MAP` in `topbar.tsx`,
`nav.systemWorkers` in `en.json`). So you only create the page + components +
api client + i18n namespace. **No nav/topbar changes needed** (verify).

### 6.1 `lib/api.ts` (edit) — add types + `workersApi`

Append after the existing `WorkerInfo` interface. Full block (copy verbatim —
these are the API contract for the new endpoints):

```typescript
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
```

Also register `workers: workersApi` in the aggregate `export const api = { … }` if
crypto has one.

### 6.2 `components/workers/worker-ui.tsx` (new) — copy verbatim

Small shared helpers used by both the page and the pane. Reference:
`gorm.ai/frontend/src/components/workers/worker-ui.tsx`. It exports
`formatUptime(seconds)`, `WorkerStatusBadge({status,label,spin})`, and
`HealthDot({health,label})`. Copy as-is (Tailwind + `cn` only, no project
specifics).

### 6.3 `components/workers/detail-pane.tsx` (new) — copy + retarget imports

Reference: `gorm.ai/frontend/src/components/workers/detail-pane.tsx`. It's the
tabbed pane (Details / Statistics / Actions) with the animated maximize icon and
the sliding tab underline, self-fetching via `workersApi.get(name)` with 5s
polling, action mutations (start/stop/restart/ping/remove), and the type-"delete"
remove-confirm dialog. Copy verbatim; nothing project-specific except the `@/…`
imports (same aliases in crypto). Notable behaviours to preserve:
- Props `{ name, onDeleted }`; parent mounts with `key={name}` (remount per
  selection) and unmounts when the worker leaves the filtered list.
- **Tab persisted to localStorage** under `gorm:workers:activeTab` — rename the
  key to `crypto:workers:activeTab` (or your repo's storage convention). It's a
  single global preference so the tab survives navigation and switching workers.
- Statistics tab shows **Jobs (this instance)** (`st.jobs_instance`, shown only
  when `status==="running"`, else "—") and **Jobs (all-time)** (`st.jobs_total`).
- Actions tab: Ping (shows source), Start/Stop/Restart gated on
  `controllable`/status, and a remove zone (only when `controllable`).
- Depends on `@/components/animate-ui/icons/maximize` + `minimize` — confirm
  crypto has these (gorm does).

### 6.4 `app/(dashboard)/system/workers/page.tsx` (new) — copy + retarget

Reference: `gorm.ai/frontend/src/app/(dashboard)/system/workers/page.tsx`. This
is the master table, cloned from the `simulations/strategies` page pattern
(right-aligned search + a refresh button, left checkbox column with select-all/
starred dropdown, sortable columns, star column with click + right-click-row to
star, selection action bar with show-only-selected + bulk remove, and the
type-"delete" bulk-remove dialog). **It is NOT customer-scoped** (workers are
global) and **auto-refreshes every 5s** (`refetchInterval`). Copy verbatim and:
- Rename the localStorage prefix `gorm:workers:` → your convention (keep it
  consistent with the pane's tab key).
- Confirm `@/…` import paths and that `useTranslations("workersPage")` matches
  the namespace you add in 6.5.
- Columns: checkbox+dropdown │ Name │ Status (badge) │ Health │ Models │ Uptime │
  star. "Delete" = **stop & remove container** (the chosen semantics — recoverable
  via compose).

### 6.5 `messages/en.json` (edit) — add the `workersPage` namespace

Add as a top-level sibling namespace. Full block (matches every `t("…")` key used
by the page and pane):

```json
"workersPage": {
  "refresh": "Refresh",
  "searchPlaceholder": "Search workers...",
  "loading": "Loading...",
  "noWorkers": "No workers found",
  "noWorkersHint": "Start a worker to see it here",
  "selectAll": "Select All",
  "selectStarred": "Select Starred",
  "colName": "Name",
  "colStatus": "Status",
  "colHealth": "Health",
  "colModels": "Models",
  "colUptime": "Uptime",
  "status_running": "Running",
  "status_stopped": "Stopped",
  "status_potential": "Potential",
  "health_healthy": "Healthy",
  "health_unhealthy": "Unhealthy",
  "health_starting": "Starting",
  "health_none": "No check",
  "typeLocal": "Local",
  "typeRemote": "Remote",
  "typePotential": "Potential",
  "noGpu": "No GPU",
  "fieldName": "Worker name",
  "fieldType": "Type",
  "fieldGpu": "GPU",
  "fieldService": "Compose service",
  "fieldContainer": "Container",
  "tabDetails": "Details",
  "tabStatistics": "Statistics",
  "tabActions": "Actions",
  "statUptime": "Uptime",
  "statJobsInstance": "Jobs (this instance)",
  "statJobsTotal": "Jobs (all-time)",
  "statJobsRunning": "Jobs running",
  "statJobsSuccess": "Jobs succeeded",
  "statJobsFailure": "Jobs failed",
  "statLastJob": "Last job",
  "statAvgCpu": "Avg CPU time",
  "statAvgMem": "Avg peak memory",
  "actionPing": "Ping",
  "actionPingDescription": "Check whether this worker responds.",
  "pingAlive": "Alive (via {source})",
  "pingDead": "No response",
  "actionLifecycle": "Lifecycle",
  "actionLifecycleDescription": "Start, stop, or restart this worker's container.",
  "actionStart": "Start",
  "actionStop": "Stop",
  "actionRestart": "Restart",
  "remoteNotControllable": "Remote workers are not controllable from here.",
  "potentialHint": "This worker is defined but not created. Start it with: docker compose --profile {profile} up -d",
  "removeTitle": "Remove worker",
  "removeZoneDescription": "Stop and remove this worker's container. It can be recreated from compose.",
  "removeButton": "Remove",
  "removeAbsoluteTitle": "Remove worker \"{name}\"",
  "removeAbsoluteDescription": "This stops and removes the worker's container. It can be recreated from compose, but any in-flight work is lost.",
  "removeUnderstand": "I understand this stops and removes the worker container.",
  "removeSelected": "Remove selected",
  "showAll": "Show all",
  "showOnlySelected": "Show only selected",
  "showing": "Showing {from}–{to} of {total} workers",
  "selectedCount": "Selected {selected} of {total} workers",
  "bulkRemoveTitle": "Remove {count} workers",
  "bulkRemoveDescription": "You are about to stop and remove {count} worker containers. They can be recreated from compose.",
  "bulkRemoveUnderstand": "I understand that this stops and removes the selected worker containers.",
  "bulkRemoveConfirm": "Remove {count} workers",
  "deleteTypeToConfirm": "Type \"delete\" to confirm",
  "deleteTypePlaceholder": "delete",
  "cancel": "Cancel",
  "toastRemoved": "Worker removed",
  "toastRemoveError": "Failed to remove worker"
}
```

The type-"delete" confirm compares the typed text against
`t("deleteTypePlaceholder")`, so it is localised — if crypto ships other locales,
translate that word consistently.

---

## 7. Part E — Per-worker ping (NEW)

Already included above: `GET /workers/{name}/ping` (§5.3) → `WorkerManagementService.ping()`
(§5.2) → the Ping button in the Actions tab (§6.3). It reports alive + a `source`
(`ping` = answered inspect, `registry` = has a live registry key even if busy on
`--pool=solo`, `container` = container running). Keep this **separate** from the
pre-existing global `GET /tasks/workers/ping` (which returns a single `{alive}`
for the whole fleet and drives the sidebar "workers gone?" flow) — don't merge.

---

## 8. Part F — Health-check fix (NEW) — `docker-compose.yml`

**Symptom:** profile/GPU worker containers show `unhealthy` forever despite
running fine. **Cause:** the image's `HEALTHCHECK` (in the Dockerfile) is an HTTP
check like `urlopen('http://localhost:8000/health')`, meant for the **API
server**. A Celery worker serves no HTTP → `Connection refused` every interval →
`unhealthy`. The default `celery-worker` service overrides it in compose; any
worker service that *doesn't* override inherits the broken check.

**Diagnose in crypto** (don't assume — crypto's setup differs):
```bash
grep -n HEALTHCHECK Dockerfile                    # is there an HTTP check in the image?
docker inspect <crypto-worker-container> --format '{{json .Config.Healthcheck}}'
docker inspect <crypto-worker-container> --format '{{.State.Health.Status}}'
```
If a worker inherits the HTTP check, add a worker-appropriate `healthcheck:` to
that service in `docker-compose.yml` (mirror the default worker's). gorm's block —
**adapt the Redis broker DB number to crypto's `CELERY_BROKER_URL`** (gorm uses
`redis://redis:6379/1`; crypto also uses `/1` per its compose, but confirm):

```yaml
    # Override the image's HTTP HEALTHCHECK (meant for the API server) with a
    # worker-appropriate check: Redis reachable + the worker process (PID 1)
    # alive. Without this the worker inherits the /health check against
    # localhost:8000 — which no worker serves — and is perpetually "unhealthy".
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import redis; r=redis.from_url('redis://redis:6379/1'); assert r.ping()\" && kill -0 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
```

**Applying it requires recreating the container** (a plain restart re-uses the
old healthcheck config):
```bash
docker compose [--profile <p>] up -d <worker-service>
```
It flips to `healthy` ~30s after boot. If crypto has only the single default
worker and it already overrides the healthcheck, this part may be a no-op —
verify and move on.

---

## 9. Adaptation checklist (gorm → crypto)

| Item | gorm.ai | crypto.ai — set to |
|---|---|---|
| Python package | `gorm_ai` | `crypto_ai` (rename all imports) |
| `_compose_project()` fallback | `"gormai"` | `"cryptoai"` ⚠️ critical |
| `KNOWN_WORKER_SERVICES` | celery-worker/granite/tabpfn | crypto's actual worker services + their `WORKER_MODELS`/profiles |
| Default worker `WORKER_NAME` | `local`/`GORM` | `CRYPTO` (crypto's compose default) |
| `MODEL_WORKER_ENGINES` (celery_app) | timesfm/chronos/… | crypto's model engines |
| Healthcheck broker DB | `/1` | match crypto `CELERY_BROKER_URL` (`/1`) |
| localStorage prefix | `gorm:workers:` | your convention (page + pane tab key) |
| Nav/topbar wiring | added | already present in crypto — verify only |
| Docker socket on app | mounted | already mounted in crypto — verify only |

Grep to confirm crypto already has the heartbeat or needs it:
`grep -n _start_registry_heartbeat src/crypto_ai/tasks/celery_app.py` (if absent → do Part B).

---

## 10. Verification (do these after porting)

Backend (from inside crypto's app container, so it has the socket + DB):
```bash
# import + routes
uv run python -c "from crypto_ai.api.routes import api_router; \
print([r.path for r in api_router.routes if '/workers' in getattr(r,'path','')])"
# live data (through the running app container)
docker exec <cryptoai-app-container> python -c "import urllib.request,json; \
[print(w['name'], w['status'], w['health'], w['stats']['jobs_total'], w['stats']['jobs_instance']) \
for w in json.load(urllib.request.urlopen('http://localhost:8000/api/v1/workers'))]"
# per-worker ping + 404
# GET /api/v1/workers/<name>/ping  and  GET /api/v1/workers/<bogus>  → 404
```
Expect: each running worker listed with correct health (post §8 fix), all-time
`jobs_total` spanning history, `jobs_instance` = 0 right after a restart (rising
as it processes jobs). `ruff check` the new files.

Frontend:
```bash
cd frontend && npx tsc --noEmit && node -e "JSON.parse(require('fs').readFileSync('src/messages/en.json','utf8'))"
```
Then open `/system/workers` (behind auth): table lists workers, row-click opens
the pane, tabs persist across navigation, Ping works, and Start/Stop/Restart/
Remove act on the container.

---

## 11. Things deliberately NOT changed (don't "fix" them)

- The old global `POST /tasks/workers/restart` stays **default-worker-only** — I
  chose not to widen its blast radius to bounce GPU/profile workers on a generic
  "restart". The new page gives correct per-worker control instead.
- "Delete" semantics = **stop & remove container** (not just stop). It's the
  irreversible action the type-"delete" confirm is designed for; recoverable via
  compose. If crypto's product prefers "stop only", soften both the action
  (`action(name,"stop")`) and the dialog.
- Start scope = **existing containers only**. A never-created profile worker shows
  as "potential" and its Start returns a message telling you to
  `docker compose --profile <p> up -d`. (Full "create from profile" was left out
  as it can trigger long image builds and needs the compose CLI in the backend.)

---

### File inventory (all under `gorm.ai/` — copy from these)

New:
- `src/gorm_ai/schemas/worker.py`
- `src/gorm_ai/services/worker_management.py`
- `src/gorm_ai/api/routes/workers.py`
- `frontend/src/components/workers/worker-ui.tsx`
- `frontend/src/components/workers/detail-pane.tsx`
- `frontend/src/app/(dashboard)/system/workers/page.tsx`

Edited:
- `src/gorm_ai/tasks/celery_app.py` (heartbeat: Part B)
- `src/gorm_ai/api/deps.py` (service dep)
- `src/gorm_ai/api/routes/__init__.py` (mount `/workers`)
- `frontend/src/lib/api.ts` (`workersApi` + types)
- `frontend/src/messages/en.json` (`workersPage` namespace)
- `docker-compose.yml` (worker healthcheck override: Part F)
```
