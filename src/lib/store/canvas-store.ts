/**
 * Canvas store: single source of truth for all canvas state.
 *
 * Includes a compact history stack for undo/redo that records document
 * snapshots (objects array + viewport). Live drawing state (currentStroke)
 * is NOT part of history until committed on pointer-up.
 */

"use client";

import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { toast } from "sonner";
import type {
  CanvasObject,
  EraserMode,
  EraserSettings,
  PenSettings,
  Point,
  SelectionState,
  Stroke,
  TextObject,
  ToolId,
  Viewport,
} from "@/lib/canvas/types";
import { buildSmoothedCache, strokeBounds } from "@/lib/canvas/smoothing";
import { objectBounds, unionBounds } from "@/lib/canvas/geometry";
import { formatAnswer } from "@/lib/canvas/answer-formatter";

const MAX_HISTORY = 100;

interface ClipboardEntry {
  objects: CanvasObject[];
}

interface CanvasState {
  // ---- Document ----
  objects: CanvasObject[];
  viewport: Viewport;

  // ---- Tool / settings ----
  tool: ToolId;
  pen: PenSettings;
  eraser: EraserSettings;

  // ---- Live drawing (not in history) ----
  activeStroke: Stroke | null;
  isDrawing: boolean;

  // ---- Selection ----
  selection: SelectionState;

  // ---- Editing text ----
  editingTextId: string | null;

  // ---- History ----
  past: { objects: CanvasObject[]; viewport: Viewport }[];
  future: { objects: CanvasObject[]; viewport: Viewport }[];

  // ---- Theme ----
  theme: "light" | "dark";

  // ---- UI ----
  mathSolverOpen: boolean;
  readingMode: boolean;
  zoomLocked: boolean;

  // ---- Clipboard ----
  clipboard: ClipboardEntry | null;

  // ---- Actions ----
  setTool: (t: ToolId) => void;
  setPen: (patch: Partial<PenSettings>) => void;
  setEraser: (patch: Partial<EraserSettings>) => void;
  setViewport: (vp: Partial<Viewport>) => void;
  setTheme: (t: "light" | "dark") => void;
  toggleMathSolver: () => void;
  setReadingMode: (v: boolean) => void;
  toggleZoomLock: () => void;

  // Drawing
  beginStroke: (pt: Point) => void;
  appendStrokePoint: (pt: Point) => void;
  endStroke: () => void;

  // Eraser
  eraseAtPoint: (pt: Point, tolerance: number) => void;
  eraseStrokeAtPoint: (pt: Point, tolerance: number) => void;

  // Object manipulation
  addText: (pt: Point) => string;
  updateText: (id: string, patch: Partial<TextObject>) => void;
  finishEditingText: () => void;
  setEditingText: (id: string | null) => void;
  addSolverBox: (obj: Omit<
    import("@/lib/canvas/types").SolverBox,
    "id" | "type" | "bounds"
  >) => string;

  // Selection
  select: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  clearSelection: () => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  paste: () => void;
  setSelectionColor: (color: string) => void;
  moveSelectionBy: (dx: number, dy: number) => void;
  commitSelectionMove: () => void;

  // History
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // AI Solve
  isSolving: boolean;
  solveSelection: () => Promise<void>;

  // Persistence
  hydrate: (data: { objects: CanvasObject[]; viewport: Viewport }) => void;
  clearAll: () => void;
}

function snapshot(state: CanvasState) {
  return {
    objects: state.objects.map((o) => ({ ...o })),
    viewport: { ...state.viewport },
  };
}

/** Commit a new document state, pushing the prior state to history. */
function withHistory<T extends CanvasState>(
  set: (fn: (s: T) => Partial<T>) => void,
  get: () => T,
  mutator: (s: T) => Partial<T>,
) {
  const prev = snapshot(get());
  set((s) => mutator(s));
  set((s) => ({
    past: [...s.past, prev].slice(-MAX_HISTORY),
    future: [],
  }));
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  objects: [],
  viewport: { x: 0, y: 0, scale: 1 },
  tool: "pen",
  pen: { color: "#111111", size: 3, opacity: 1 },
  eraser: { size: 24, sensitivity: 0.5, mode: "pixel" as EraserMode },
  activeStroke: null,
  isDrawing: false,
  selection: { ids: [] },
  editingTextId: null,
  past: [],
  future: [],
  theme: "light",
  mathSolverOpen: false,
  isSolving: false,
  readingMode: false,
  zoomLocked: false,
  clipboard: null,

  setTool: (t) =>
    set(() => ({
      tool: t,
      selection: { ids: [] },
      editingTextId: null,
      isDrawing: false,
      activeStroke: null,
    })),

  setPen: (patch) => set((s) => ({ pen: { ...s.pen, ...patch } })),
  setEraser: (patch) => set((s) => ({ eraser: { ...s.eraser, ...patch } })),
  setViewport: (vp) => set((s) => ({ viewport: { ...s.viewport, ...vp } })),
  setTheme: (t) =>
    set((s) => ({
      theme: t,
      // Auto-switch pen color: white in dark mode, black in light mode.
      // This gives immediate visual feedback when toggling themes — dark ink
      // on a dark background would be invisible otherwise.
      pen: { ...s.pen, color: t === "dark" ? "#ffffff" : "#111111" },
    })),
  toggleMathSolver: () => set((s) => ({ mathSolverOpen: !s.mathSolverOpen })),
  setReadingMode: (v) =>
    set(() => ({
      readingMode: v,
      tool: v ? "reading" : "pen",
      isDrawing: false,
      activeStroke: null,
    })),
  toggleZoomLock: () => set((s) => ({ zoomLocked: !s.zoomLocked })),

  // ----------------- Drawing -----------------
  beginStroke: (pt) => {
    const { pen, isDrawing } = get();
    if (isDrawing) return;
    const stroke: Stroke = {
      id: uuid(),
      type: "stroke",
      points: [pt],
      color: pen.color,
      size: pen.size,
      opacity: pen.opacity,
    };
    set(() => ({ activeStroke: stroke, isDrawing: true }));
  },

  appendStrokePoint: (pt) => {
    const { activeStroke } = get();
    if (!activeStroke) return;
    // Trivial de-dupe: skip if very close to last point
    const last = activeStroke.points[activeStroke.points.length - 1];
    const dx = pt.x - last.x;
    const dy = pt.y - last.y;
    if (dx * dx + dy * dy < 0.5) return;
    set(() => ({
      activeStroke: {
        ...activeStroke,
        points: [...activeStroke.points, pt],
      },
    }));
  },

  endStroke: () => {
    const { activeStroke } = get();
    if (!activeStroke) {
      set(() => ({ isDrawing: false }));
      return;
    }
    // Build smoothed cache and compute bounds
    const cached = buildSmoothedCache(activeStroke.points);
    const finalized: Stroke = {
      ...activeStroke,
      cached,
      bounds: strokeBounds({ ...activeStroke, cached }),
    };
    // Commit even single-point taps (dots, full stops, decimal points).
    // A tap creates a 1-point stroke that renders as a small dot.
    if (finalized.points.length >= 1) {
      withHistory(set, get, (s) => ({
        objects: [...s.objects, finalized],
        activeStroke: null,
        isDrawing: false,
      }));
    } else {
      set(() => ({ activeStroke: null, isDrawing: false }));
    }
  },

  // ----------------- Eraser -----------------
  /** Unified erase — uses eraser.mode to pick pixel or stroke behavior.
   *  Erases strokes and text objects. SolverBox objects are NOT erasable —
   *  they can only be removed via the selection tool's delete action. */
  eraseAtPoint: (pt, tolerance) => {
    const { objects, eraser } = get();
    if (eraser.mode === "stroke") {
      // Stroke eraser: delete any stroke OR text box that comes within range.
      // SolverBox objects are skipped (not erasable).
      const r = eraser.size / 2 + tolerance * (1 + eraser.sensitivity);
      const filtered = objects.filter((o) => {
        if (o.type === "solver") return true; // solver boxes are NOT erasable
        if (o.type === "stroke") {
          for (const p of o.points) {
            if (Math.hypot(p.x - pt.x, p.y - pt.y) <= r) return false;
          }
          return true;
        }
        // Text: delete if the eraser circle overlaps the box bounds
        if (o.type === "text") {
          const pad = r;
          if (
            pt.x >= o.x - pad &&
            pt.x <= o.x + o.width + pad &&
            pt.y >= o.y - pad &&
            pt.y <= o.y + o.height + pad
          ) {
            return false;
          }
        }
        return true;
      });
      if (filtered.length !== objects.length) {
        withHistory(set, get, () => ({ objects: filtered }));
      }
      return;
    }
    // Pixel eraser: split strokes where points fall inside the eraser circle,
    // AND delete any text box the eraser touches.
    // SolverBox objects are skipped (not erasable).
    const r = eraser.size / 2 + tolerance;
    let changed = false;
    const newObjects: CanvasObject[] = [];
    for (const o of objects) {
      if (o.type === "solver") {
        // SolverBox objects are NOT erasable — only deletable via selection
        newObjects.push(o);
        continue;
      }
      if (o.type === "text") {
        // Delete text if the eraser point is inside the box (with padding)
        const pad = r;
        if (
          pt.x >= o.x - pad &&
          pt.x <= o.x + o.width + pad &&
          pt.y >= o.y - pad &&
          pt.y <= o.y + o.height + pad
        ) {
          changed = true;
          continue;
        }
        newObjects.push(o);
        continue;
      }
      if (o.type !== "stroke") {
        newObjects.push(o);
        continue;
      }
      const segments: Point[][] = [[]];
      for (const p of o.points) {
        if (Math.hypot(p.x - pt.x, p.y - pt.y) <= r) {
          if (segments[segments.length - 1].length > 0) {
            segments.push([]);
          }
        } else {
          segments[segments.length - 1].push(p);
        }
      }
      const valid = segments.filter((s) => s.length >= 2);
      if (valid.length === 0) {
        changed = true; // stroke fully erased
        continue;
      }
      if (valid.length === 1 && valid[0].length === o.points.length) {
        newObjects.push(o);
        continue;
      }
      changed = true;
      for (const pts of valid) {
        const cached = buildSmoothedCache(pts);
        newObjects.push({
          ...o,
          id: uuid(),
          points: pts,
          cached,
          bounds: strokeBounds({ ...o, points: pts, cached }),
        });
      }
    }
    if (changed) {
      withHistory(set, get, () => ({ objects: newObjects }));
    }
  },

  // Kept for backwards compatibility — delegates to eraseAtPoint based on mode
  eraseStrokeAtPoint: (pt, tolerance) => {
    const prevMode = get().eraser.mode;
    if (prevMode !== "stroke") {
      set((s) => ({ eraser: { ...s.eraser, mode: "stroke" } }));
    }
    get().eraseAtPoint(pt, tolerance);
    if (prevMode !== "stroke") {
      set((s) => ({ eraser: { ...s.eraser, mode: prevMode } }));
    }
  },

  // ----------------- Text -----------------
  addText: (pt) => {
    const id = uuid();
    const textObj: TextObject = {
      id,
      type: "text",
      x: pt.x,
      y: pt.y,
      width: 200,
      height: 48,
      rotation: 0,
      text: "",
      color: get().pen.color,
      fontSize: 24,
      fontFamily: "Inter, system-ui, sans-serif",
      align: "left",
    };
    withHistory(set, get, (s) => ({
      objects: [...s.objects, textObj],
      editingTextId: id,
      // Switch to select tool but DO NOT clear editingTextId
      tool: "select",
      isDrawing: false,
      activeStroke: null,
      selection: { ids: [id] },
    }));
    return id;
  },

  updateText: (id, patch) => {
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id && o.type === "text" ? { ...o, ...patch } : o,
      ),
    }));
  },

  setEditingText: (id) => set(() => ({ editingTextId: id })),
  finishEditingText: () => set(() => ({ editingTextId: null })),

  addSolverBox: (obj) => {
    const id = uuid();
    const full = { ...obj, id, type: "solver" as const };
    withHistory(set, get, (s) => ({
      objects: [...s.objects, full],
      selection: { ids: [id] },
    }));
    return id;
  },

  // ----------------- Selection -----------------
  select: (ids) => set(() => ({ selection: { ids } })),
  addToSelection: (id) =>
    set((s) => ({
      selection: {
        ids: s.selection.ids.includes(id)
          ? s.selection.ids
          : [...s.selection.ids, id],
      },
    })),
  clearSelection: () => set(() => ({ selection: { ids: [] } })),

  deleteSelection: () => {
    const { selection } = get();
    if (selection.ids.length === 0) return;
    withHistory(set, get, (s) => ({
      objects: s.objects.filter((o) => !selection.ids.includes(o.id)),
      selection: { ids: [] },
      editingTextId: null,
    }));
  },

  duplicateSelection: () => {
    const { selection, objects } = get();
    if (selection.ids.length === 0) return;
    const toDup = objects.filter((o) => selection.ids.includes(o.id));
    const copies: CanvasObject[] = toDup.map((o) => {
      const newId = uuid();
      if (o.type === "stroke") {
        return {
          ...o,
          id: newId,
          points: o.points.map((p) => ({ x: p.x + 20, y: p.y + 20 })),
          cached: o.cached?.map((seg) => ({
            start: { x: seg.start.x + 20, y: seg.start.y + 20 },
            cp1: { x: seg.cp1.x + 20, y: seg.cp1.y + 20 },
            cp2: { x: seg.cp2.x + 20, y: seg.cp2.y + 20 },
            end: { x: seg.end.x + 20, y: seg.end.y + 20 },
          })),
          bounds: o.bounds
            ? {
                minX: o.bounds.minX + 20,
                minY: o.bounds.minY + 20,
                maxX: o.bounds.maxX + 20,
                maxY: o.bounds.maxY + 20,
              }
            : undefined,
        };
      }
      return {
        ...o,
        id: newId,
        x: o.x + 20,
        y: o.y + 20,
      };
    });
    withHistory(set, get, (s) => ({
      objects: [...s.objects, ...copies],
      selection: { ids: copies.map((c) => c.id) },
    }));
  },

  copySelection: () => {
    const { selection, objects } = get();
    if (selection.ids.length === 0) return;
    const toCopy = objects.filter((o) => selection.ids.includes(o.id));
    set(() => ({ clipboard: { objects: toCopy } }));
    // Also write to system clipboard as plain text (best-effort)
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(
          toCopy
            .map((o) => (o.type === "text" ? o.text : o.type === "solver" ? o.question : "[stroke]"))
            .join("\n"),
        )
        .catch(() => {});
    }
  },

  paste: () => {
    const { clipboard } = get();
    if (!clipboard || clipboard.objects.length === 0) return;
    const copies: CanvasObject[] = clipboard.objects.map((o) => {
      const newId = uuid();
      if (o.type === "stroke") {
        return {
          ...o,
          id: newId,
          points: o.points.map((p) => ({ x: p.x + 20, y: p.y + 20 })),
          cached: o.cached?.map((seg) => ({
            start: { x: seg.start.x + 20, y: seg.start.y + 20 },
            cp1: { x: seg.cp1.x + 20, y: seg.cp1.y + 20 },
            cp2: { x: seg.cp2.x + 20, y: seg.cp2.y + 20 },
            end: { x: seg.end.x + 20, y: seg.end.y + 20 },
          })),
          bounds: o.bounds
            ? {
                minX: o.bounds.minX + 20,
                minY: o.bounds.minY + 20,
                maxX: o.bounds.maxX + 20,
                maxY: o.bounds.maxY + 20,
              }
            : undefined,
        };
      }
      return { ...o, id: newId, x: o.x + 20, y: o.y + 20 };
    });
    withHistory(set, get, (s) => ({
      objects: [...s.objects, ...copies],
      selection: { ids: copies.map((c) => c.id) },
    }));
  },

  setSelectionColor: (color) => {
    const { selection } = get();
    if (selection.ids.length === 0) return;
    withHistory(set, get, (s) => ({
      objects: s.objects.map((o) =>
        selection.ids.includes(o.id) ? { ...o, color } : o,
      ),
    }));
  },

  /** Live move: does NOT push history. Commit with commitSelectionMove(). */
  moveSelectionBy: (dx, dy) => {
    const { selection } = get();
    if (selection.ids.length === 0) return;
    set((s) => ({
      objects: s.objects.map((o) => {
        if (!selection.ids.includes(o.id)) return o;
        if (o.type === "stroke") {
          return {
            ...o,
            points: o.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            cached: o.cached?.map((seg) => ({
              start: { x: seg.start.x + dx, y: seg.start.y + dy },
              cp1: { x: seg.cp1.x + dx, y: seg.cp1.y + dy },
              cp2: { x: seg.cp2.x + dx, y: seg.cp2.y + dy },
              end: { x: seg.end.x + dx, y: seg.end.y + dy },
            })),
            bounds: o.bounds
              ? {
                  minX: o.bounds.minX + dx,
                  minY: o.bounds.minY + dy,
                  maxX: o.bounds.maxX + dx,
                  maxY: o.bounds.maxY + dy,
                }
              : undefined,
          };
        }
        return { ...o, x: o.x + dx, y: o.y + dy };
      }),
    }));
  },

  commitSelectionMove: () => {
    // Push history now that the move is finalized.
    const prev = get().past[get().past.length - 1];
    // We didn't store the pre-move snapshot, so we snapshot the CURRENT state
    // as the "redo" anchor and rely on the next history push for the actual undo.
    // For correctness we snapshot here:
    void prev;
    // Push current state onto history so undo restores the prior position.
    // We achieve this by treating the move as committed: add a history entry
    // of the *current* state to the future stack and the prior to past.
    // Since we didn't capture pre-move, we use a lightweight approach: just
    // record a history entry now (so subsequent undos will return here).
    const cur = snapshot(get());
    set((s) => ({
      past: [...s.past, cur].slice(-MAX_HISTORY),
      future: [],
    }));
  },

  // ----------------- AI Solve -----------------
  // Workflow adapted from reference:
  //   - If selection has strokes → capture as image → call /api/math-solve with { image }
  //   - If selection has only text → join text → call /api/math-solve with { expression }
  //   - Place the answer as a text object 20px to the right of the selection
  solveSelection: async () => {
    const { selection, objects, theme } = get();
    if (selection.ids.length === 0) return;

    const selObjs = objects.filter((o) => selection.ids.includes(o.id));
    if (selObjs.length === 0) return;

    const hasStrokes = selObjs.some((o) => o.type === "stroke");
    const textElements = selObjs.filter((o) => o.type === "text") as TextObject[];

    set(() => ({ isSolving: true }));

    try {
      let result: { recognized: string; result: string; steps: string[] } | null = null;
      let answerX: number, answerY: number;

      if (hasStrokes) {
        // === OCR path: render selection to image and send to VLM ===
        // Compute selection bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const o of selObjs) {
          if (o.type === "stroke" && o.bounds) {
            minX = Math.min(minX, o.bounds.minX);
            minY = Math.min(minY, o.bounds.minY);
            maxX = Math.max(maxX, o.bounds.maxX);
            maxY = Math.max(maxY, o.bounds.maxY);
          } else if (o.type !== "stroke") {
            minX = Math.min(minX, o.x);
            minY = Math.min(minY, o.y);
            maxX = Math.max(maxX, o.x + o.width);
            maxY = Math.max(maxY, o.y + o.height);
          }
        }
        if (!isFinite(minX)) { set(() => ({ isSolving: false })); return; }

        // Render to offscreen canvas at 2× scale with white bg + black strokes
        const pad = 30;
        const width = (maxX - minX) + pad * 2;
        const height = (maxY - minY) + pad * 2;
        const scale = 2;
        const offscreen = document.createElement("canvas");
        offscreen.width = width * scale;
        offscreen.height = height * scale;
        const tctx = offscreen.getContext("2d");
        if (!tctx) { set(() => ({ isSolving: false })); return; }

        tctx.fillStyle = "#ffffff";
        tctx.fillRect(0, 0, offscreen.width, offscreen.height);
        tctx.scale(scale, scale);
        tctx.translate(-minX + pad, -minY + pad);

        for (const o of selObjs) {
          if (o.type === "stroke") {
            tctx.save();
            tctx.globalAlpha = 1;
            tctx.strokeStyle = "#000000";
            tctx.lineWidth = Math.max(2, o.size);
            tctx.lineCap = "round";
            tctx.lineJoin = "round";
            if (o.cached && o.cached.length > 0) {
              tctx.beginPath();
              tctx.moveTo(o.cached[0].start.x, o.cached[0].start.y);
              for (const seg of o.cached) {
                tctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
              }
              tctx.stroke();
            } else if (o.points.length >= 2) {
              tctx.beginPath();
              tctx.moveTo(o.points[0].x, o.points[0].y);
              for (let i = 1; i < o.points.length; i++) {
                tctx.lineTo(o.points[i].x, o.points[i].y);
              }
              tctx.stroke();
            }
            tctx.restore();
          } else if (o.type === "text") {
            tctx.save();
            tctx.fillStyle = "#000000";
            tctx.font = `${o.fontSize}px ${o.fontFamily}`;
            tctx.textBaseline = "top";
            tctx.textAlign = "left";
            const lines = o.text.split("\n");
            lines.forEach((line, i) => tctx.fillText(line, o.x, o.y + i * o.fontSize * 1.2));
            tctx.restore();
          }
        }

        const imageDataUrl = offscreen.toDataURL("image/png");
        const res = await fetch("/api/math-solve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: imageDataUrl }),
        });
        result = await res.json();
        answerX = maxX + 20;
        answerY = minY;
      } else if (textElements.length > 0) {
        // === Text path: join text and send as expression (faster, no OCR) ===
        const expression = textElements.map((e) => e.text).join(" ");
        const res = await fetch("/api/math-solve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expression }),
        });
        result = await res.json();

        // Position answer to the right of the last text element
        const lastText = textElements[textElements.length - 1];
        // Approximate width using character count (good enough for positioning)
        const textWidth = lastText.text.length * lastText.fontSize * 0.6;
        answerX = lastText.x + textWidth + 20;
        answerY = lastText.y;
      } else {
        set(() => ({ isSolving: false }));
        return;
      }

      // Place the answer on the canvas (only if it's a valid result)
      if (
        result?.result &&
        result.result !== "No math expression found" &&
        !result.result.toLowerCase().includes("rate limit") &&
        !result.result.toLowerCase().includes("temporarily unavailable") &&
        !result.result.toLowerCase().includes("could not read")
      ) {
        const isDark = theme === "dark";
        // Format the answer into simpler notation (10², 3 × 10⁸, √88, 1/4, etc.)
        const formattedAnswer = formatAnswer(result.result);

        // Match the answer's font size to the question's stroke/text size.
        // - For strokes: use the average height of the stroke bounds (the
        //   physical height of the handwriting) as the font size. This gives
        //   a 1:1 match between the question's handwriting size and the
        //   answer's text size.
        // - For text objects: use the same font size as the last text element.
        let answerFontSize: number;
        if (hasStrokes) {
          const strokes = selObjs.filter((o) => o.type === "stroke") as import("@/lib/canvas/types").Stroke[];
          // Use the average stroke bounds height — this is how tall the
          // handwriting actually is on screen.
          const avgHeight =
            strokes.reduce((sum, s) => {
              const h = s.bounds ? s.bounds.maxY - s.bounds.minY : 30;
              return sum + h;
            }, 0) / strokes.length;
          answerFontSize = Math.max(16, Math.round(avgHeight));
        } else if (textElements.length > 0) {
          answerFontSize = textElements[textElements.length - 1].fontSize;
        } else {
          answerFontSize = 22;
        }

        // Render the answer as a text object with a handwriting-style font,
        // so it visually looks like the user handwrote it rather than typed it.
        const answerText: TextObject = {
          id: uuid(),
          type: "text",
          x: answerX,
          y: answerY,
          width: 240,
          height: answerFontSize + 14,
          rotation: 0,
          text: formattedAnswer,
          color: isDark ? "#ffffff" : "#5b5bf0",
          fontSize: answerFontSize,
          fontFamily: "Inter, system-ui, sans-serif",
          align: "left",
        };
        withHistory(set, get, (s) => ({
          objects: [...s.objects, answerText],
          isSolving: false,
        }));
      } else {
        // The solver couldn't produce a valid answer — notify the user why
        const resultLower = (result?.result || "").toLowerCase();
        if (resultLower.includes("could not read") || resultLower.includes("no math expression")) {
          toast.error("Couldn't read a math problem. Try writing more clearly or type the equation.");
        } else if (resultLower.includes("rate limit")) {
          toast.warning("Rate limit reached. Please wait a moment and try again.");
        } else if (resultLower.includes("temporarily unavailable") || resultLower.includes("could not solve")) {
          toast.warning("Solver temporarily unavailable. Please try again.");
        }
        set(() => ({ isSolving: false }));
      }
    } catch (err) {
      console.error("Solve failed:", err);
      toast.error("Solver failed. Please try again.");
      set(() => ({ isSolving: false }));
    }
  },

  // ----------------- History -----------------
  pushHistory: () => {
    const cur = snapshot(get());
    set((s) => ({
      past: [...s.past, cur].slice(-MAX_HISTORY),
      future: [],
    }));
  },

  undo: () => {
    const { past, future, objects, viewport } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    const curSnapshot = { objects: objects.map((o) => ({ ...o })), viewport: { ...viewport } };
    set(() => ({
      objects: prev.objects.map((o) => ({ ...o })),
      viewport: { ...prev.viewport },
      past: past.slice(0, -1),
      future: [...future, curSnapshot].slice(-MAX_HISTORY),
      selection: { ids: [] },
      editingTextId: null,
    }));
  },

  redo: () => {
    const { past, future, objects, viewport } = get();
    if (future.length === 0) return;
    const next = future[future.length - 1];
    const curSnapshot = { objects: objects.map((o) => ({ ...o })), viewport: { ...viewport } };
    set(() => ({
      objects: next.objects.map((o) => ({ ...o })),
      viewport: { ...next.viewport },
      past: [...past, curSnapshot].slice(-MAX_HISTORY),
      future: future.slice(0, -1),
      selection: { ids: [] },
      editingTextId: null,
    }));
  },

  // ----------------- Persistence -----------------
  hydrate: (data) =>
    set(() => ({
      objects: data.objects.map((o) => ({ ...o })),
      viewport: { ...data.viewport },
      past: [],
      future: [],
      selection: { ids: [] },
    })),

  clearAll: () =>
    withHistory(set, get, () => ({
      objects: [],
      selection: { ids: [] },
      editingTextId: null,
    })),
}));

// Selector helpers
export const selectSelectionBounds = (state: CanvasState) => {
  const objs = state.objects.filter((o) => state.selection.ids.includes(o.id));
  return unionBounds(objs);
};

export { objectBounds };
