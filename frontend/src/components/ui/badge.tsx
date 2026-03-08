import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/80",
        secondary:
          "border-transparent bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--secondary)]/80",
        destructive:
          "border-transparent bg-[var(--destructive)] text-white hover:bg-[var(--destructive)]/80",
        outline: "text-[var(--foreground)]",
        success:
          "border-transparent bg-green-500/20 text-green-600 dark:bg-green-500/15 dark:text-green-400",
        warning:
          "border-transparent bg-yellow-500/20 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400",
        info:
          "border-transparent bg-blue-500/20 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
        muted:
          "border-transparent bg-[var(--muted)] text-[var(--muted-foreground)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
