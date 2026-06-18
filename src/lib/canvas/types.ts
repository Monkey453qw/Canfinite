/**
 * Core type definitions for the Infinite Canvas application.
 * All coordinates are stored in WORLD space (not screen space).
 * The viewport transform converts world <-> screen.
 */

export type ToolId =
  | "pen"
  | "eraser"
  | "select"
  | "text"
  | "reading";

export type EraserMode = "pixel" | "stroke";

export interface Point {
  x: number;
  y: number;
}

/** A single rendered stroke (vector path). */
export interface Stroke {
  id: string;
  type: "stroke";
  /** Raw sampled points in world coordinates. */
  points: Point[];
  /** Precomputed smoothed Bezier control points for fast rendering. */
  cached?: BezierSegment[];
  color: string;
  size: number; // base stroke width in world units
  opacity: number; // 0..1
  /** Computed bounding box in world coords for fast culling/hit-test. */
  bounds?: Bounds;
}

export interface BezierSegment {
  start: Point;
  cp1: Point;
  cp2: Point;
  end: Point;
}

export interface TextObject {
  id: string;
  type: "text";
  x: number; // top-left in world coords
  y: number;
  width: number; // world units
  height: number; // world units
  rotation: number; // radians
  text: string;
  color: string;
  fontSize: number; // world units
  fontFamily: string;
  align: "left" | "center" | "right";
  bounds?: Bounds;
}

export interface SolverBox {
  id: string;
  type: "solver";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  question: string;
  answer: string;
  steps: string[];
  color: string;
  bounds?: Bounds;
}

export type CanvasObject = Stroke | TextObject | SolverBox;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Viewport transform: world = (screen - translate) / scale */
export interface Viewport {
  x: number; // translation x in screen px
  y: number; // translation y in screen px
  scale: number;
}

export interface PenSettings {
  color: string;
  size: number;
  opacity: number;
}

export interface EraserSettings {
  size: number;
  sensitivity: number; // for stroke eraser
  mode: EraserMode; // pixel | stroke
}

export interface SelectionState {
  ids: string[];
  /** Per-id transform deltas applied during active drag */
  dragOffset?: { dx: number; dy: number };
}
