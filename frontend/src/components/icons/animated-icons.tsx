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

// ─── AnimatedCookingPot ───────────────────────────────────────────────────────

const COOKING_POT_VARIANTS: Variants = {
  normal: { rotate: 0, scale: 1, y: 0 },
  animate: {
    scale: [1, 0.95, 1.05, 1],
    y: [0, 1, -1, 0],
    transition: {
      duration: 0.6,
      ease: "easeInOut",
    },
  },
}

const STEAM_VARIANTS: Variants = {
  normal: { opacity: 0.6, y: 0 },
  animate: {
    opacity: [0, 0.8, 0],
    y: [0, -3, -6],
    transition: { duration: 0.8, ease: "easeOut" },
  },
}

export function AnimatedCookingPot({ className, controls: externalControls }: { className?: string; controls?: ReturnType<typeof useAnimation> }) {
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
      variants={COOKING_POT_VARIANTS}
      animate={controls}
      {...mouseHandlers}
    >
      <path d="M2 12h20" />
      <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />
      <path d="m4 8 16-4" />
      <path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8" />
      <motion.path
        d="M9 1v2"
        variants={STEAM_VARIANTS}
        animate={controls}
        strokeOpacity={0.5}
      />
      <motion.path
        d="M15 1v2"
        variants={STEAM_VARIANTS}
        animate={controls}
        strokeOpacity={0.5}
      />
    </motion.svg>
  )
}

// ─── AnimatedSettings ─────────────────────────────────────────────────────────

const SETTINGS_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: {
    rotate: 180,
    transition: { duration: 0.6, ease: "easeInOut" },
  },
}

export function AnimatedSettings({ className, controls: externalControls }: { className?: string; controls?: ReturnType<typeof useAnimation> }) {
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
      variants={SETTINGS_VARIANTS}
      animate={controls}
      {...mouseHandlers}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </motion.svg>
  )
}

// ─── AnimatedFlask ─────────────────────────────────────────────────────────────

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
