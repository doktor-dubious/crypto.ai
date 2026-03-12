"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import {
  format,
  isToday,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  getISOWeek,
  parseISO,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PadInfo {
  id: string
  name: string
  dates: string[] // YYYY-MM-DD
}

export interface StrategyAssignment {
  id: string
  dates: string[] // YYYY-MM-DD[]
  strategyId: string
  strategyName: string
  colorIdx: number
}

// ─── Colors ───────────────────────────────────────────────────────────────────

export const ASSIGNMENT_COLORS = [
  { bar: "#10b981", cell: "bg-emerald-500/10" },
  { bar: "#3b82f6", cell: "bg-blue-500/10" },
  { bar: "#8b5cf6", cell: "bg-violet-500/10" },
  { bar: "#f59e0b", cell: "bg-amber-500/10" },
  { bar: "#f43f5e", cell: "bg-rose-500/10" },
  { bar: "#06b6d4", cell: "bg-cyan-500/10" },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

function getCalendarWeeks(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const start = startOfWeek(firstDay, { weekStartsOn: 1 })
  const end = endOfWeek(lastDay, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start, end })
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

function getDateRange(from: string, to: string): string[] {
  const a = from <= to ? from : to
  const b = from <= to ? to : from
  return eachDayOfInterval({ start: parseISO(a), end: parseISO(b) }).map(toDateStr)
}

interface BarItem {
  startCol: number
  endCol: number
  row: number
  name: string
  colorIdx: number
}

function computeWeekBars(week: Date[], assignments: StrategyAssignment[]): BarItem[] {
  const bars: Omit<BarItem, "row">[] = []

  for (const assignment of assignments) {
    const assignedSet = new Set(assignment.dates)
    let runStart: number | null = null
    for (let col = 0; col <= 7; col++) {
      const inRun = col < 7 && assignedSet.has(toDateStr(week[col]))
      if (inRun && runStart === null) {
        runStart = col
      } else if (!inRun && runStart !== null) {
        bars.push({ startCol: runStart, endCol: col - 1, name: assignment.strategyName, colorIdx: assignment.colorIdx })
        runStart = null
      }
    }
  }

  // Greedy stack-level assignment
  const rowEnds: number[] = []
  return bars.map((bar) => {
    let row = rowEnds.findIndex((end) => end < bar.startCol)
    if (row === -1) { row = rowEnds.length; rowEnds.push(-1) }
    rowEnds[row] = bar.endCol
    return { ...bar, row }
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PredictionCalendarProps {
  pads: PadInfo[]
  assignments: StrategyAssignment[]
  selectedDates: Set<string>
  onSelectedDatesChange: (dates: Set<string>) => void
  onPadChipClick?: (padId: string, padName: string, date: string) => void
  onBarClick?: (assignmentId: string, assignmentName: string) => void
}

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function PredictionCalendar({
  pads,
  assignments,
  selectedDates,
  onSelectedDatesChange,
  onPadChipClick,
  onBarClick,
}: PredictionCalendarProps) {
  const today = new Date()
  const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1)
  const [currentYear, setCurrentYear] = useState(today.getFullYear())
  const [lastClicked, setLastClicked] = useState<string | null>(null)

  // Use refs for drag state so event handlers always read the current value
  // synchronously — avoids the stale-closure bug where click fires after
  // React re-renders from mousedown and sees non-null dragRef as "dragging".
  const dragRef = useRef<{ start: string; current: string } | null>(null)
  const didDragRef = useRef(false) // true only when mouse moved to a different date
  const [dragPreviewDates, setDragPreviewDates] = useState<Set<string>>(new Set())

  // PAD date → pad names lookup
  const padDateMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const pad of pads) {
      for (const d of pad.dates) {
        const existing = map.get(d) ?? []
        existing.push(pad.name)
        map.set(d, existing)
      }
    }
    return map
  }, [pads])

  const weeks = useMemo(
    () => getCalendarWeeks(currentYear, currentMonth),
    [currentYear, currentMonth]
  )

  // Assignment date → colorIdx lookup for cell tinting
  const assignmentDateMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of assignments) {
      for (const d of a.dates) map.set(d, a.colorIdx)
    }
    return map
  }, [assignments])

  // End drag on global mouseup
  useEffect(() => {
    function handleMouseUp() {
      if (dragRef.current && didDragRef.current) {
        const range = getDateRange(dragRef.current.start, dragRef.current.current)
        onSelectedDatesChange(new Set([...selectedDates, ...range]))
        setLastClicked(dragRef.current.current)
      }
      dragRef.current = null
      setDragPreviewDates(new Set())
      // leave didDragRef.current for the click handler to read, it clears it
    }
    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [selectedDates, onSelectedDatesChange])

  function handleDayClick(dateStr: string, e: React.MouseEvent) {
    // If mouse moved during drag, skip the click
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    e.preventDefault()
    if (e.shiftKey && lastClicked) {
      const range = getDateRange(lastClicked, dateStr)
      onSelectedDatesChange(new Set([...selectedDates, ...range]))
      setLastClicked(dateStr)
    } else {
      const next = new Set(selectedDates)
      if (next.has(dateStr)) next.delete(dateStr)
      else next.add(dateStr)
      onSelectedDatesChange(next)
      setLastClicked(dateStr)
    }
  }

  function handleDayMouseDown(dateStr: string, e: React.MouseEvent) {
    if (e.shiftKey) return
    e.preventDefault()
    dragRef.current = { start: dateStr, current: dateStr }
    didDragRef.current = false
    setDragPreviewDates(new Set([dateStr]))
  }

  function handleDayMouseEnter(dateStr: string) {
    if (dragRef.current) {
      dragRef.current = { ...dragRef.current, current: dateStr }
      if (dateStr !== dragRef.current.start) didDragRef.current = true
      setDragPreviewDates(new Set(getDateRange(dragRef.current.start, dateStr)))
    }
  }

  function prevMonth() {
    if (currentMonth === 1) { setCurrentMonth(12); setCurrentYear((y) => y - 1) }
    else setCurrentMonth((m) => m - 1)
  }

  function nextMonth() {
    if (currentMonth === 12) { setCurrentMonth(1); setCurrentYear((y) => y + 1) }
    else setCurrentMonth((m) => m + 1)
  }

  const monthLabel = new Date(currentYear, currentMonth - 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  })

  return (
    <div
      className="flex flex-col h-full select-none overflow-hidden"
      onMouseLeave={() => { dragRef.current = null; setDragPreviewDates(new Set()) }}
    >
      {/* Month nav */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-semibold text-sm">{monthLabel}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day headers */}
      <div
        className="grid border-b shrink-0"
        style={{ gridTemplateColumns: "2.5rem repeat(7, 1fr)" }}
      >
        <div className="text-center text-[10px] text-muted-foreground py-1.5 border-r font-medium">
          Wk
        </div>
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] text-muted-foreground py-1.5 font-semibold border-r last:border-r-0 uppercase tracking-wide"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar weeks */}
      <div className="flex-1 overflow-y-auto">
        {weeks.map((week, weekIdx) => {
          const weekBars = computeWeekBars(week, assignments)
          const numBarRows = weekBars.length > 0 ? Math.max(...weekBars.map((b) => b.row)) + 1 : 0

          return (
            <div key={weekIdx} className="border-b last:border-b-0">
              {/* Day cells */}
              <div
                className="grid"
                style={{ gridTemplateColumns: "2.5rem repeat(7, 1fr)" }}
              >
                {/* Week number */}
                <div className="flex items-start justify-center pt-1.5 border-r">
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {getISOWeek(week[0])}
                  </span>
                </div>

                {/* Day cells */}
                {week.map((day, colIdx) => {
                  const dateStr = toDateStr(day)
                  const isCurrentMonth = day.getMonth() === currentMonth - 1
                  const isTodayDate = isToday(day)
                  const isSelected = selectedDates.has(dateStr)
                  const isDragPreview = dragPreviewDates.has(dateStr)
                  const padNames = padDateMap.get(dateStr) ?? []
                  const assignedColorIdx = assignmentDateMap.get(dateStr)

                  return (
                    <div
                      key={colIdx}
                      onMouseDown={(e) => handleDayMouseDown(dateStr, e)}
                      onMouseEnter={() => handleDayMouseEnter(dateStr)}
                      onClick={(e) => handleDayClick(dateStr, e)}
                      className={cn(
                        "relative min-h-[72px] p-1.5 border-r last:border-r-0 cursor-pointer transition-colors",
                        !isCurrentMonth && "opacity-35",
                        isTodayDate && !isSelected && "ring-1 ring-inset ring-primary/60",
                        !isSelected && !isDragPreview && "hover:bg-muted/40",
                        assignedColorIdx !== undefined &&
                          ASSIGNMENT_COLORS[assignedColorIdx % ASSIGNMENT_COLORS.length].cell,
                      )}
                      style={
                        isSelected || isDragPreview
                          ? { backgroundColor: "#335c8c", outline: "1px solid #335c8c99", outlineOffset: "-1px" }
                          : undefined
                      }
                    >
                      {/* Date number */}
                      <span
                        className={cn(
                          "block text-right text-xs leading-none",
                          isSelected
                            ? "font-bold"
                            : isTodayDate
                            ? "font-bold text-primary"
                            : isCurrentMonth
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                        style={isSelected || isDragPreview ? { color: "#fff" } : undefined}
                      >
                        {day.getDate()}
                      </span>

                      {/* PAD chips */}
                      {padNames.length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {padNames.map((name) => {
                            const pad = pads.find((p) => p.name === name)
                            return (
                              <Badge
                                key={name}
                                onClick={
                                  onPadChipClick && pad
                                    ? (e) => {
                                        e.stopPropagation()
                                        onPadChipClick(pad.id, pad.name, dateStr)
                                      }
                                    : undefined
                                }
                                className={cn(
                                  "text-[9px] px-1 py-0 h-4 rounded-sm border-transparent text-white truncate max-w-full justify-start",
                                  onPadChipClick && "cursor-pointer hover:brightness-110"
                                )}
                                style={{ backgroundColor: "#25693e" }}
                              >
                                {name}
                              </Badge>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Strategy bars row */}
              {numBarRows > 0 && (
                <div
                  className="border-r-0"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `2.5rem repeat(7, 1fr)`,
                    gridTemplateRows: `repeat(${numBarRows}, 20px)`,
                    height: `${numBarRows * 20}px`,
                  }}
                >
                  {/* Week number spacer */}
                  <div
                    className="border-r"
                    style={{ gridColumn: 1, gridRow: `1 / ${numBarRows + 1}` }}
                  />

                  {/* Bars */}
                  {weekBars.map((bar, i) => {
                    const assignment = assignments.find((a) => a.strategyName === bar.name)
                    return (
                      <div
                        key={i}
                        onClick={
                          onBarClick && assignment
                            ? (e) => {
                                e.stopPropagation()
                                onBarClick(assignment.id, assignment.strategyName)
                              }
                            : undefined
                        }
                        className={cn(
                          "flex items-center px-2 text-[10px] font-semibold text-white mx-0.5 my-0.5 rounded-sm overflow-hidden",
                          onBarClick && "cursor-pointer hover:brightness-110"
                        )}
                        style={{
                          gridColumn: `${bar.startCol + 2} / ${bar.endCol + 3}`,
                          gridRow: bar.row + 1,
                          backgroundColor: ASSIGNMENT_COLORS[bar.colorIdx % ASSIGNMENT_COLORS.length].bar,
                        }}
                      >
                        {bar.name}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
