"use client";

/**
 * BootAnimation — iOS-style "hello" bootup animation.
 *
 * A black screen fills the viewport. The word "hello" appears letter by letter
 * in a cursive handwriting font, each letter fading in smoothly with a slight
 * upward motion — mimicking the classic iOS boot screen.
 *
 * After the full word is written, it holds briefly, then the entire screen
 * fades out to reveal the canvas.
 */

import { useEffect, useState } from "react";

const WORD = "hello";

export function BootAnimation() {
  const [visible, setVisible] = useState(true);
  const [revealedCount, setRevealedCount] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    // Reveal one letter at a time, 250ms apart
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < WORD.length; i++) {
      timers.push(
        setTimeout(() => setRevealedCount(i + 1), 300 + i * 250),
      );
    }

    // After the full word is revealed, hold for 1.2s, then fade out
    const totalRevealTime = 300 + WORD.length * 250; // 1550ms
    const fadeStart = totalRevealTime + 1200; // 2750ms
    const unmountTime = fadeStart + 800; // 3550ms

    timers.push(setTimeout(() => setFadingOut(true), fadeStart));
    timers.push(setTimeout(() => setVisible(false), unmountTime));

    return () => timers.forEach(clearTimeout);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background: "#000000",
        opacity: fadingOut ? 0 : 1,
        transition: "opacity 0.8s ease-in-out",
        pointerEvents: fadingOut ? "none" : "auto",
      }}
    >
      <div
        style={{
          fontFamily: "'Snell Roundhand', 'Brush Script MT', 'Segoe Script', 'Apple Chancery', cursive",
          fontSize: "clamp(3.5rem, 12vw, 7rem)",
          fontStyle: "italic",
          fontWeight: 400,
          color: "#ffffff",
          textShadow: "0 2px 30px rgba(255,255,255,0.2)",
          display: "flex",
          letterSpacing: "0.02em",
        }}
      >
        {WORD.split("").map((char, i) => {
          const isRevealed = i < revealedCount;
          return (
            <span
              key={i}
              style={{
                opacity: isRevealed ? 1 : 0,
                transform: isRevealed
                  ? "translateY(0) scale(1)"
                  : "translateY(12px) scale(0.92)",
                transition: "opacity 0.5s ease-out, transform 0.5s ease-out",
                transitionDelay: "0ms",
              }}
            >
              {char}
            </span>
          );
        })}
      </div>
    </div>
  );
}
