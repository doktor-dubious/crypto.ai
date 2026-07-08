"use client"

// Bridges a trading strategy explorer (which owns the current parameter values and
// the function that applies a param set back onto the page) to the topbar, which
// renders the template icon + modal. The explorer registers a bridge on mount; the
// topbar shows the icon only while a bridge is registered — i.e. only on the
// trading strategy analytics pages.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

export type TemplateParams = Record<string, unknown>

export interface TemplateScope {
  coin_id?: string
  quote_asset?: string
  interval?: string
}

export interface TemplateBridge {
  strategy: string
  // Read the page's current signal parameters (called at save time, so it always
  // reflects the latest values without re-registering on every keystroke).
  getParams: () => TemplateParams
  // Read the page's current scope (coin / pair / timeframe) at save time, so a
  // template captures the full setup for Paper Trade to restore.
  getScope: () => TemplateScope
  // Apply a template's params back onto the page (used by Revert).
  applyParams: (params: TemplateParams) => void
}

interface Ctx {
  bridge: TemplateBridge | null
  register: (bridge: TemplateBridge | null) => void
}

const TemplateContext = createContext<Ctx>({ bridge: null, register: () => {} })

export function TradingTemplateProvider({ children }: { children: React.ReactNode }) {
  const [bridge, setBridge] = useState<TemplateBridge | null>(null)
  const register = useCallback((b: TemplateBridge | null) => setBridge(b), [])
  return (
    <TemplateContext.Provider value={{ bridge, register }}>
      {children}
    </TemplateContext.Provider>
  )
}

export function useTradingTemplate(): Ctx {
  return useContext(TemplateContext)
}

/**
 * Called by an explorer to expose its params + apply function to the topbar.
 * getParams/applyParams are kept in refs so the bridge registers once per
 * strategy (not on every param change) yet always sees the latest closures.
 */
export function useRegisterTemplateBridge(
  strategy: string,
  getParams: () => TemplateParams,
  applyParams: (params: TemplateParams) => void,
  getScope: () => TemplateScope,
) {
  const { register } = useTradingTemplate()
  const getRef = useRef(getParams)
  const applyRef = useRef(applyParams)
  const scopeRef = useRef(getScope)
  getRef.current = getParams
  applyRef.current = applyParams
  scopeRef.current = getScope

  useEffect(() => {
    register({
      strategy,
      getParams: () => getRef.current(),
      getScope: () => scopeRef.current(),
      applyParams: (p) => applyRef.current(p),
    })
    return () => register(null)
  }, [register, strategy])
}
