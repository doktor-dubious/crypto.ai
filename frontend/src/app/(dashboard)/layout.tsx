import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Topbar } from "@/components/layout/topbar"
import { CustomerProvider } from "@/components/providers/customer-provider"
import { customersApi } from "@/lib/api"
import { LockProvider } from "@/components/providers/lock-provider"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const queryClient = new QueryClient()

  await queryClient.prefetchQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.list({ limit: 100 }),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CustomerProvider>
        <LockProvider>
          <SidebarProvider defaultOpen={true}>
            <div className="flex h-screen w-full overflow-hidden bg-[var(--background)]">
              <AppSidebar />
              <div className="flex flex-1 flex-col overflow-hidden">
                <Topbar />
                <main className="flex-1 overflow-y-auto p-6 flex flex-col min-h-0">{children}</main>
              </div>
            </div>
          </SidebarProvider>
        </LockProvider>
      </CustomerProvider>
    </HydrationBoundary>
  )
}
