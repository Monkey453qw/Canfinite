"use client";

/**
 * TextEditorOverlay — renders an HTML textarea on top of a TextObject
 * whenever it is being edited, allowing live text input.
 *
 * Implementation notes:
 *   - We split into an outer wrapper that subscribes to store, and an inner
 *     <TextEditor> that is keyed by editingTextId. When the id changes,
 *     React remounts the inner component, so its useState initializer reads
 *     the latest text fresh — no setState-in-effect, no ref-during-render.
 *   - The wrapper subscribes to the store to re-render on viewport changes
 *     (so the textarea tracks pan/zoom while editing).
 */

import React, { useEffect, useState } from "react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import type { TextObject } from "@/lib/canvas/types";

export function TextEditorOverlay() {
  const editingTextId = useCanvasStore((s) => s.editingTextId);
  const objects = useCanvasStore((s) => s.objects);
  const viewport = useCanvasStore((s) => s.viewport);
  const tool = useCanvasStore((s) => s.tool);

  // Re-render on any store change (cheap — just used to recompute positions)
  const [, setTick] = useState(0);
  useEffect(() => {
    return useCanvasStore.subscribe(() => setTick((t) => t + 1));
  }, []);

  const editingObj = objects.find(
    (o): o is TextObject => o.id === editingTextId && o.type === "text",
  );

  if (!editingObj || tool !== "select") return null;

  return (
    <TextEditor
      key={editingObj.id}
      obj={editingObj}
      viewport={viewport}
    />
  );
}

const TextEditor = React.memo(function TextEditor({
  obj,
  viewport,
}: {
  obj: TextObject;
  viewport: { x: number; y: number; scale: number };
}) {
  const updateText = useCanvasStore((s) => s.updateText);
  const finishEditingText = useCanvasStore((s) => s.finishEditingText);
  const [value, setValue] = useState(obj.text);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  // Focus on mount
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, []);

  const onBlur = () => {
    if (value.trim() === "") {
      useCanvasStore.setState((s) => ({
        objects: s.objects.filter((o) => o.id !== obj.id),
        selection: { ids: [] },
        editingTextId: null,
      }));
    } else {
      finishEditingText();
    }
  };

  // Compute screen position from current viewport
  const left = obj.x * viewport.scale + viewport.x;
  const top = obj.y * viewport.scale + viewport.y;
  const width = obj.width * viewport.scale;
  const height = obj.height * viewport.scale;
  const fontSize = obj.fontSize * viewport.scale;

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        updateText(obj.id, { text: e.target.value });
      }}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        e.stopPropagation();
      }}
      style={{
        position: "absolute",
        left,
        top,
        width,
        minHeight: height,
        fontSize,
        fontFamily: obj.fontFamily,
        color: obj.color,
        textAlign: obj.align,
        background: "transparent",
        border: "2px solid #5b5bf0",
        borderRadius: 4,
        outline: "none",
        resize: "none",
        padding: 0,
        lineHeight: 1.2,
        transform: `rotate(${obj.rotation}rad)`,
        transformOrigin: "center",
        zIndex: 50,
      }}
    />
  );
});
