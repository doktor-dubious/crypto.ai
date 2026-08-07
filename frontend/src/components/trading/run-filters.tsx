"use client"

// Active-view run filtering, shared by the Paper Trade and Live Trading pages.
//
// Both pages show the same three multi-select exclusion filters (coin groups /
// coins / strategies) over their running runs, persist the UNCHECKED keys so
// new runs appear by default, and surface an amber "hidden by filters" banner
// because a persisted filter silently swallowing later runs looks like data
// loss. The logic lived copy-pasted on each page and had already drifted; it
// lives here once now — the pages keep only what genuinely differs (the paper
// page's tick-guard filter rides in as `children` of the bar).

import {
  useCallback, useEffect, useMemo, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from "react"
import { ChevronDown, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { strategyLabel } from "@/components/trading/strategy-meta"
import type { CoinGroup, PaperTradeRun } from "@/lib/api"

function loadJson<T>(prefix: string, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(`${prefix}${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
function saveJson(prefix: string, key: string, value: unknown) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(`${prefix}${key}`, JSON.stringify(value)) } catch { /* ignore */ }
}

export interface RunFilterOption { key: string; label: string }

/**
 * The three exclusion filters over a page's active runs. Excluded keys persist
 * under `${storagePrefix}exclGroups|exclCoins|exclStrategies` — the same keys
 * the pages used before this hook existed, so saved selections carry over.
 */
export function useRunFilters({
  runs, coinGroups, coinById, storagePrefix, ungroupedLabel,
}: {
  runs: PaperTradeRun[]
  coinGroups: CoinGroup[]
  coinById: Map<string, { symbol: string }>
  storagePrefix: string
  ungroupedLabel: string
}) {
  const [exclGroups, setExclGroups] = useState<Set<string>>(() => new Set(loadJson<string[]>(storagePrefix, "exclGroups", [])))
  const [exclCoins, setExclCoins] = useState<Set<string>>(() => new Set(loadJson<string[]>(storagePrefix, "exclCoins", [])))
  const [exclStrategies, setExclStrategies] = useState<Set<string>>(() => new Set(loadJson<string[]>(storagePrefix, "exclStrategies", [])))
  useEffect(() => { saveJson(storagePrefix, "exclGroups", [...exclGroups]) }, [storagePrefix, exclGroups])
  useEffect(() => { saveJson(storagePrefix, "exclCoins", [...exclCoins]) }, [storagePrefix, exclCoins])
  useEffect(() => { saveJson(storagePrefix, "exclStrategies", [...exclStrategies]) }, [storagePrefix, exclStrategies])

  // EVERY group a coin belongs to, not just one. Coins are routinely in several
  // (SOXLB is in four), and attributing each to only its alphabetically-first
  // group made the other three invisible to this filter: they never appeared as
  // options, and unchecking one of them did nothing.
  const coinToGroups = useMemo(() => {
    const sorted = [...coinGroups].sort((a, b) => a.name.localeCompare(b.name))
    const m = new Map<string, { id: string; name: string }[]>()
    for (const g of sorted) {
      for (const cid of g.member_coin_ids) {
        const list = m.get(cid)
        if (list) list.push({ id: g.id, name: g.name })
        else m.set(cid, [{ id: g.id, name: g.name }])
      }
    }
    return m
  }, [coinGroups])
  const groupsOfRun = useCallback(
    (r: PaperTradeRun) =>
      (r.scope?.coin_id ? coinToGroups.get(r.scope.coin_id) : undefined) ?? [],
    [coinToGroups],
  )

  // Filter options — only the coin groups / coins / strategies that currently
  // have running trades, sorted by label.
  const options = useMemo(() => {
    const groups = new Map<string, string>()
    const coins = new Map<string, string>()
    const strategies = new Map<string, string>()
    for (const r of runs) {
      const gs = groupsOfRun(r)
      if (gs.length) for (const g of gs) groups.set(g.id, g.name)
      else groups.set("ungrouped", ungroupedLabel)
      const cid = r.scope?.coin_id ?? "none"
      coins.set(cid, (r.scope?.coin_id ? coinById.get(r.scope.coin_id)?.symbol : null) ?? "—")
      strategies.set(r.strategy, strategyLabel(r.strategy))
    }
    const toSorted = (m: Map<string, string>): RunFilterOption[] =>
      [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label))
    return { groups: toSorted(groups), coins: toSorted(coins), strategies: toSorted(strategies) }
  }, [runs, coinById, groupsOfRun, ungroupedLabel])

  // Runs left after the three exclusion filters. Unchecking a group hides
  // everything in it, whatever else those coins also belong to: "exclude this
  // group" has to mean the group, not the subset of it that happens to sort
  // here first.
  const filtered = useMemo(
    () => runs.filter((r) => {
      const gs = groupsOfRun(r)
      const groupOk = gs.length
        ? gs.every((g) => !exclGroups.has(g.id))
        : !exclGroups.has("ungrouped")
      return groupOk
        && !exclCoins.has(r.scope?.coin_id ?? "none")
        && !exclStrategies.has(r.strategy)
    }),
    [runs, groupsOfRun, exclGroups, exclCoins, exclStrategies],
  )
  const hiddenCount = runs.length - filtered.length

  // Toggle one key in an exclusion set; check/uncheck every option in a dimension.
  const toggleExcl = (setter: Dispatch<SetStateAction<Set<string>>>) => (key: string) =>
    setter((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const setAllExcl = (setter: Dispatch<SetStateAction<Set<string>>>, opts: { key: string }[]) => (check: boolean) =>
    setter((prev) => { const n = new Set(prev); opts.forEach((o) => (check ? n.delete(o.key) : n.add(o.key))); return n })
  const clearAll = () => { setExclGroups(new Set()); setExclCoins(new Set()); setExclStrategies(new Set()) }

  return {
    options,
    filtered,
    hiddenCount,
    excluded: { groups: exclGroups, coins: exclCoins, strategies: exclStrategies },
    toggle: {
      groups: toggleExcl(setExclGroups),
      coins: toggleExcl(setExclCoins),
      strategies: toggleExcl(setExclStrategies),
    },
    setAll: {
      groups: setAllExcl(setExclGroups, options.groups),
      coins: setAllExcl(setExclCoins, options.coins),
      strategies: setAllExcl(setExclStrategies, options.strategies),
    },
    clearAll,
  }
}

export type RunFilters = ReturnType<typeof useRunFilters>

// A multi-select dropdown over one filter dimension. All options start checked;
// unchecking removes that key from the display. Shows a "checked/total" count.
export function FilterDropdown({
  label, options, excluded, onToggle, onAll, allLabel, noneLabel,
}: {
  label: string
  options: RunFilterOption[]
  excluded: Set<string>
  onToggle: (key: string) => void
  onAll: (check: boolean) => void
  allLabel: string
  noneLabel: string
}) {
  const selected = options.filter((o) => !excluded.has(o.key)).length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 cursor-pointer" disabled={options.length === 0}>
          <span>{label}</span>
          <span className="text-[var(--muted-foreground)] tabular-nums">{selected}/{options.length}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1 text-xs">
          <button className="text-primary hover:underline cursor-pointer" onClick={() => onAll(true)}>{allLabel}</button>
          <button className="text-[var(--muted-foreground)] hover:underline cursor-pointer" onClick={() => onAll(false)}>{noneLabel}</button>
        </div>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.key}
            checked={!excluded.has(o.key)}
            onCheckedChange={() => onToggle(o.key)}
            onSelect={(e) => e.preventDefault()}
            className="cursor-pointer"
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface RunFilterBarLabels {
  hiddenByFilters: (n: number) => string
  showAll: string
  filterBy: string
  groups: string
  coins: string
  strategies: string
  all: string
  none: string
}

/**
 * The filter toolbar: "hidden by filters / Show all" banner (when anything is
 * hidden), the three dropdowns, plus whatever page-specific controls ride in
 * as `children` (the paper page appends its tick-guard toggle).
 */
export function RunFilterBar({
  filters, labels, children,
}: {
  filters: RunFilters
  labels: RunFilterBarLabels
  children?: ReactNode
}) {
  const { options, hiddenCount, excluded, toggle, setAll, clearAll } = filters
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {/* A filter that persists across sessions must say so. Without this,
          runs started later simply never appear and the page looks like it
          lost them. */}
      {hiddenCount > 0 && (
        <button
          onClick={clearAll}
          className="mr-auto flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 cursor-pointer"
        >
          <EyeOff className="h-3.5 w-3.5 shrink-0" />
          {labels.hiddenByFilters(hiddenCount)}
          <span className="underline underline-offset-2">{labels.showAll}</span>
        </button>
      )}
      <span className="text-xs text-[var(--muted-foreground)] shrink-0">{labels.filterBy}</span>
      <FilterDropdown
        label={labels.groups} options={options.groups} excluded={excluded.groups}
        onToggle={toggle.groups} onAll={setAll.groups}
        allLabel={labels.all} noneLabel={labels.none}
      />
      <FilterDropdown
        label={labels.coins} options={options.coins} excluded={excluded.coins}
        onToggle={toggle.coins} onAll={setAll.coins}
        allLabel={labels.all} noneLabel={labels.none}
      />
      <FilterDropdown
        label={labels.strategies} options={options.strategies} excluded={excluded.strategies}
        onToggle={toggle.strategies} onAll={setAll.strategies}
        allLabel={labels.all} noneLabel={labels.none}
      />
      {children}
    </div>
  )
}
