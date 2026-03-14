"use client"

import * as React from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

export interface ViewOption {
  id: string
  label: string
  icon?: React.ReactNode
}

interface ViewSwitcherProps {
  options: ViewOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function ViewSwitcher({ options, value, onChange, className }: ViewSwitcherProps) {
  const [buttonRefs] = React.useState<Map<string, HTMLButtonElement | null>>(new Map())
  const [indicatorStyle, setIndicatorStyle] = React.useState({ left: 0, width: 0 })

  React.useLayoutEffect(() => {
    const activeButton = buttonRefs.get(value)
    if (activeButton) {
      const container = activeButton.parentElement
      if (container) {
        const containerRect = container.getBoundingClientRect()
        const buttonRect = activeButton.getBoundingClientRect()
        setIndicatorStyle({
          left: buttonRect.left - containerRect.left,
          width: buttonRect.width,
        })
      }
    }
  }, [value, buttonRefs])

  return (
    <div
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-lg bg-muted p-1",
        className
      )}
      role="tablist"
    >
      <motion.div
        className="absolute top-1 bottom-1 rounded-md bg-background shadow-sm"
        initial={false}
        animate={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
        }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 30,
        }}
      />

      {options.map((option) => {
        const isActive = value === option.id
        return (
          <button
            key={option.id}
            ref={(el) => {
              buttonRefs.set(option.id, el)
            }}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative z-10 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.icon && <span className="shrink-0 [&_svg]:size-4">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
