"use client"

import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { motion, useAnimation, type Variants, type Transition } from "motion/react"
import { Button } from "@/components/ui/button"

// ─── Moon: whole SVG wobbles on hover ─────────────────────────────────────────

const MOON_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: { rotate: [0, -10, 10, -5, 5, 0] },
}
const MOON_TRANSITION: Transition = { duration: 1.2, ease: "easeInOut" }

// ─── Sun: rays stagger-fade in on hover ───────────────────────────────────────

const RAY_PATHS = [
  "M12 2v2",
  "m19.07 4.93-1.41 1.41",
  "M20 12h2",
  "m17.66 17.66 1.41 1.41",
  "M12 20v2",
  "m6.34 17.66-1.41 1.41",
  "M2 12h2",
  "m4.93 4.93 1.41 1.41",
]

// ─── Toggle ────────────────────────────────────────────────────────────────────

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const t = useTranslations("theme")
  const controls = useAnimation()

  // Avoid hydration mismatch — render nothing until theme is known client-side
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      onMouseEnter={() => controls.start("animate")}
      onMouseLeave={() => controls.start("normal")}
      aria-label={t("toggle")}
    >
      {!mounted ? (
        <span className="h-4 w-4" />
      ) : isDark ? (
        <motion.svg
          xmlns="http://www.w3.org/2000/svg"
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          variants={MOON_VARIANTS}
          animate={controls}
          transition={MOON_TRANSITION}
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </motion.svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <circle cx="12" cy="12" r="4" />
          {RAY_PATHS.map((d, i) => (
            <motion.path
              key={d}
              d={d}
              variants={{
                normal: { opacity: 1 },
                animate: {
                  opacity: [0, 1],
                  transition: { delay: i * 0.1, duration: 0.3 },
                },
              }}
              animate={controls}
            />
          ))}
        </svg>
      )}
    </Button>
  )
}
