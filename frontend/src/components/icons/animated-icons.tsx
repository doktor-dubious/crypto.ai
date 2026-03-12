"use client"

import { useAnimation, motion, type Variants } from "motion/react"

// ─── AnimatedActivity ─────────────────────────────────────────────────────────

const ACTIVITY_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    pathOffset: 0,
    transition: { duration: 0.4, opacity: { duration: 0.1 } },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    pathOffset: [1, 0],
    transition: { duration: 0.6, ease: "linear", opacity: { duration: 0.1 } },
  },
}

export function AnimatedActivity({ className, controls: externalControls }: { className?: string; controls?: ReturnType<typeof useAnimation> }) {
  const internalControls = useAnimation()
  const controls = externalControls ?? internalControls
  const mouseHandlers = externalControls ? {} : {
    onMouseEnter: () => controls.start("animate"),
    onMouseLeave: () => controls.start("normal"),
  }
  return (
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
      className={className}
      {...mouseHandlers}
    >
      <motion.path
        d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
        variants={ACTIVITY_VARIANTS}
        animate={controls}
      />
    </svg>
  )
}

// ─── AnimatedFlask ─────────────────────────────────────────────────────────────

const FLASK_VARIANTS: Variants = {
  normal: { rotate: 0, scale: 1 },
  animate: {
    scale: 0.9,
    rotate: [0, 6, -6, 3, -3, 0],
    transition: {
      duration: 0.8,
      scale: { type: "spring", bounce: 0.4, stiffness: 150, damping: 10, duration: 0.3 },
    },
  },
}

export function AnimatedFlask({ className, controls: externalControls }: { className?: string; controls?: ReturnType<typeof useAnimation> }) {
  const internalControls = useAnimation()
  const controls = externalControls ?? internalControls
  const mouseHandlers = externalControls ? {} : {
    onMouseEnter: () => controls.start("animate"),
    onMouseLeave: () => controls.start("normal"),
  }
  return (
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
      className={className}
      variants={FLASK_VARIANTS}
      animate={controls}
      {...mouseHandlers}
    >
      <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
      <path d="M8.5 2h7" />
      <path d="M7 16h10" />
    </motion.svg>
  )
}
