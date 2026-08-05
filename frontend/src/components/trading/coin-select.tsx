"use client"

// Searchable coin picker for the trading scope. A dropdown (Popover) with a
// search box that filters on both ticker and name, laid out in four columns:
// column 1 = favorites, columns 2-3 = all other coins sorted by name, column 4
// = coin groups. Selecting a group (instead of a single coin) drives the scope
// off a representative member and makes "Save as New" fan out one template per
// member. Each column shows at most 10 rows; a footer notes how many more hide.

import { useMemo, useState } from "react"
import { Search, Check, Heart, ChevronsUpDown, Layers } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { CoinResponse, CoinGroup } from "@/lib/api"

const PER_COL = 10
const OTHER_COLS = 2

export function CoinSelect({
  coins,
  favoriteIds,
  value,
  onChange,
  disabled,
  groups = [],
  selectedGroupId = null,
  onSelectGroup,
}: {
  coins: CoinResponse[]
  favoriteIds: Set<string>
  value: string | null
  onChange: (coinId: string) => void
  disabled?: boolean
  groups?: CoinGroup[]
  selectedGroupId?: string | null
  onSelectGroup?: (groupId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selected = coins.find((c) => c.id === value)
  const selectedGroup = groups.find((g) => g.id === selectedGroupId)

  const { favs, otherCols, favMore, otherMore, groupList, groupMore } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (c: CoinResponse) =>
      !q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    const byName = (a: CoinResponse, b: CoinResponse) => a.name.localeCompare(b.name)
    const favAll = coins.filter((c) => favoriteIds.has(c.id) && match(c)).sort(byName)
    const otherAll = coins.filter((c) => !favoriteIds.has(c.id) && match(c)).sort(byName)
    const favs = favAll.slice(0, PER_COL)
    const others = otherAll.slice(0, PER_COL * OTHER_COLS)
    const otherCols = Array.from({ length: OTHER_COLS }, (_, i) =>
      others.slice(i * PER_COL, (i + 1) * PER_COL),
    )
    const groupAll = groups
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
    const groupList = groupAll.slice(0, PER_COL)
    return {
      favs,
      otherCols,
      favMore: favAll.length - favs.length,
      otherMore: otherAll.length - others.length,
      groupList,
      groupMore: groupAll.length - groupList.length,
    }
  }, [coins, favoriteIds, query, groups])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery("")
  }
  const pickGroup = (id: string) => {
    onSelectGroup?.(id)
    setOpen(false)
    setQuery("")
  }

  const empty = favs.length === 0 && otherCols.every((c) => c.length === 0) && groupList.length === 0

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery("") }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="h-9 w-full px-3 rounded-md border border-input bg-background text-sm flex items-center justify-between gap-2 disabled:opacity-50 cursor-pointer"
        >
          <span className={cn("flex items-center gap-1.5 truncate", !selected && !selectedGroup && "text-muted-foreground")}>
            {selectedGroup
              ? <><Layers className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{selectedGroup.name}</span></>
              : selected ? selected.symbol : "Select…"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-[min(92vw,54rem)]">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coins / groups by name or ticker…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {empty ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No coins found</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-0.5 p-2 max-h-[60vh] overflow-y-auto">
            {/* Column 1 — favorites */}
            <div className="flex flex-col min-w-0">
              <ColHeader label="Favorites" heart />
              {favs.length === 0 ? (
                <span className="px-2 py-1 text-xs text-muted-foreground">None</span>
              ) : (
                favs.map((c) => (
                  <CoinRow key={c.id} coin={c} favorite selected={c.id === value && !selectedGroup} onSelect={() => pick(c.id)} />
                ))
              )}
              {favMore > 0 && <MoreHint n={favMore} />}
            </div>
            {/* Columns 2–3 — all other coins */}
            {otherCols.map((col, i) => (
              <div key={i} className="flex flex-col min-w-0">
                <ColHeader label={i === 0 ? "All coins" : ""} />
                {col.map((c) => (
                  <CoinRow key={c.id} coin={c} selected={c.id === value && !selectedGroup} onSelect={() => pick(c.id)} />
                ))}
                {i === OTHER_COLS - 1 && otherMore > 0 && <MoreHint n={otherMore} />}
              </div>
            ))}
            {/* Column 4 — coin groups */}
            <div className="flex flex-col min-w-0">
              <ColHeader label="Groups" layers />
              {groupList.length === 0 ? (
                <span className="px-2 py-1 text-xs text-muted-foreground">None</span>
              ) : (
                groupList.map((g) => (
                  <GroupRow key={g.id} group={g} selected={g.id === selectedGroupId} onSelect={() => pickGroup(g.id)} />
                ))
              )}
              {groupMore > 0 && <MoreHint n={groupMore} />}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ColHeader({ label, heart, layers }: { label: string; heart?: boolean; layers?: boolean }) {
  return (
    <div className="flex items-center gap-1 h-6 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {heart && <Heart className="h-3 w-3 fill-red-500 text-red-500" />}
      {layers && <Layers className="h-3 w-3" />}
      {label || " "}
    </div>
  )
}

function CoinRow({
  coin, selected, favorite, onSelect,
}: { coin: CoinResponse; selected: boolean; favorite?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${coin.symbol} · ${coin.name}`}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm cursor-pointer transition-colors min-w-0",
        selected ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "hover:bg-[var(--muted)]/60",
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      <span className="font-mono font-medium shrink-0">{coin.symbol}</span>
      <span className="text-xs text-muted-foreground truncate">{coin.name}</span>
      {favorite && <Heart className="h-3 w-3 fill-red-500 text-red-500 ml-auto shrink-0" />}
    </button>
  )
}

function GroupRow({
  group, selected, onSelect,
}: { group: CoinGroup; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${group.name} · ${group.member_coin_ids.length} coins`}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm cursor-pointer transition-colors min-w-0",
        selected ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "hover:bg-[var(--muted)]/60",
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{group.name}</span>
      <span className="text-xs text-muted-foreground ml-auto shrink-0 tabular-nums">{group.member_coin_ids.length}</span>
    </button>
  )
}

function MoreHint({ n }: { n: number }) {
  return (
    <span className="px-2 py-1 text-[11px] text-muted-foreground italic">
      +{n} more — refine search
    </span>
  )
}
