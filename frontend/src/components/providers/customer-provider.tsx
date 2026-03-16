"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { customersApi, type CustomerResponse } from "@/lib/api"

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
  const queryClient = useQueryClient()
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list({ limit: 100 }),
    staleTime: 5 * 60 * 1000,
  })

  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return localStorage.getItem(STORAGE_KEY)
  })

  // Auto-select first customer if none stored
  useEffect(() => {
    if (customers.length > 0 && !activeCustomerId) {
      setActiveCustomerId(customers[0].id)
    }
  }, [customers, activeCustomerId])

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
    setActiveCustomerId(customer.id)
    localStorage.setItem(STORAGE_KEY, customer.id)
    // Fire-and-forget: update last_opened_at on backend
    customersApi.opened(customer.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
    }).catch(() => {})
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
