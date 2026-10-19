import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

const MAX_LENGTH = 500
const MAX_DEPTH = 50

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 }

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x = Number.NaN, digits = 0) => {
    const f = 10 ** Math.trunc(digits)
    return Math.round(x * f) / f
  },
  trunc: Math.trunc,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  hypot: Math.hypot,
}

type Token =
  | { type: 'num'; value: number }
  | { type: 'id'; value: string }
  | { type: 'op'; value: string }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  const re =
    /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(\*\*|[-+*/%^(),]))/y
  let pos = 0
  while (pos < input.length) {
    re.lastIndex = pos
    const m = re.exec(input)
    if (!m) {
      if (input.slice(pos).trim() === '') break
      throw new Error(`Unexpected character "${input.slice(pos).trim()[0]}"`)
    }
    pos = re.lastIndex
    if (m[1] !== undefined) tokens.push({ type: 'num', value: Number(m[1]) })
    else if (m[2] !== undefined) tokens.push({ type: 'id', value: m[2].toLowerCase() })
    else tokens.push({ type: 'op', value: m[3] as string })
  }
  return tokens
}

/**
 * Evaluates an arithmetic expression with a small recursive-descent parser, never `eval`.
 * Supports `+ - * / % ^ **`, parentheses, the constants `pi`, `e` and `tau`, and common functions
 * such as `sqrt`, `round`, `min`, `max`, `log` and `sin`. Numbers are IEEE 754 doubles.
 */
export function evaluate(expression: string): number {
  if (expression.length > MAX_LENGTH)
    throw new Error(`Expression is longer than ${MAX_LENGTH} characters`)
  const tokens = tokenize(expression)
  if (tokens.length === 0) throw new Error('Empty expression')
  let i = 0
  let depth = 0

  const peek = () => tokens[i]
  const isOp = (value: string) => {
    const t = peek()
    return t?.type === 'op' && t.value === value
  }
  const expect = (value: string) => {
    if (!isOp(value)) throw new Error(`Expected "${value}"`)
    i++
  }

  const expr = (): number => {
    let left = term()
    while (isOp('+') || isOp('-')) {
      const op = (tokens[i++] as Token).value
      const right = term()
      left = op === '+' ? left + right : left - right
    }
    return left
  }
  const term = (): number => {
    let left = unary()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (tokens[i++] as Token).value
      const right = unary()
      if (op === '*') left *= right
      else if (right === 0) throw new Error('Division by zero')
      else left = op === '/' ? left / right : left % right
    }
    return left
  }
  const unary = (): number => {
    if (isOp('-')) {
      i++
      return -unary()
    }
    if (isOp('+')) {
      i++
      return unary()
    }
    return power()
  }
  // Right-associative, and binds tighter than unary minus on its left: -2^2 is -4.
  const power = (): number => {
    const base = primary()
    if (isOp('^') || isOp('**')) {
      i++
      return base ** unary()
    }
    return base
  }
  const primary = (): number => {
    if (++depth > MAX_DEPTH) throw new Error('Expression is nested too deeply')
    try {
      const t = tokens[i++]
      if (!t) throw new Error('Unexpected end of expression')
      if (t.type === 'num') return t.value
      if (t.type === 'op' && t.value === '(') {
        const v = expr()
        expect(')')
        return v
      }
      if (t.type === 'id') {
        if (isOp('(')) {
          const fn = FUNCTIONS[t.value]
          if (!fn) throw new Error(`Unknown function "${t.value}"`)
          i++
          const args: number[] = []
          if (!isOp(')')) {
            args.push(expr())
            while (isOp(',')) {
              i++
              args.push(expr())
            }
          }
          expect(')')
          if (args.length === 0) throw new Error(`${t.value}() needs at least one argument`)
          return fn(...args)
        }
        const c = CONSTANTS[t.value]
        if (c === undefined) throw new Error(`Unknown name "${t.value}"`)
        return c
      }
      throw new Error(`Unexpected "${t.value}"`)
    } finally {
      depth--
    }
  }

  const result = expr()
  if (i < tokens.length) throw new Error(`Unexpected "${(tokens[i] as Token).value}"`)
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number')
  return result
}

/**
 * A `calculator` tool for exact arithmetic, which models do badly in their heads. It evaluates an
 * expression with a small parser (no `eval`), so it is safe to run without approval.
 */
export function calculatorTool(): ToolDefinition {
  return defineTool({
    name: 'calculator',
    description:
      'Evaluate an arithmetic expression exactly instead of computing it yourself. Supports + - * / % ^, parentheses, pi, e, and functions like sqrt, round, floor, ceil, abs, min, max, pow, log (base 10), ln, sin, cos, tan. Example: "round(1234.5 * 1.0825, 2)". Results are floating point.',
    input: z.object({ expression: z.string().min(1) }),
    execute: async ({ expression }) => ({ expression, result: evaluate(expression) }),
  })
}
