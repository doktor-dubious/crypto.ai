"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "@/lib/auth-client"
import { customersApi, usersApi, type CustomerResponse } from "@/lib/api"

interface CustomerContextValue {
  customers: CustomerResponse[]
  sortedCustomers: CustomerResponse[]
  recentCustomers: CustomerResponse[]
  activeCustomer: CustomerResponse | null
  setActiveCustomer: (customer: CustomerResponse) => void
}

const CustomerContext = createContext<CustomerContextValue>({
  customers: [],
  sortedCustomers: [],
  recentCustomers: [],
  activeCustomer: null,
  setActiveCustomer: () => {},
})

const STORAGE_KEY = "gorm:activeCustomerId"

export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const userId = session?.user?.id

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", userId],
    queryFn: () => usersApi.customers(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  })

  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null)

  // Hydrate from localStorage after mount, then auto-select first customer if none stored
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      setActiveCustomerId(stored)
    } else if (customers.length > 0) {
      setActiveCustomerId(customers[0].id)
    }
  }, [customers])

  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  )

  const recentCustomers = useMemo(
    () =>
      [...customers]
        .filter((c) => c.last_opened_at)
        .sort((a, b) => new Date(b.last_opened_at!).getTime() - new Date(a.last_opened_at!).getTime())
        .slice(0, 5),
    [customers]
  )

  const activeCustomer = useMemo(
    () => customers.find((c) => c.id === activeCustomerId) ?? customers[0] ?? null,
    [customers, activeCustomerId]
  )

  function setActiveCustomer(customer: CustomerResponse) {
    if (customer.id === activeCustomerId) return
    localStorage.setItem(STORAGE_KEY, customer.id)
    // Fire-and-forget: update last_opened_at on backend (don't await — we're reloading)
    customersApi.opened(customer.id).catch(() => {})
    // Full reload so per-customer form state (e.g. new-simulation outlet group)
    // re-initializes from the new customer's defaults instead of the previous one's.
    window.location.reload()
  }

  return (
    <CustomerContext.Provider value={{ customers, sortedCustomers, recentCustomers, activeCustomer, setActiveCustomer }}>
      {children}
    </CustomerContext.Provider>
  )
}

export function useCustomer() {
  return useContext(CustomerContext)
}
