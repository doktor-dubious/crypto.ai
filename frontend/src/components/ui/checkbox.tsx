"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface CheckboxProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => {
    const isIndeterminate = checked === "indeterminate"
    const isChecked = checked === true

    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={isIndeterminate ? "mixed" : isChecked}
        data-slot="checkbox"
        data-state={isIndeterminate ? "indeterminate" : isChecked ? "checked" : "unchecked"}
        ref={ref}
        onClick={() => onCheckedChange?.(isIndeterminate ? true : !isChecked)}
        className={cn(
          "peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs",
          "inline-grid place-content-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary",
          "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary",
          className
        )}
        {...props}
      >
        {isChecked && <CheckIcon className="size-3" />}
        {isIndeterminate && <span className="block h-0.5 w-2.5 rounded-full bg-current" />}
      </button>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
