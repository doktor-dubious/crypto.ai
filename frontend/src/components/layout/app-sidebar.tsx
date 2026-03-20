"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  CreditCard,
  Home,
  LineChart,
  List,
  LogOut,
  Plus,
  Settings,
  ShoppingCart,
  Sliders,
  Upload,
  Users,
  CalendarDays,
  FolderOpen,
  Activity,
  Sparkles,
  Cpu,
  Filter,
  DollarSign,
  CalendarClock,
  RefreshCw,
  BookMarked,
  TrendingUp,
  PieChart,
  Store,
  Coins,
  PackageX,
  Import,
  Download,
  FileSpreadsheet,
  ScrollText,
  Brain,
  Server,
  Container,
} from "lucide-react"
import { signOut, useSession } from "@/lib/auth-client"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { createPortal } from "react-dom"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { SidebarTasks } from "@/components/layout/sidebar-tasks"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { useCustomer } from "@/components/providers/customer-provider"
import { BlocksIcon, type BlocksIconHandle } from "@/components/animate-ui/icons/blocks"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

const NAV_ITEMS = [
  { href: "/", icon: Home, labelKey: "home" },
  { href: "/customers", icon: Users, labelKey: "customers" },
  { href: "/sales", icon: CreditCard, labelKey: "sales" },
] as const

const OUTLET_SUBNAV_ITEMS = [
  { href: "/outlets", icon: List, labelKey: "outletsList" },
  { href: "/outlets/analytics", icon: LineChart, labelKey: "outletsAnalytics" },
  { href: "/outlet-groups", icon: FolderOpen, labelKey: "outletGroups" },
  { href: "/outlets/bulk-update", icon: Upload, labelKey: "outletsBulkUpdate" },
] as const

const PREDICTION_SUBNAV_TOP = [
  { href: "/predictions/new", icon: Plus, labelKey: "predictionsNew" },
  { href: "/predictions/strategies", icon: Sparkles, labelKey: "predictionsStrategies" },
  { href: "/predictions/completed", icon: CheckCircle, labelKey: "predictionsCompleted" },
] as const

const PREDICTION_SUBNAV_MID = [
  { href: "/predictions/analytics", icon: TrendingUp, labelKey: "predictionsAnalytics" },
] as const

const PREDICTION_SUBNAV_BOT = [
  { href: "/prediction-adjustments", icon: Sliders, labelKey: "predictionsAdjustments" },
  { href: "/predictions/configuration", icon: Cpu, labelKey: "predictionsConfiguration" },
] as const

const SIMULATION_SUBNAV_ITEMS = [
  { href: "/simulations/new", icon: Plus, labelKey: "simulationsNew" },
  { href: "/simulations/strategies", icon: Sparkles, labelKey: "simulationsStrategies" },
  { href: "/simulations/completed", icon: CheckCircle, labelKey: "simulationsCompleted" },
] as const

const PADS_SUBNAV_ITEMS = [
  { href: "/pads", icon: Filter, labelKey: "padsFilters" },
  { href: "/pads/predefined", icon: BookMarked, labelKey: "predefinedPads" },
] as const

const FINANCIALS_SUBNAV_ITEMS = [
  { href: "/financials/date-override", icon: CalendarClock, labelKey: "financialsDateOverride" },
  { href: "/financials/bulk-update", icon: RefreshCw, labelKey: "financialsBulkUpdate" },
] as const

const STATISTICS_SUBNAV_ITEMS = [
  { href: "/statistics/sales", icon: CreditCard, labelKey: "statisticsSales" },
  { href: "/statistics/sold-out", icon: PackageX, labelKey: "statisticsSoldOut" },
  { href: "/statistics/outlets", icon: Store, labelKey: "statisticsOutlets" },
  { href: "/statistics/profit", icon: Coins, labelKey: "statisticsProfit" },
] as const

const IMPORT_SUBNAV_ITEMS = [
  { href: "/import/templates", icon: FileSpreadsheet, labelKey: "importTemplates" },
  { href: "/import", icon: Download, labelKey: "importImport" },
  { href: "/import/log", icon: ScrollText, labelKey: "importLog" },
] as const

const EXPORT_SUBNAV_ITEMS = [
  { href: "/export/templates", icon: FileSpreadsheet, labelKey: "exportTemplates" },
  { href: "/export", icon: Upload, labelKey: "exportExport" },
  { href: "/export/log", icon: ScrollText, labelKey: "exportLog" },
] as const

const AI_MODELS_SUBNAV_ITEMS = [
  { href: "/ai-models", icon: List, labelKey: "aiModelsModels" },
] as const

const SYSTEM_SUBNAV_ITEMS = [
  { href: "/system/logs", icon: ScrollText, labelKey: "systemLogs" },
  { href: "/system/workers", icon: Users, labelKey: "systemWorkers" },
  { href: "/system/docker", icon: Container, labelKey: "systemDocker" },
] as const

const CONFIG_ITEMS = [
  { href: "/configuration", icon: Settings, labelKey: "configuration" },
] as const


function CustomerSwitcher() {
  const t = useTranslations("nav")
  const { customers, sortedCustomers, recentCustomers, activeCustomer, setActiveCustomer } = useCustomer()
  const [isOpen, setIsOpen] = useState(false)

  const blocksRef = useRef<BlocksIconHandle>(null)

  if (!activeCustomer) return (
    <div className="flex items-center gap-2 w-full px-3 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] border-b">
      <BlocksIcon size={16} className="shrink-0" />
      <span className="text-xs truncate group-data-[collapsible=icon]:hidden opacity-80">
        Loading…
      </span>
    </div>
  )

  if (customers.length === 1) {
    return (
      <div className="flex items-center gap-2 w-full px-3 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] border-b">
        <BlocksIcon size={16} className="shrink-0" />
        <span className="text-xs truncate group-data-[collapsible=icon]:hidden">
          {activeCustomer.name}
        </span>
      </div>
    )
  }

  // IDs of recent customers to avoid showing them twice in "All"
  const recentIds = new Set(recentCustomers.map((c) => c.id))
  const otherCustomers = sortedCustomers.filter((c) => !recentIds.has(c.id))

  function handleSelect(id: string) {
    const customer = customers.find((c) => c.id === id)
    if (customer) {
      setActiveCustomer(customer)
      setIsOpen(false)
    }
  }

  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  // Position the dropdown below the trigger; flip above if it would overflow
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const dropdownHeight = 320 // max-h-[300px] + input + border
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow >= dropdownHeight ? rect.bottom : rect.top - dropdownHeight
    setPos({ top: Math.max(0, top), left: rect.left, width: rect.width })
  }, [isOpen])

  // Close on outside click
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (
      dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
      triggerRef.current && !triggerRef.current.contains(e.target as Node)
    ) {
      setIsOpen(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick)
      return () => document.removeEventListener("mousedown", handleOutsideClick)
    }
  }, [isOpen, handleOutsideClick])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => blocksRef.current?.startAnimation()}
        onMouseLeave={() => blocksRef.current?.stopAnimation()}
        className="flex items-center gap-2 w-full px-3 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] border-b hover:bg-[var(--primary)]/90 transition-colors outline-none cursor-pointer group-data-[collapsible=icon]:justify-center"
      >
        <BlocksIcon ref={blocksRef} size={16} className="shrink-0" />
        <span className="flex-1 text-xs truncate text-left group-data-[collapsible=icon]:hidden">
          {activeCustomer.name}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 group-data-[collapsible=icon]:hidden" />
      </button>
      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, backgroundColor: "var(--popover)" }}
          className="z-[9999] isolate rounded-md border text-popover-foreground shadow-2xl"
        >
          <Command style={{ backgroundColor: "var(--popover)" }}>
            <CommandInput placeholder={t("searchCustomers")} />
            <CommandList>
              <CommandEmpty>{t("noResults")}</CommandEmpty>
              <CommandGroup>
                {recentCustomers.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() => handleSelect(c.id)}
                    className={c.id === activeCustomer.id ? "font-medium" : ""}
                  >
                    {c.name}
                  </CommandItem>
                ))}
                {recentCustomers.length > 0 && otherCustomers.length > 0 && <CommandSeparator />}
                {otherCustomers.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() => handleSelect(c.id)}
                    className={c.id === activeCustomer.id ? "font-medium" : ""}
                  >
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>,
        document.body
      )}
    </>
  )
}


export function AppSidebar() {
  const t = useTranslations()
  const { data: session } = useSession()
  const { toggleSidebar, state } = useSidebar()
  const isExpanded = state === "expanded"
  const router = useRouter()

  async function handleSignOut() {
    await signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })
  }

  const user = session?.user

  return (
    <Sidebar>
      {/* Header — click to toggle collapse */}
      <SidebarHeader
        className="cursor-pointer select-none"
        onClick={toggleSidebar}
        title={isExpanded ? t("sidebar.collapse") : t("sidebar.expand")}
      >
        <div className="flex h-[calc(var(--topbar-height,3.5rem)-1px)] items-center gap-2 px-1">
          <a
            onClick={(e) => { e.stopPropagation(); if (isExpanded) router.push("/"); else toggleSidebar() }}
            className="cursor-pointer p-0.5 shrink-0"
          >
            <img
              src="/gorm.png"
              alt="Gorm"
              className="shrink-0"
              style={{ width: 28, height: 28 }}
            />
          </a>
          {isExpanded && (
            <span className="font-semibold text-sm text-[var(--sidebar-foreground)] whitespace-nowrap overflow-hidden">
              Gorm AI
            </span>
          )}
        </div>
      </SidebarHeader>

      {/* Main content */}
      <SidebarContent
        onClick={(e) => {
          if (e.target === e.currentTarget) toggleSidebar()
        }}
        className="cursor-pointer"
      >
        {/* Customer switcher */}
        <div onClick={(e) => e.stopPropagation()}>
          <CustomerSwitcher />
        </div>

        <SidebarSeparator />

        {/* Task list */}
        <div
          className="flex-1 min-h-0 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <SidebarTasks />
        </div>
      </SidebarContent>

      {/* Footer — user + nav dropdown */}
      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-md p-2 text-sm hover:bg-[var(--sidebar-accent)] transition-colors outline-none cursor-pointer">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={user?.image ?? ""} />
                <AvatarFallback className="text-xs bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)]">
                  {user?.name ? getInitials(user.name) : "?"}
                </AvatarFallback>
              </Avatar>
              {isExpanded && (
                <>
                  <span className="flex-1 truncate text-left text-xs font-medium text-[var(--sidebar-foreground)]">
                    {user?.name ?? user?.email ?? "User"}
                  </span>
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-foreground)]/50" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" className="w-56 mb-1">
            {/* Navigation */}
            {NAV_ITEMS.map((item) => (
              <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                <item.icon className="h-4 w-4" />
                {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />

            {/* Predictions — New, Strategies, Completed | Analytics | Adjustments, Export Configuration */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Activity className="h-4 w-4" />
                {t("nav.predictions")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PREDICTION_SUBNAV_TOP.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {PREDICTION_SUBNAV_MID.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {PREDICTION_SUBNAV_BOT.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Simulations */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BarChart3 className="h-4 w-4" />
                {t("nav.simulations")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SIMULATION_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Outlets — moved below Simulations */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ShoppingCart className="h-4 w-4" />
                {t("nav.outlets")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {OUTLET_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* Pads & Filters */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Filter className="h-4 w-4" />
                {t("nav.padsFilters")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PADS_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Financials */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DollarSign className="h-4 w-4" />
                {t("nav.financials")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {FINANCIALS_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Statistics */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PieChart className="h-4 w-4" />
                {t("nav.statistics")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {STATISTICS_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* AI Models */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Brain className="h-4 w-4" />
                {t("nav.aiModels")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {AI_MODELS_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* Import */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Import className="h-4 w-4" />
                {t("nav.import")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {IMPORT_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Export */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Upload className="h-4 w-4" />
                {t("nav.export")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {EXPORT_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            {CONFIG_ITEMS.map((item) => (
              <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                <item.icon className="h-4 w-4" />
                {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
              </DropdownMenuItem>
            ))}

            {/* System */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Server className="h-4 w-4" />
                {t("nav.system")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SYSTEM_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* Theme + logout */}
            <DropdownMenuItem asChild>
              <div className="flex items-center justify-between cursor-default">
                <span className="text-sm">Theme</span>
                <ThemeToggle className="h-6 w-6" />
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[var(--destructive)] focus:text-[var(--destructive)]"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              {t("userMenu.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
