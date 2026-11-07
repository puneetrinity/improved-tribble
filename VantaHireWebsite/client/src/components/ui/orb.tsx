"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

// ─── Minimal theme/token plumbing Orb needs ────────────────────
// Extracted verbatim from Halaska Kit's single-file bundle
// (halaska-kit-v1.0.jsx) — trimmed to only what Orb itself uses.
// ealana: typed for strict TypeScript; light textSecondary darkened #888 → #666 for 4.5:1 contrast on white.

type Theme = "light" | "dark";
const ThemeContext = createContext<Theme>("light");
function useThemeContext() {
  return useContext(ThemeContext);
}

const AccentContext = createContext<string | null>(null);
function useAccent() {
  return useContext(AccentContext);
}

const tokens = {
  radius: { pill: 999 },
  type: {
    sm: { fontSize: 12, lineHeight: 1.55, letterSpacing: "0.01em" },
  },
  font: {
    sans: "var(--halaska-sans, 'Geist'), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  light: {
    bgElevated: "#ffffff",
    borderSubtle: "#eeeeee",
    textSecondary: "#666666",
    shadow: "rgba(0,0,0,0.04)",
    accent: "#8b5cf6",
    accentText: "#8b5cf6",
    accentHover: "#7c3aed",
    accentBg: "#f5f3ff",
  },
  dark: {
    bgElevated: "#2a2a2a",
    borderSubtle: "#2f2f2f",
    textSecondary: "#999999",
    shadow: "rgba(0,0,0,0.2)",
    accent: "#a78bfa",
    accentText: "#a78bfa",
    accentHover: "#8b5cf6",
    accentBg: "rgba(167,139,250,0.12)",
  },
};

const motion = {
  smooth: "var(--halaska-t-smooth, 0.35s)",
  easeInOut: "var(--halaska-e-inout, cubic-bezier(0.4, 0, 0.2, 1))",
};

function p(theme: Theme) {
  return theme === "dark" ? tokens.dark : tokens.light;
}

// Hook that returns palette with accent overrides applied
function usePal(themeProp?: Theme) {
  const ctxTheme = useThemeContext();
  const theme = themeProp || ctxTheme;
  const accent = useAccent();
  const base = p(theme);
  if (!accent || accent === base.accent) return base;
  // Generate variants from the accent hex
  const hex = accent;
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  const hR = Math.max(0, r - 30),
    hG = Math.max(0, g - 30),
    hB = Math.max(0, b - 30);
  const hoverHex = `#${hR.toString(16).padStart(2, "0")}${hG.toString(16).padStart(2, "0")}${hB.toString(16).padStart(2, "0")}`;
  const bgAlpha = theme === "dark" ? 0.12 : 0.08;
  return {
    ...base,
    accent: hex,
    accentText: hex,
    accentHover: hoverHex,
    accentBg: `rgba(${r},${g},${b},${bgAlpha})`,
  };
}

// ─── Orb ───────────────────────────────────────────────────────
// Compact agent-activity indicator: lets a UI show what the agent is doing
// without blocking the thread. Five variants keyed to agent tasks; geometry
// lives on a 24px stage scaled to `size`. Renders bare or as a status pill.

const ORB_STAGE = 24;

export type OrbVariant = "pulse" | "orbit" | "sweep" | "globe" | "spark";

const ORB_TASKS: Record<OrbVariant, string> = {
  pulse: "Thinking",
  orbit: "Searching",
  sweep: "Writing",
  globe: "Planning",
  spark: "Waiting",
};

const ORB_LATTICE = (() => {
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y });
  return cells;
})();

const ORB_RING = Array.from({ length: 8 }, (_, i) => i);

export type OrbProps = {
  variant?: OrbVariant;
  size?: number;
  label?: string;
  pill?: boolean;
  color?: string;
  theme?: Theme;
  style?: CSSProperties;
};

function Orb({
  variant = "pulse",
  size = 20,
  label,
  pill,
  color,
  theme: tp,
  style: sp,
}: OrbProps) {
  const ctx = useThemeContext();
  const theme = tp || ctx;
  const pal = usePal(theme);
  const text = label || `${ORB_TASKS[variant] || "Working"}…`;

  let cells: ReactNode = null;
  if (variant === "pulse" || variant === "sweep") {
    // 3×3 lattice: radial wavefront (pulse) or left-to-right band (sweep).
    cells = ORB_LATTICE.map(({ x, y }) => {
      const delay =
        variant === "pulse" ? Math.hypot(x - 1, y - 1) * 260 : x * 220;
      return (
        <span
          key={`${x}${y}`}
          style={{
            position: "absolute",
            left: x * 8 + 2,
            top: y * 8 + 2,
            width: 4,
            height: 4,
            borderRadius: 2,
            background: "currentColor",
            opacity: 0.25,
            transform: "scale(0.4)",
            animation: `halaska-orb-swell 1.6s ${motion.easeInOut} ${Math.round(delay)}ms infinite`,
          }}
        />
      );
    });
  } else if (variant === "orbit") {
    // Ring of 8: negative delays turn one swell into a comet chase.
    cells = ORB_RING.map((i) => {
      const a = (i / 8) * Math.PI * 2;
      return (
        <span
          key={i}
          style={{
            position: "absolute",
            width: 3.5,
            height: 3.5,
            borderRadius: 2,
            left: 12 + Math.cos(a) * 9 - 1.75,
            top: 12 + Math.sin(a) * 9 - 1.75,
            background: "currentColor",
            opacity: 0.2,
            transform: "scale(0.5)",
            animation: `halaska-orb-swell 1.4s ${motion.easeInOut} ${-(i / 8) * 1.4}s infinite`,
          }}
        />
      );
    });
  } else if (variant === "globe") {
    // Dots share one elliptical track, spaced by negative delay: reads as
    // a flattened globe spinning, with scale + opacity as the depth cue.
    cells = ORB_RING.map((i) => (
      <span
        key={i}
        style={{
          position: "absolute",
          left: 12 - 1.75,
          top: 12 - 1.75,
          width: 3.5,
          height: 3.5,
          borderRadius: 2,
          background: "currentColor",
          animation: `halaska-orb-globe 3.2s linear ${-(i / 8) * 3.2}s infinite`,
        }}
      />
    ));
  } else if (variant === "spark") {
    // The kit's ✦ glyph, breathing: with a soft echo bursting outward.
    cells = (
      <>
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            lineHeight: 1,
            animation: `halaska-orb-spark 2.4s ${motion.easeInOut} infinite`,
          }}
        >
          ✦
        </span>
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            lineHeight: 1,
            opacity: 0,
            animation: "halaska-star-burst 2.4s ease-out infinite",
          }}
        >
          ✦
        </span>
      </>
    );
  }

  const glyph = (
    <span
      data-halaska-orb=""
      role={pill ? undefined : "img"}
      aria-label={pill ? undefined : text}
      aria-hidden={pill ? true : undefined}
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flexShrink: 0,
        color: color || pal.textSecondary,
        transition: `color ${motion.smooth} ${motion.easeInOut}`,
        ...(pill ? undefined : sp),
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: ORB_STAGE,
          height: ORB_STAGE,
          transform: `scale(${size / ORB_STAGE})`,
          transformOrigin: "top left",
        }}
      >
        {cells}
      </span>
    </span>
  );

  if (!pill) return glyph;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 30,
        padding: "0 12px 0 6px",
        borderRadius: tokens.radius.pill,
        background: pal.bgElevated,
        boxShadow: `0 0 0 1px ${pal.borderSubtle}, 0 1px 2px ${pal.shadow}`,
        fontFamily: tokens.font.sans,
        transition: `background ${motion.smooth} ${motion.easeInOut}, box-shadow ${motion.smooth} ${motion.easeInOut}`,
        ...sp,
      }}
    >
      {glyph}
      <span
        style={{
          ...tokens.type.sm,
          color: pal.textSecondary,
          whiteSpace: "nowrap",
          transition: `color ${motion.smooth} ${motion.easeInOut}`,
        }}
      >
        {text}
      </span>
    </span>
  );
}

export default Orb;
