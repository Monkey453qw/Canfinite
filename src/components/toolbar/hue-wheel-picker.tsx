"use client";

/**
 * HueWheelColorPicker — a circular hue wheel with a draggable pointer.
 *
 * The wheel shows all 360° of hue. The user drags the pointer (or taps)
 * to select a hue. Saturation and lightness sliders are included below.
 * The current color is shown as a preview swatch.
 *
 * Implementation: an outer wrapper keys the inner picker on the external
 * `color` prop so that when the parent passes a new color, the inner
 * component remounts and its useState initializers read the fresh value
 * (no setState-in-effect needed).
 *
 * Props:
 *   color: string       — current color (hex)
 *   onChange: (hex) => void
 */

import React, { useCallback, useRef, useState } from "react";

interface Props {
  color: string;
  onChange: (hex: string) => void;
}

// Convert hex to HSL
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

// Convert HSL to hex
function hslToHex(h: number, s: number, l: number): string {
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function HueWheelColorPicker({ color, onChange }: Props) {
  // Key the inner component on the external color so it remounts (and reads
  // fresh useState initializers) whenever the parent passes a new color.
  return (
    <HueWheelInner
      key={color}
      initialColor={color}
      onChange={onChange}
    />
  );
}

interface InnerProps {
  initialColor: string;
  onChange: (hex: string) => void;
}

const HueWheelInner = React.memo(function HueWheelInner({
  initialColor,
  onChange,
}: InnerProps) {
  const { h: initH, s: initS, l: initL } = hexToHsl(initialColor);
  const [hue, setHue] = useState(initH);
  const [sat, setSat] = useState(initS * 100);
  const [light, setLight] = useState(initL * 100);
  const wheelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Helper: update hue and notify parent immediately (avoids useEffect loop)
  const updateHue = useCallback((newHue: number) => {
    setHue(newHue);
    onChange(hslToHex(newHue, sat / 100, light / 100));
  }, [sat, light, onChange]);

  const updateSat = useCallback((newSat: number) => {
    setSat(newSat);
    onChange(hslToHex(hue, newSat / 100, light / 100));
  }, [hue, light, onChange]);

  const updateLight = useCallback((newLight: number) => {
    setLight(newLight);
    onChange(hslToHex(hue, sat / 100, newLight / 100));
  }, [hue, sat, onChange]);

  const updateHueFromPointer = useCallback((clientX: number, clientY: number) => {
    const wheel = wheelRef.current;
    if (!wheel) return;
    const rect = wheel.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle += 90;
    if (angle < 0) angle += 360;
    updateHue(angle);
  }, [updateHue]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateHueFromPointer(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    updateHueFromPointer(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // Pointer position on the wheel for the hue indicator
  const indicatorAngle = (hue - 90) * (Math.PI / 180);
  const wheelSize = 180;
  const indicatorR = wheelSize / 2 - 12;
  const indicatorX = wheelSize / 2 + indicatorR * Math.cos(indicatorAngle);
  const indicatorY = wheelSize / 2 + indicatorR * Math.sin(indicatorAngle);

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      {/* Hue wheel */}
      <div
        ref={wheelRef}
        className="relative rounded-full cursor-pointer touch-none select-none"
        style={{
          width: wheelSize,
          height: wheelSize,
          background: `conic-gradient(from 0deg,
            hsl(0,100%,50%),
            hsl(60,100%,50%),
            hsl(120,100%,50%),
            hsl(180,100%,50%),
            hsl(240,100%,50%),
            hsl(300,100%,50%),
            hsl(360,100%,50%))`,
          boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.3), 0 4px 12px rgba(0,0,0,0.15)",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Inner circle (hole) showing current color */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            top: "30%",
            left: "30%",
            width: "40%",
            height: "40%",
            background: `hsl(${hue}, ${sat}%, ${light}%)`,
            boxShadow: "inset 0 2px 8px rgba(0,0,0,0.2), 0 0 0 2px rgba(255,255,255,0.5)",
          }}
        />
        {/* Hue indicator (draggable circle) */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 24,
            height: 24,
            left: indicatorX - 12,
            top: indicatorY - 12,
            background: `hsl(${hue}, 100%, 50%)`,
            border: "3px solid white",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
        />
      </div>

      {/* Saturation slider */}
      <div className="w-full">
        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
          <span>Saturation</span>
          <span>{Math.round(sat)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={sat}
          onChange={(e) => updateSat(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, hsl(${hue},0%,${light}%), hsl(${hue},100%,${light}%))`,
          }}
        />
      </div>

      {/* Lightness slider */}
      <div className="w-full">
        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
          <span>Lightness</span>
          <span>{Math.round(light)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={light}
          onChange={(e) => updateLight(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #000, hsl(${hue},${sat}%,50%), #fff)`,
          }}
        />
      </div>

      {/* Color preview + hex input */}
      <div className="flex items-center gap-2 w-full">
        <div
          className="h-9 w-9 rounded-lg border-2 border-border flex-shrink-0"
          style={{ background: `hsl(${hue}, ${sat}%, ${light}%)` }}
        />
        <input
          type="text"
          value={hslToHex(hue, sat / 100, light / 100).toUpperCase()}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
              const { h, s, l } = hexToHsl(v);
              setHue(h);
              setSat(s * 100);
              setLight(l * 100);
              onChange(v);
            }
          }}
          className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    </div>
  );
});
