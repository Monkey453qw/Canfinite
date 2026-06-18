"use client";

/**
 * MathSolver — floating panel for AI-powered problem solving.
 *
 * Features:
 *   - Type or paste a problem
 *   - Solve via /api/math-solve
 *   - Show steps, formulas, explanation, final answer
 *   - "Place on canvas" creates a SolverBox at viewport center
 *   - Constants & unit conversion quick-reference panels
 *   - If a canvas object is selected, its content is auto-filled as context
 */

import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Sigma,
  Send,
  Loader2,
  Sparkles,
  BookMarked,
  Ruler,
  Plus,
  Search,
} from "lucide-react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SCIENTIFIC_CONSTANTS,
  UNIT_CATEGORIES,
  convertUnit,
} from "@/lib/canvas/constants";
import { latexToUnicode } from "@/lib/canvas/answer-formatter";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SolveResult {
  recognized: string;
  result: string;
  steps: string[];
}

export function MathSolver() {
  const open = useCanvasStore((s) => s.mathSolverOpen);
  const toggle = useCanvasStore((s) => s.toggleMathSolver);
  const selection = useCanvasStore((s) => s.selection);
  const objects = useCanvasStore((s) => s.objects);
  const viewport = useCanvasStore((s) => s.viewport);
  const addSolverBox = useCanvasStore((s) => s.addSolverBox);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [constantSearch, setConstantSearch] = useState("");
  const lastSelectionRef = useRef<string[]>([]);

  // If user opened the solver with a selection, prefill from selected text
  useEffect(() => {
    if (!open) return;
    const selIds = selection.ids;
    const hasNewSelection =
      selIds.length > 0 &&
      selIds.join(",") !== lastSelectionRef.current.join(",");
    if (hasNewSelection) {
      const selObjs = objects.filter((o) => selIds.includes(o.id));
      const text = selObjs
        .map((o) => (o.type === "text" ? o.text : o.type === "solver" ? o.question : ""))
        .filter(Boolean)
        .join("\n");
      if (text.trim()) {
        setInput(text.trim());
      }
    }
    lastSelectionRef.current = selIds;
  }, [open, selection, objects]);

  if (!open) return null;

  // Filter constants by search query (matches symbol, name, or category)
  const searchLower = constantSearch.trim().toLowerCase();
  const filteredConstants = searchLower
    ? SCIENTIFIC_CONSTANTS.filter(
        (c) =>
          c.symbol.toLowerCase().includes(searchLower) ||
          c.name.toLowerCase().includes(searchLower) ||
          c.category.toLowerCase().includes(searchLower),
      )
    : SCIENTIFIC_CONSTANTS;

  const solve = async () => {
    const q = input.trim();
    if (!q) {
      toast.error("Please enter a problem to solve");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/math-solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: q }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: SolveResult = await res.json();
      setResult(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to solve";
      setError(msg);
      toast.error("Solver failed: " + msg);
    } finally {
      setLoading(false);
    }
  };

  const placeOnCanvas = () => {
    if (!result) return;
    // Place at viewport center
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.scale - 160;
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.scale - 100;

    // Store each step as a numbered separate entry (1 step = 1 line)
    // Convert any LaTeX notation to Unicode symbols (±, √, ×, etc.)
    const stepsArray = result.steps.map(
      (s, i) => `${i + 1}. ${latexToUnicode(s)}`,
    );

    // Compute the box height to fit all content with balanced spacing.
    // Layout: 14px top pad + question lines (18px each) + 14px divider gap +
    //         step lines (16px each) + 10px gap + answer (24px) + 18px bottom pad
    // The bottom padding is slightly larger than the top for visual balance
    // (content sits with a comfortable, symmetric-looking margin).
    const questionLines = Math.max(1, Math.ceil(input.trim().length / 35));
    const stepCount = stepsArray.length;
    const answerHeight = 24;
    const height =
      14 +                           // top padding
      questionLines * 18 +           // question
      14 +                           // divider gap
      stepCount * 16 +               // steps (1 line each)
      10 +                           // gap before answer
      answerHeight +                 // answer
      18;                            // bottom padding (slightly larger for symmetry)

    addSolverBox({
      x: cx,
      y: cy,
      width: 320,
      height,
      rotation: 0,
      question: input.trim(),
      answer: result.result,
      steps: stepsArray,
      color: "#5b5bf0",
    });
    toast.success("Solver result placed on canvas");
    toggle();
  };

  const quickExamples = [
    "Solve 3x^2 - 12 = 0",
    "Find the derivative of x^3 * sin(x)",
    "Convert 75 mph to m/s",
    "Kinetic energy of 5 kg at 4 m/s",
    "How many moles in 18 g of H2O?",
    "Integral of x^2 from 0 to 2",
  ];

  return (
    <div className="absolute right-4 top-20 bottom-4 z-40 w-[400px] max-w-[calc(100vw-2rem)] flex flex-col bg-card/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-border/60 overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <Sigma className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold leading-tight">AI Math Solver</h2>
            <p className="text-[10px] text-muted-foreground">Step-by-step solutions</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggle}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="solve" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="grid grid-cols-3 m-2 bg-muted/50">
          <TabsTrigger value="solve" className="text-xs">
            <Sparkles className="h-3 w-3 mr-1" /> Solve
          </TabsTrigger>
          <TabsTrigger value="constants" className="text-xs">
            <BookMarked className="h-3 w-3 mr-1" /> Constants
          </TabsTrigger>
          <TabsTrigger value="units" className="text-xs">
            <Ruler className="h-3 w-3 mr-1" /> Units
          </TabsTrigger>
        </TabsList>

        {/* ---- Solve Tab ---- */}
        <TabsContent value="solve" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full px-3 pb-3 min-h-0">
            <div className="pt-2 pb-2 flex flex-col gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type or paste a problem...  e.g. solve 2x + 5 = 13"
                className="min-h-[100px] resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    solve();
                  }
                }}
              />
              <div className="flex flex-wrap gap-1">
                {quickExamples.map((ex) => (
                  <button
                    key={ex}
                    className="text-[10px] px-2 py-1 rounded-full bg-muted hover:bg-accent transition-colors"
                    onClick={() => setInput(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <Button onClick={solve} disabled={loading} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Solving...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Solve
                  </>
                )}
              </Button>
            </div>

            {error && (
              <div className="text-sm text-destructive p-3 rounded-lg bg-destructive/10 mt-2">
                {error}
              </div>
            )}
            {result && (
              <div className="space-y-3 pt-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Question
                </div>
                <div className="text-sm bg-muted/50 p-3 rounded-lg">{input}</div>

                {result.recognized && result.recognized !== input && (
                  <>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                      Recognized
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{latexToUnicode(result.recognized)}</div>
                  </>
                )}

                {result.steps.length > 0 && (
                  <>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                      Steps
                    </div>
                    <ol className="space-y-2">
                      {result.steps.map((s, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          <span className="leading-snug">{latexToUnicode(s)}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}

                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Answer
                </div>
                <div className="text-base font-bold p-3 rounded-lg bg-primary text-primary-foreground">
                  {latexToUnicode(result.result)}
                </div>

                <Button variant="outline" className="w-full" onClick={placeOnCanvas}>
                  <Plus className="h-4 w-4 mr-2" />
                  Place on canvas
                </Button>
              </div>
            )}
            {!result && !error && !loading && (
              <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 pt-12">
                <Sigma className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm font-medium mb-1">AI-Powered Solver</p>
                <p className="text-xs">
                  Solves arithmetic, algebra, calculus, physics, chemistry, and more —
                  with full step-by-step explanations.
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* ---- Constants Tab ---- */}
        <TabsContent value="constants" className="flex-1 overflow-hidden mt-0 flex flex-col">
          {/* Search bar */}
          <div className="px-3 pt-2 pb-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={constantSearch}
                onChange={(e) => setConstantSearch(e.target.value)}
                placeholder="Search constants by name, symbol, or category..."
                className="w-full h-9 pl-8 pr-3 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {constantSearch && (
                <button
                  onClick={() => setConstantSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <ScrollArea className="flex-1 px-3 pb-3 min-h-0">
            <div className="text-xs text-muted-foreground py-1">
              {constantSearch
                ? `${filteredConstants.length} result${filteredConstants.length !== 1 ? "s" : ""}. Tap to insert.`
                : "Built-in scientific constants. Tap to insert into the solver."}
            </div>
            {(constantSearch
              ? // When searching, show all matches in a single flat list
                [{ cat: "results", items: filteredConstants }]
              : // Otherwise, group by category
                (["math", "universal", "physics", "chemistry", "astronomy"] as const)
                  .map((cat) => ({
                    cat,
                    items: SCIENTIFIC_CONSTANTS.filter((c) => c.category === cat),
                  }))
                  .filter((g) => g.items.length > 0)
            ).map((group) => (
              <div key={group.cat} className="mb-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                  {group.cat}
                </div>
                <div className="space-y-1">
                  {group.items.map((c) => (
                    <button
                      key={c.symbol + c.name}
                      onClick={() => setInput((s) => `${s} ${c.symbol} `.trimStart())}
                      className="w-full flex items-center justify-between text-xs p-2 rounded-md hover:bg-accent transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-mono font-semibold">{c.symbol}</span>
                        <span className="text-muted-foreground ml-2">{c.name}</span>
                      </div>
                      <span className="font-mono text-muted-foreground text-right ml-2">
                        {isNaN(c.value) ? "—" : formatNumber(c.value)} {c.unit}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {constantSearch && filteredConstants.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-8">
                No constants found for "{constantSearch}"
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* ---- Units Tab ---- */}
        <TabsContent value="units" className="flex-1 overflow-hidden mt-0">
          <UnitConverter />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e6 || abs < 1e-3) return n.toExponential(6);
  return Number(n.toPrecision(8)).toString();
}

// ----------------- Unit Converter -----------------
function UnitConverter() {
  const [categoryName, setCategoryName] = useState(UNIT_CATEGORIES[0].name);
  const [fromUnit, setFromUnit] = useState(UNIT_CATEGORIES[0].units[0].symbol);
  const [toUnit, setToUnit] = useState(UNIT_CATEGORIES[0].units[1].symbol);
  const [value, setValue] = useState("1");

  const category = UNIT_CATEGORIES.find((c) => c.name === categoryName)!;
  const numValue = parseFloat(value) || 0;
  const result = convertUnit(numValue, fromUnit, toUnit, categoryName);

  return (
    <ScrollArea className="h-full px-3 pb-3">
      <div className="text-xs text-muted-foreground py-2">
        Convert between units. Updates live.
      </div>

      {/* Category */}
      <div className="mb-3">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5 block">
          Category
        </label>
        <Select
          value={categoryName}
          onValueChange={(v) => {
            const cat = UNIT_CATEGORIES.find((c) => c.name === v)!;
            setCategoryName(cat.name);
            setFromUnit(cat.units[0].symbol);
            setToUnit(cat.units[1].symbol);
          }}
        >
          <SelectTrigger className="w-full h-9 rounded-lg text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNIT_CATEGORIES.map((c) => (
              <SelectItem key={c.name} value={c.name} className="text-sm">
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* From / To */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5 block">
            From
          </label>
          <Select value={fromUnit} onValueChange={setFromUnit}>
            <SelectTrigger className="w-full h-9 rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {category.units.map((u) => (
                <SelectItem key={u.symbol} value={u.symbol} className="text-sm">
                  {u.name} ({u.symbol})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5 block">
            To
          </label>
          <Select value={toUnit} onValueChange={setToUnit}>
            <SelectTrigger className="w-full h-9 rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {category.units.map((u) => (
                <SelectItem key={u.symbol} value={u.symbol} className="text-sm">
                  {u.name} ({u.symbol})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Value */}
      <div className="mb-3">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5 block">
          Value
        </label>
        <input
          type="number"
          className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>

      {/* Result */}
      <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
          Result
        </div>
        <div className="font-mono text-sm break-all">
          {numValue} {fromUnit} = <span className="font-bold text-primary">{formatNumber(result)}</span> {toUnit}
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full mt-3 rounded-full"
        onClick={() => {
          const expr = `${numValue} ${fromUnit} = ${formatNumber(result)} ${toUnit}`;
          useCanvasStore.getState().addText({
            x: (window.innerWidth / 2 - useCanvasStore.getState().viewport.x) /
              useCanvasStore.getState().viewport.scale -
              100,
            y: (window.innerHeight / 2 - useCanvasStore.getState().viewport.y) /
              useCanvasStore.getState().viewport.scale -
              24,
          });
          setTimeout(() => {
            const store = useCanvasStore.getState();
            const id = store.editingTextId;
            if (id) store.updateText(id, { text: expr, width: 280 });
          }, 50);
        }}
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" /> Place result on canvas
      </Button>
    </ScrollArea>
  );
}
