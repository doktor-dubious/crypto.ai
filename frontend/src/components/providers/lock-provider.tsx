"use client"

import { createContext, useCallback, useContext, useState } from "react"

interface LockContextValue {
  isLocked: boolean
  toggleLock: () => void
}

const LockContext = createContext<LockContextValue>({
  isLocked: true,
  toggleLock: () => {},
})

export function LockProvider({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked] = useState(true)

  const toggleLock = useCallback(() => {
    setIsLocked((prev) => !prev)
  }, [])

  return (
    <LockContext.Provider value={{ isLocked, toggleLock }}>
      {children}
    </LockContext.Provider>
  )
}

export function useLock() {
  return useContext(LockContext)
}
