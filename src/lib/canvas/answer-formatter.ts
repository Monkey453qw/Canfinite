/**
 * Format math answers into simpler, more readable forms.
 *
 * Also converts LaTeX notation (\pm, \sqrt{}, \frac{}{}, etc.) to clean
 * Unicode symbols (±, √, /, etc.) so answers are readable on the canvas.
 *
 * Examples:
 *   100         → "10²"
 *   300000000   → "3 × 10⁸"
 *   0.5         → "1/2"
 *   9.43398...  → "√89"
 *   \pm 3       → "± 3"
 *   \sqrt{88}   → "√88"
 *   \frac{1}{2} → "1/2"
 *   \times      → "×"
 *
 * The formatter checks for common patterns and converts them to
 * more elegant notation. Falls back to the original if no pattern matches.
 */

/**
 * Convert LaTeX math notation to simple Unicode symbols.
 * Handles: \pm, \sqrt{}, \frac{}{}, \times, \div, \cdot, \leq, \geq, \neq,
 * \approx, \pm, \mp, \infty, Greek letters, and other common LaTeX commands.
 */
export function latexToUnicode(text: string): string {
  let result = text;

  // \frac{a}{b} → a/b
  result = result.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2");
  // \sqrt{n} → √n
  result = result.replace(/\\sqrt\{([^{}]+)\}/g, "√$1");
  // \sqrt n → √n (without braces)
  result = result.replace(/\\sqrt\s+(\S)/g, "√$1");
  // \pm → ±
  result = result.replace(/\\pm\b/g, "±");
  // \mp → ∓
  result = result.replace(/\\mp\b/g, "∓");
  // \times → ×
  result = result.replace(/\\times\b/g, "×");
  // \div → ÷
  result = result.replace(/\\div\b/g, "÷");
  // \cdot → ·
  result = result.replace(/\\cdot\b/g, "·");
  // \leq → ≤
  result = result.replace(/\\leq\b/g, "≤");
  // \le → ≤
  result = result.replace(/\\le\b/g, "≤");
  // \geq → ≥
  result = result.replace(/\\geq\b/g, "≥");
  // \ge → ≥
  result = result.replace(/\\ge\b/g, "≥");
  // \neq → ≠
  result = result.replace(/\\neq\b/g, "≠");
  // \ne → ≠
  result = result.replace(/\\ne\b/g, "≠");
  // \approx → ≈
  result = result.replace(/\\approx\b/g, "≈");
  // \sim → ~
  result = result.replace(/\\sim\b/g, "~");
  // \equiv → ≡
  result = result.replace(/\\equiv\b/g, "≡");
  // \propto → ∝
  result = result.replace(/\\propto\b/g, "∝");
  // \infty → ∞
  result = result.replace(/\\infty\b/g, "∞");
  // \sum → Σ
  result = result.replace(/\\sum\b/g, "Σ");
  // \prod → Π
  result = result.replace(/\\prod\b/g, "Π");
  // \int → ∫
  result = result.replace(/\\int\b/g, "∫");
  // \partial → ∂
  result = result.replace(/\\partial\b/g, "∂");
  // \nabla → ∇
  result = result.replace(/\\nabla\b/g, "∇");
  // \Delta → Δ
  result = result.replace(/\\Delta\b/g, "Δ");
  // \delta → δ
  result = result.replace(/\\delta\b/g, "δ");
  // \pi → π
  result = result.replace(/\\pi\b/g, "π");
  // \theta → θ
  result = result.replace(/\\theta\b/g, "θ");
  // \alpha → α
  result = result.replace(/\\alpha\b/g, "α");
  // \beta → β
  result = result.replace(/\\beta\b/g, "β");
  // \gamma → γ
  result = result.replace(/\\gamma\b/g, "γ");
  // \lambda → λ
  result = result.replace(/\\lambda\b/g, "λ");
  // \mu → μ
  result = result.replace(/\\mu\b/g, "μ");
  // \rho → ρ
  result = result.replace(/\\rho\b/g, "ρ");
  // \sigma → σ
  result = result.replace(/\\sigma\b/g, "σ");
  // \Sigma → Σ
  result = result.replace(/\\Sigma\b/g, "Σ");
  // \phi → φ
  result = result.replace(/\\phi\b/g, "φ");
  // \omega → ω
  result = result.replace(/\\omega\b/g, "ω");
  // \Omega → Ω
  result = result.replace(/\\Omega\b/g, "Ω");
  // \degree → °
  result = result.replace(/\\degree\b/g, "°");
  // ^{n} → superscript
  result = result.replace(/\^\{([^{}]+)\}/g, (_, expr) => toSuperscript(expr));
  // _{n} → subscript (just keep as-is for now, remove braces)
  result = result.replace(/_\{([^{}]+)\}/g, "_$1");
  // Remove remaining \text{} wrappers
  result = result.replace(/\\text\{([^{}]+)\}/g, "$1");
  // Remove \left and \right
  result = result.replace(/\\left\b/g, "");
  result = result.replace(/\\right\b/g, "");
  // Remove \mathrm{}, \mathbb{}, etc.
  result = result.replace(/\\math(?:rm|bb|bf|it|cal|sf)\{([^{}]+)\}/g, "$1");
  // Remove standalone backslashes for any remaining commands (e.g. \, → space)
  result = result.replace(/\\,/g, " ");
  result = result.replace(/\\;/g, " ");
  result = result.replace(/\\:/g, " ");
  // Remove any remaining unknown \commands
  result = result.replace(/\\[a-zA-Z]+/g, "");

  return result;
}

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "-": "⁻", "+": "⁺",
};

function toSuperscript(n: number | string): string {
  return String(n)
    .split("")
    .map((c) => SUPERSCRIPTS[c] ?? c)
    .join("");
}

/** Try to express a number as 10^n. Returns the exponent if it's a power of 10, else null. */
function asPowerOfTen(n: number): number | null {
  if (n <= 0) return null;
  const log = Math.log10(n);
  if (Number.isInteger(log) && log !== 0) return log;
  return null;
}

/** Try to express a number as k × 10^n where k is a small integer. */
function asScientificNotation(n: number): { coeff: number; exp: number } | null {
  if (n === 0 || !isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs < 1e4 || abs >= 1e20) return null;
  const exp = Math.floor(Math.log10(abs));
  const coeff = n / Math.pow(10, exp);
  // Only use scientific notation if coeff is a clean integer
  if (Number.isInteger(coeff) && Math.abs(coeff) >= 2 && Math.abs(coeff) <= 99 && exp !== 0) {
    return { coeff, exp };
  }
  return null;
}

/** Try to express a decimal as a simple fraction a/b. */
function asFraction(n: number): { num: number; den: number } | null {
  if (!isFinite(n) || n === 0) return null;
  // Try denominators 2..12
  for (let den = 2; den <= 12; den++) {
    const num = n * den;
    if (Number.isInteger(num) && Math.abs(num) <= 100) {
      // Simplify
      const g = gcd(Math.abs(num), den);
      return { num: num / g, den: den / g };
    }
  }
  return null;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Try to express a number as √n where n is a near-integer. */
function asSqrt(n: number): number | null {
  if (n <= 0) return null;
  const sq = n * n;
  // Check if the original was sqrt of a clean integer
  // i.e., is n² close to an integer?
  const rounded = Math.round(sq);
  if (Math.abs(sq - rounded) < 1e-6 && rounded !== sq) {
    // n is approximately sqrt(rounded) — but only useful if n isn't itself an integer
    if (!Number.isInteger(n)) return rounded;
  }
  return null;
}

/**
 * Format a single numeric answer into simpler notation.
 * Returns the formatted string, or null if no simplification applies.
 */
function formatNumber(n: number): string | null {
  // π
  if (Math.abs(n - Math.PI) < 1e-6) return "π";
  // e
  if (Math.abs(n - Math.E) < 1e-6) return "e";

  // Power of 10: 100 → 10², 1000000 → 10⁶
  const pow10 = asPowerOfTen(n);
  if (pow10 !== null) return `10${toSuperscript(pow10)}`;

  // Scientific notation: 300000000 → 3 × 10⁸
  const sci = asScientificNotation(n);
  if (sci) return `${sci.coeff} × 10${toSuperscript(sci.exp)}`;

  // Fraction: 0.5 → 1/2, 0.25 → 1/4, 0.333... → 1/3
  if (!Number.isInteger(n) && Math.abs(n) < 100) {
    const frac = asFraction(n);
    if (frac && frac.den > 1) return `${frac.num}/${frac.den}`;
  }

  // Square root: if the AI returned a decimal that's √integer
  const sqrt = asSqrt(n);
  if (sqrt !== null) return `√${sqrt}`;

  return null;
}

/**
 * Main entry point: format an answer string into simpler notation.
 * Handles strings like "100", "300000000", "0.5", "x = 3", "9.433981132056603", etc.
 */
export function formatAnswer(answer: string): string {
  if (!answer) return answer;
  // First, convert any LaTeX notation to Unicode symbols
  const deLatexified = latexToUnicode(answer);
  const trimmed = deLatexified.trim();

  // Try to parse as a pure number
  const num = Number(trimmed);
  if (!isNaN(num) && isFinite(num) && trimmed !== "") {
    const formatted = formatNumber(num);
    if (formatted) return formatted;
    // Round long decimals
    if (!Number.isInteger(num) && trimmed.length > 8) {
      return parseFloat(num.toPrecision(8)).toString();
    }
    return trimmed;
  }

  // Handle "x = <number>" or "answer = <number>" patterns
  const eqMatch = trimmed.match(/^(.+?)\s*=\s*(.+)$/);
  if (eqMatch) {
    const prefix = eqMatch[1].trim();
    const value = eqMatch[2].trim();
    const numVal = Number(value);
    if (!isNaN(numVal) && isFinite(numVal)) {
      const formatted = formatNumber(numVal);
      if (formatted) return `${prefix} = ${formatted}`;
      if (!Number.isInteger(numVal) && value.length > 8) {
        return `${prefix} = ${parseFloat(numVal.toPrecision(8))}`;
      }
    }
    // Handle "x = ±3" or "x = 3 or x = -3"
    return trimmed;
  }

  // Handle expressions like "3 × 10^8" already in the answer → convert to ³⁰⁸ style
  let result = trimmed;
  // Convert 10^N to 10ᴺ
  result = result.replace(/10\^(\d+)/g, (_, digits) => `10${toSuperscript(digits)}`);
  // Convert 10^(N) to 10ᴺ
  result = result.replace(/10\^\(([^)]+)\)/g, (_, expr) => `10${toSuperscript(expr)}`);
  // Convert sqrt(N) to √N
  result = result.replace(/sqrt\(([^)]+)\)/g, "√$1");
  result = result.replace(/sqrt(\d+(?:\.\d+)?)/g, "√$1");
  // Convert * to × in multiplication contexts
  result = result.replace(/(\d)\s*\*\s*(\d)/g, "$1 × $2");
  // Convert ^N to ᴺ (general superscript)
  result = result.replace(/\^(\d+)/g, (_, digits) => toSuperscript(digits));

  return result;
}
