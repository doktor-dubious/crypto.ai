"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  BarChart3,
  Blocks,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  CreditCard,
  Home,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Sliders,
  Users,
  CalendarDays,
  FolderOpen,
  Activity,
  Sparkles,
  Cpu,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { SidebarTasks } from "@/components/layout/sidebar-tasks"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Input } from "@/components/ui/input"
import { useCustomer } from "@/components/providers/customer-provider"

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
  { href: "/outlets", icon: ShoppingCart, labelKey: "outlets" },
  { href: "/sales", icon: CreditCard, labelKey: "sales" },
] as const

const PREDICTION_ITEMS = [
  { href: "/pads", icon: CalendarDays, labelKey: "pads" },
  { href: "/outlet-groups", icon: FolderOpen, labelKey: "outletGroups" },
  { href: "/draw-adjustments", icon: Sliders, labelKey: "drawAdjustments" },
] as const

const SIMULATION_SUBNAV_ITEMS = [
  { href: "/simulations/new", icon: Plus, labelKey: "simulationsNew" },
  { href: "/simulations/strategies", icon: Sparkles, labelKey: "simulationsStrategies" },
  { href: "/simulations/completed", icon: CheckCircle, labelKey: "simulationsCompleted" },
] as const

const PREDICTION_SUBNAV_ITEMS = [
  { href: "/predictions/new", icon: Plus, labelKey: "predictionsNew" },
  { href: "/predictions/strategies", icon: Sparkles, labelKey: "predictionsStrategies" },
  { href: "/predictions/completed", icon: CheckCircle, labelKey: "predictionsCompleted" },
  { href: "/predictions/configuration", icon: Cpu, labelKey: "predictionsConfiguration" },
] as const

const CONFIG_ITEMS = [
  { href: "/configuration", icon: LayoutDashboard, labelKey: "configuration" },
  { href: "/settings", icon: Settings, labelKey: "settings" },
] as const


function CustomerSwitcher() {
  const t = useTranslations("nav")
  const { customers, sortedCustomers, activeCustomer, setActiveCustomer } = useCustomer()
  const [searchQuery, setSearchQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) setSearchQuery("")
  }, [isOpen])

  const orderedCustomers = useMemo(() => {
    if (!activeCustomer) return sortedCustomers
    return [activeCustomer, ...sortedCustomers.filter((c) => c.id !== activeCustomer.id)]
  }, [sortedCustomers, activeCustomer])

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return orderedCustomers
    const q = searchQuery.toLowerCase()
    return orderedCustomers.filter((c) => c.name.toLowerCase().includes(q))
  }, [orderedCustomers, searchQuery])

  if (!activeCustomer) return null

  const showSearch = customers.length > 8

  if (customers.length === 1) {
    return (
      <div className="flex items-center gap-2 w-full px-3 py-2 bg-sidebar-accent text-sidebar-foreground/60 border-b">
        <Blocks className="h-4 w-4 shrink-0" />
        <span className="text-xs truncate group-data-[collapsible=icon]:hidden">
          {activeCustomer.name}
        </span>
      </div>
    )
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 w-full px-3 py-2 bg-sidebar-accent text-sidebar-foreground/60 border-b hover:text-sidebar-foreground transition-colors outline-none cursor-pointer group-data-[collapsible=icon]:justify-center">
          <Blocks className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-xs truncate text-left group-data-[collapsible=icon]:hidden">
            {activeCustomer.name}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 group-data-[collapsible=icon]:hidden" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--sidebar-width)]">
        <DropdownMenuLabel>{t("customers")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {showSearch && (
          <div className="px-2 py-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}
        <div className="max-h-64 overflow-y-auto">
          {filteredCustomers.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => { setActiveCustomer(c); setIsOpen(false) }}
              className="cursor-pointer"
            >
              <span className={c.id === activeCustomer.id ? "font-medium" : ""}>
                {c.name}
              </span>
            </DropdownMenuItem>
          ))}
          {filteredCustomers.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-[var(--muted-foreground)]">
              No results
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
            onClick={(e) => { e.stopPropagation(); router.push("/") }}
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
          className="flex-1 min-h-0 overflow-y-auto"
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
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-0.5">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Navigation */}
            {NAV_ITEMS.map((item) => (
              <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                <item.icon className="h-4 w-4" />
                {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Activity className="h-4 w-4" />
                {t("nav.predictions")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PREDICTION_SUBNAV_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
            {PREDICTION_ITEMS.map((item) => (
              <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                <item.icon className="h-4 w-4" />
                {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {CONFIG_ITEMS.map((item) => (
              <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                <item.icon className="h-4 w-4" />
                {t(`nav.${item.labelKey}` as Parameters<typeof t>[0])}
              </DropdownMenuItem>
            ))}
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
