"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface ScissorsLineDashedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ScissorsLineDashedIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

// Scissors animation: open/close blades
const BLADE_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: {
    rotate: [0, -8, 8, -4, 0],
    transition: { duration: 0.5, ease: "easeInOut" },
  },
};

const DASH_VARIANTS: Variants = {
  normal: { strokeDashoffset: 0 },
  animate: {
    strokeDashoffset: [0, 8],
    transition: { duration: 0.6, ease: "linear" },
  },
};

const ScissorsLineDashedIcon = forwardRef<ScissorsLineDashedIconHandle, ScissorsLineDashedIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave]
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Scissors blades - lucide scissors-line-dashed icon paths */}
          <motion.path
            d="M5.42 9.42 8 12"
            variants={BLADE_VARIANTS}
            animate={controls}
          />
          <motion.circle cx="4" cy="8" r="2.5" variants={BLADE_VARIANTS} animate={controls} />
          <motion.path
            d="M5.42 14.58 8 12"
            variants={BLADE_VARIANTS}
            animate={controls}
          />
          <motion.circle cx="4" cy="16" r="2.5" variants={BLADE_VARIANTS} animate={controls} />
          {/* Dashed line */}
          <motion.path
            d="M10 12h2"
            variants={DASH_VARIANTS}
            animate={controls}
          />
          <motion.path
            d="M16 12h2"
            variants={DASH_VARIANTS}
            animate={controls}
          />
          <motion.path
            d="M22 12h2"
            variants={DASH_VARIANTS}
            animate={controls}
          />
        </svg>
      </div>
    );
  }
);

ScissorsLineDashedIcon.displayName = "ScissorsLineDashedIcon";

export { ScissorsLineDashedIcon };
