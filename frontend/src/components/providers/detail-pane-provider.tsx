"use client"

import { createContext, useContext, type ReactNode } from "react"

/** True while the surrounding detail pane is maximized. Default (no pane) is false. */
const DetailPaneMaximizedContext = createContext(false)

export function DetailPaneMaximizedProvider({
  maximized,
  children,
}: {
  maximized: boolean
  children: ReactNode
}) {
  return (
    <DetailPaneMaximizedContext.Provider value={maximized}>
      {children}
    </DetailPaneMaximizedContext.Provider>
  )
}

export function useDetailPaneMaximized(): boolean {
  return useContext(DetailPaneMaximizedContext)
}

/**
 * Rows per page for a table inside a detail pane. Maximizing the pane frees a
 * screenful of vertical space, so the table fills it with rows instead of
 * whitespace. Outside a pane the context default keeps the normal page size.
 */
export function useDetailPageSize(normal = 10, maximized = 15): number {
  return useDetailPaneMaximized() ? maximized : normal
}
