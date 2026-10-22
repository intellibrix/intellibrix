import { readTextFile, resolveJailed } from '@intellibrix/workspace'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

/**
 * A small jq: enough to pull values out of large JSON without reading it all. Supports paths
 * (`.a.b[0]`, `.[]`, `.[1:3]`, `..`, `?`), pipes, commas, object/array construction, comparison,
 * arithmetic, `and`/`or`/`//`, `if`, and the usual functions (`select`, `map`, `sort_by`,
 * `group_by`, `length`, `keys`, `add`, ...). It has no variables, `reduce`, regexes or I/O, and it
 * stops runaway queries after a step budget.
 */

type Json = unknown
type Node =
  | { t: 'id' }
  | { t: 'recurse' }
  | { t: 'lit'; v: Json }
  | { t: 'field'; of: Node; name: string }
  | { t: 'index'; of: Node; at: Node }
  | { t: 'slice'; of: Node; from?: Node; to?: Node }
  | { t: 'iter'; of: Node }
  | { t: 'try'; of: Node }
  | { t: 'pipe' | 'comma' | 'alt' | 'and' | 'or'; l: Node; r: Node }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'neg'; of: Node }
  | { t: 'array'; of?: Node }
  | { t: 'object'; entries: { key: Node; value: Node }[] }
  | { t: 'if'; cond: Node; then: Node; else?: Node }
  | { t: 'call'; name: string; args: Node[] }

type Tok = { k: 'num' | 'str' | 'id' | 'field' | 'op' | 'end'; v: string | number; pos: number }

const MAX_STEPS = 500_000
const MAX_OUTPUTS = 10_000
const MAX_DEPTH = 64

class QueryError extends Error {}

function lex(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const str = (): string => {
    const start = i
    let out = ''
    i++
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\\') {
        const n = src[i + 1]
        const map: Record<string, string> = {
          n: '\n',
          t: '\t',
          r: '\r',
          '"': '"',
          '\\': '\\',
          '/': '/',
        }
        if (n === 'u') {
          out += String.fromCharCode(Number.parseInt(src.slice(i + 2, i + 6), 16))
          i += 6
          continue
        }
        if (!n || !(n in map)) throw new QueryError(`Bad escape in string at ${i}`)
        out += map[n]
        i += 2
      } else out += src[i++]
    }
    if (src[i] !== '"') throw new QueryError(`Unterminated string starting at ${start}`)
    i++
    return out
  }
  while (i < src.length) {
    const c = src[i] as string
    const pos = i
    if (/\s/.test(c)) {
      i++
    } else if (c === '"') {
      toks.push({ k: 'str', v: str(), pos })
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(src.slice(i)) as RegExpExecArray
      toks.push({ k: 'num', v: Number(m[0]), pos })
      i += m[0].length
    } else if (c === '.' && src[i + 1] === '.') {
      toks.push({ k: 'op', v: '..', pos })
      i += 2
    } else if (c === '.' && /[A-Za-z_]/.test(src[i + 1] ?? '')) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i + 1)) as RegExpExecArray
      toks.push({ k: 'field', v: m[0], pos })
      i += 1 + m[0].length
    } else if (c === '.' && src[i + 1] === '"') {
      i++
      toks.push({ k: 'field', v: str(), pos })
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i)) as RegExpExecArray
      toks.push({ k: 'id', v: m[0], pos })
      i += m[0].length
    } else {
      const two = src.slice(i, i + 2)
      if (['==', '!=', '<=', '>=', '//'].includes(two)) {
        toks.push({ k: 'op', v: two, pos })
        i += 2
      } else if ('.[](){}|,:;?<>+-*/%'.includes(c)) {
        toks.push({ k: 'op', v: c, pos })
        i++
      } else throw new QueryError(`Unexpected "${c}" at ${i}`)
    }
  }
  toks.push({ k: 'end', v: '', pos: src.length })
  return toks
}

function parse(src: string): Node {
  const toks = lex(src)
  let p = 0
  let depth = 0
  const peek = () => toks[p] as Tok
  const isOp = (v: string) => peek().k === 'op' && peek().v === v
  const isId = (v: string) => peek().k === 'id' && peek().v === v
  const fail = (what: string): never => {
    const t = peek()
    throw new QueryError(
      `${what} at position ${t.pos}${t.k === 'end' ? ' (end of query)' : ` near "${t.v}"`}`,
    )
  }
  const eatOp = (v: string) => (isOp(v) ? (p++, true) : false)
  const expectOp = (v: string) => {
    if (!eatOp(v)) fail(`Expected "${v}"`)
  }
  const expectId = (v: string) => {
    if (isId(v)) p++
    else fail(`Expected "${v}"`)
  }

  const pipe = (): Node => {
    if (++depth > MAX_DEPTH) throw new QueryError('Query is nested too deeply')
    try {
      const l = comma()
      return eatOp('|') ? { t: 'pipe', l, r: pipe() } : l
    } finally {
      depth--
    }
  }
  const comma = (): Node => {
    let l = alt()
    while (eatOp(',')) l = { t: 'comma', l, r: alt() }
    return l
  }
  const alt = (): Node => {
    const l = or()
    return eatOp('//') ? { t: 'alt', l, r: alt() } : l
  }
  const or = (): Node => {
    let l = and()
    while (isId('or')) {
      p++
      l = { t: 'or', l, r: and() }
    }
    return l
  }
  const and = (): Node => {
    let l = cmp()
    while (isId('and')) {
      p++
      l = { t: 'and', l, r: cmp() }
    }
    return l
  }
  const cmp = (): Node => {
    const l = add()
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (eatOp(op)) return { t: 'bin', op, l, r: add() }
    }
    return l
  }
  const add = (): Node => {
    let l = mul()
    while (isOp('+') || isOp('-')) {
      const op = peek().v as string
      p++
      l = { t: 'bin', op, l, r: mul() }
    }
    return l
  }
  const mul = (): Node => {
    let l = unary()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = peek().v as string
      p++
      l = { t: 'bin', op, l, r: unary() }
    }
    return l
  }
  const unary = (): Node => (eatOp('-') ? { t: 'neg', of: unary() } : postfix(primary()))

  const postfix = (start: Node): Node => {
    let n = start
    for (;;) {
      if (peek().k === 'field') {
        n = { t: 'field', of: n, name: peek().v as string }
        p++
      } else if (isOp('.') && toks[p + 1]?.k === 'op' && toks[p + 1]?.v === '[') {
        p++
      } else if (isOp('[')) {
        p++
        if (eatOp(']')) n = { t: 'iter', of: n }
        else if (eatOp(':')) {
          const to = pipe()
          expectOp(']')
          n = { t: 'slice', of: n, to }
        } else {
          const at = pipe()
          if (eatOp(':')) {
            const to = isOp(']') ? undefined : pipe()
            expectOp(']')
            n = { t: 'slice', of: n, from: at, to }
          } else {
            expectOp(']')
            n = { t: 'index', of: n, at }
          }
        }
      } else if (eatOp('?')) n = { t: 'try', of: n }
      else return n
    }
  }

  const primary = (): Node => {
    const t = peek()
    if (t.k === 'num') return p++, { t: 'lit', v: t.v }
    if (t.k === 'str') return p++, { t: 'lit', v: t.v }
    if (t.k === 'field') return { t: 'id' } // postfix consumes the field
    if (t.k === 'op') {
      if (t.v === '.') return p++, { t: 'id' }
      if (t.v === '..') return p++, { t: 'recurse' }
      if (t.v === '(') {
        p++
        const inner = pipe()
        expectOp(')')
        return inner
      }
      if (t.v === '[') {
        p++
        if (eatOp(']')) return { t: 'array' }
        const of = pipe()
        expectOp(']')
        return { t: 'array', of }
      }
      if (t.v === '{') return objectLiteral()
    }
    if (t.k === 'id') {
      p++
      if (t.v === 'null') return { t: 'lit', v: null }
      if (t.v === 'true') return { t: 'lit', v: true }
      if (t.v === 'false') return { t: 'lit', v: false }
      if (t.v === 'if') return conditional()
      const args: Node[] = []
      if (eatOp('(')) {
        args.push(pipe())
        while (eatOp(';')) args.push(pipe())
        expectOp(')')
      }
      return { t: 'call', name: t.v as string, args }
    }
    return fail('Unexpected token')
  }

  const conditional = (): Node => {
    const cond = pipe()
    expectId('then')
    const then = pipe()
    if (isId('elif')) {
      p++
      return { t: 'if', cond, then, else: conditional() }
    }
    let otherwise: Node | undefined
    if (isId('else')) {
      p++
      otherwise = pipe()
    }
    expectId('end')
    return { t: 'if', cond, then, else: otherwise }
  }

  const objectLiteral = (): Node => {
    expectOp('{')
    const entries: { key: Node; value: Node }[] = []
    if (!eatOp('}')) {
      do {
        const t = peek()
        let key: Node
        let shorthand: Node | undefined
        if (t.k === 'id' || t.k === 'str') {
          p++
          key = { t: 'lit', v: t.v }
          shorthand = { t: 'field', of: { t: 'id' }, name: String(t.v) }
        } else if (isOp('(')) {
          p++
          key = pipe()
          expectOp(')')
        } else return fail('Expected an object key')
        let value: Node
        if (eatOp(':')) value = alt()
        else if (shorthand) value = shorthand
        else return fail('Expected ":"')
        entries.push({ key, value })
      } while (eatOp(','))
      expectOp('}')
    }
    return { t: 'object', entries }
  }

  const root = pipe()
  if (peek().k !== 'end') fail('Unexpected token')
  return root
}

const typeOf = (v: Json): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v
const truthy = (v: Json) => v !== null && v !== false
const isObj = (v: Json): v is Record<string, Json> => typeOf(v) === 'object'

const ORDER = ['null', 'boolean', 'number', 'string', 'array', 'object']
function compare(a: Json, b: Json): number {
  const ta = typeOf(a)
  const tb = typeOf(b)
  if (ta !== tb) {
    if (ta === 'boolean' && tb === 'boolean') return 0
    return ORDER.indexOf(ta) - ORDER.indexOf(tb)
  }
  if (ta === 'boolean') return Number(a) - Number(b)
  if (ta === 'number') return (a as number) - (b as number)
  if (ta === 'string') return (a as string) < (b as string) ? -1 : a === b ? 0 : 1
  if (ta === 'array') {
    const x = a as Json[]
    const y = b as Json[]
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const c = compare(x[i], y[i])
      if (c) return c
    }
    return x.length - y.length
  }
  if (ta === 'object') {
    const x = a as Record<string, Json>
    const y = b as Record<string, Json>
    const kx = Object.keys(x).sort()
    const ky = Object.keys(y).sort()
    const c = compare(kx, ky)
    if (c) return c
    for (const k of kx) {
      const d = compare(x[k], y[k])
      if (d) return d
    }
  }
  return 0
}

const show = (v: Json) => {
  const s = JSON.stringify(v) ?? 'null'
  return s.length > 40 ? `${s.slice(0, 40)}...` : s
}

function arith(op: string, a: Json, b: Json): Json {
  if (op === '+') {
    if (a === null) return b
    if (b === null) return a
    if (typeof a === 'number' && typeof b === 'number') return a + b
    if (typeof a === 'string' && typeof b === 'string') return a + b
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
    if (isObj(a) && isObj(b)) return { ...a, ...b }
  } else if (op === '-') {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (Array.isArray(a) && Array.isArray(b))
      return a.filter((x) => !b.some((y) => compare(x, y) === 0))
  } else if (op === '*') {
    if (typeof a === 'number' && typeof b === 'number') return a * b
    if (typeof a === 'string' && typeof b === 'number') {
      if (a.length * Math.max(b, 0) > 1_000_000) throw new QueryError('String too long')
      return b > 0 ? a.repeat(Math.ceil(b)) : null
    }
  } else if (op === '/') {
    if (typeof a === 'number' && typeof b === 'number') {
      if (b === 0)
        throw new QueryError(
          `${show(a)} and ${show(b)} cannot be divided because the divisor is zero`,
        )
      return a / b
    }
    if (typeof a === 'string' && typeof b === 'string') return a.split(b)
  } else if (op === '%') {
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.trunc(b) === 0) throw new QueryError('Cannot take a remainder with a zero divisor')
      return Math.trunc(a) % Math.trunc(b)
    }
  }
  throw new QueryError(
    `${typeOf(a)} (${show(a)}) and ${typeOf(b)} (${show(b)}) cannot be combined with ${op}`,
  )
}

type Env = { steps: number }

function run(node: Node, input: Json, env: Env): Json[] {
  if (++env.steps > MAX_STEPS) throw new QueryError('Query ran too long; narrow it')
  const one = (n: Node, v: Json = input) => run(n, v, env)
  const out = (xs: Json[]) => {
    if (xs.length > MAX_OUTPUTS * 10) throw new QueryError('Query produced too many values')
    return xs
  }
  switch (node.t) {
    case 'id':
      return [input]
    case 'lit':
      return [node.v]
    case 'recurse': {
      const acc: Json[] = []
      const walk = (v: Json) => {
        acc.push(v)
        if (Array.isArray(v)) for (const x of v) walk(x)
        else if (isObj(v)) for (const x of Object.values(v)) walk(x)
        if (acc.length > MAX_OUTPUTS * 10) throw new QueryError('Query produced too many values')
      }
      walk(input)
      return acc
    }
    case 'field':
      return one(node.of).map((v) => {
        if (v === null) return null
        if (isObj(v)) return Object.hasOwn(v, node.name) ? v[node.name] : null
        throw new QueryError(`Cannot index ${typeOf(v)} with "${node.name}"`)
      })
    case 'index':
      return one(node.of).flatMap((v) =>
        one(node.at).map((k) => {
          if (v === null) return null
          if (Array.isArray(v) && typeof k === 'number') return v[k < 0 ? v.length + k : k] ?? null
          if (isObj(v) && typeof k === 'string') return Object.hasOwn(v, k) ? v[k] : null
          throw new QueryError(`Cannot index ${typeOf(v)} with ${typeOf(k)}`)
        }),
      )
    case 'slice':
      return one(node.of).flatMap((v) => {
        if (v === null) return [null]
        if (!Array.isArray(v) && typeof v !== 'string')
          throw new QueryError(`Cannot slice ${typeOf(v)}`)
        const froms = node.from ? one(node.from) : [0]
        const tos = node.to ? one(node.to) : [v.length]
        return froms.flatMap((f) =>
          tos.map((t) => {
            if (typeof f !== 'number' || typeof t !== 'number')
              throw new QueryError('Slice bounds must be numbers')
            return v.slice(f, t)
          }),
        )
      })
    case 'iter':
      return out(
        one(node.of).flatMap((v) => {
          if (Array.isArray(v)) return v
          if (isObj(v)) return Object.values(v)
          throw new QueryError(`Cannot iterate over ${typeOf(v)}`)
        }),
      )
    case 'try':
      try {
        return one(node.of)
      } catch (e) {
        if (e instanceof QueryError) return []
        throw e
      }
    case 'pipe':
      return out(one(node.l).flatMap((v) => one(node.r, v)))
    case 'comma':
      return out([...one(node.l), ...one(node.r)])
    case 'alt': {
      const left = one(node.l).filter(truthy)
      return left.length ? left : one(node.r)
    }
    case 'and':
      return one(node.l).flatMap((a) => (truthy(a) ? one(node.r).map(truthy) : [false]))
    case 'or':
      return one(node.l).flatMap((a) => (truthy(a) ? [true] : one(node.r).map(truthy)))
    case 'neg':
      return one(node.of).map((v) => {
        if (typeof v !== 'number') throw new QueryError(`${typeOf(v)} cannot be negated`)
        return -v
      })
    case 'bin':
      return out(
        one(node.r).flatMap((b) =>
          one(node.l).map((a) => {
            switch (node.op) {
              case '==':
                return compare(a, b) === 0
              case '!=':
                return compare(a, b) !== 0
              case '<':
                return compare(a, b) < 0
              case '<=':
                return compare(a, b) <= 0
              case '>':
                return compare(a, b) > 0
              case '>=':
                return compare(a, b) >= 0
              default:
                return arith(node.op, a, b)
            }
          }),
        ),
      )
    case 'array':
      return [node.of ? out(one(node.of)) : []]
    case 'object': {
      let results: Record<string, Json>[] = [{}]
      for (const { key, value } of node.entries) {
        results = results.flatMap((acc) =>
          one(key).flatMap((k) => {
            if (typeof k !== 'string')
              throw new QueryError(`Object keys must be strings, not ${typeOf(k)}`)
            return one(value).map((v) => ({ ...acc, [k]: v }))
          }),
        )
        if (results.length > MAX_OUTPUTS) throw new QueryError('Query produced too many values')
      }
      return results
    }
    case 'if':
      return out(
        one(node.cond).flatMap((c) =>
          truthy(c) ? one(node.then) : node.else ? one(node.else) : [input],
        ),
      )
    case 'call':
      return call(node, input, env)
  }
}

function call(node: Extract<Node, { t: 'call' }>, input: Json, env: Env): Json[] {
  const { name, args } = node
  const one = (n: Node, v: Json = input) => run(n, v, env)
  const arity = (n: number) => {
    if (args.length !== n) throw new QueryError(`${name}/${args.length} is not defined`)
  }
  const arr = (what = name): Json[] => {
    if (!Array.isArray(input)) throw new QueryError(`${what} needs an array, not ${typeOf(input)}`)
    return input
  }
  const str = (): string => {
    if (typeof input !== 'string')
      throw new QueryError(`${name} needs a string, not ${typeOf(input)}`)
    return input
  }
  // Applies a function of the input once per value of its first argument.
  const withArg = (f: (a: Json) => Json): Json[] => {
    arity(1)
    return one(args[0] as Node).map(f)
  }
  const keyed = (): { v: Json; k: Json }[] => {
    arity(1)
    return arr().map((v) => ({ v, k: one(args[0] as Node, v) }))
  }
  const byKey = (a: { k: Json }, b: { k: Json }) => compare(a.k, b.k)

  switch (name) {
    case 'empty':
      return []
    case 'not':
      return [!truthy(input)]
    case 'length':
      if (input === null) return [0]
      if (typeof input === 'string' || Array.isArray(input)) return [input.length]
      if (isObj(input)) return [Object.keys(input).length]
      if (typeof input === 'number') return [Math.abs(input)]
      throw new QueryError(`${typeOf(input)} has no length`)
    case 'type':
      return [typeOf(input)]
    case 'keys':
      if (isObj(input)) return [Object.keys(input).sort()]
      if (Array.isArray(input)) return [input.map((_, i) => i)]
      throw new QueryError(`${typeOf(input)} has no keys`)
    case 'values':
      return input === null ? [] : [input]
    case 'has':
      return withArg((k) => {
        if (isObj(input) && typeof k === 'string') return Object.hasOwn(input, k)
        if (Array.isArray(input) && typeof k === 'number') return k >= 0 && k < input.length
        throw new QueryError(`Cannot check whether ${typeOf(input)} has a ${typeOf(k)} key`)
      })
    case 'contains':
      return withArg((b) => contains(input, b))
    case 'select':
      arity(1)
      return one(args[0] as Node)
        .filter(truthy)
        .map(() => input)
    case 'map':
      arity(1)
      {
        const mapped: Json[] = []
        for (const v of arr()) {
          for (const r of one(args[0] as Node, v)) mapped.push(r)
          if (mapped.length > MAX_OUTPUTS * 10)
            throw new QueryError('Query produced too many values')
        }
        return [mapped]
      }
    case 'add': {
      const items = arr()
      return [items.length ? items.reduce((a, b) => arith('+', a, b)) : null]
    }
    case 'any':
    case 'all': {
      const items = arr().map((v) => (args[0] ? one(args[0], v).some(truthy) : truthy(v)))
      return [name === 'any' ? items.some(Boolean) : items.every(Boolean)]
    }
    case 'min':
    case 'max': {
      const items = arr()
      if (!items.length) return [null]
      return [items.reduce((a, b) => (compare(b, a) < 0 === (name === 'min') ? b : a))]
    }
    case 'min_by':
    case 'max_by': {
      const items = keyed()
      if (!items.length) return [null]
      return [items.reduce((a, b) => (byKey(b, a) < 0 === (name === 'min_by') ? b : a)).v]
    }
    case 'sort':
      return [[...arr()].sort(compare)]
    case 'sort_by':
      return [
        keyed()
          .sort(byKey)
          .map((x) => x.v),
      ]
    case 'group_by': {
      const groups: { k: Json; vs: Json[] }[] = []
      for (const x of keyed().sort(byKey)) {
        const last = groups[groups.length - 1]
        if (last && compare(last.k, x.k) === 0) last.vs.push(x.v)
        else groups.push({ k: x.k, vs: [x.v] })
      }
      return [groups.map((g) => g.vs)]
    }
    case 'unique':
      return [[...arr()].sort(compare).filter((v, i, a) => i === 0 || compare(a[i - 1], v) !== 0)]
    case 'unique_by':
      return [
        keyed()
          .sort(byKey)
          .filter((x, i, a) => i === 0 || compare((a[i - 1] as { k: Json }).k, x.k) !== 0)
          .map((x) => x.v),
      ]
    case 'reverse':
      return [typeof input === 'string' ? [...input].reverse().join('') : [...arr()].reverse()]
    case 'first':
      if (args.length === 1) return one(args[0] as Node).slice(0, 1)
      return [arr()[0] ?? null]
    case 'last':
      if (args.length === 1) return one(args[0] as Node).slice(-1)
      return [arr().at(-1) ?? null]
    case 'limit': {
      arity(2)
      return one(args[0] as Node).flatMap((n) =>
        typeof n === 'number' ? one(args[1] as Node).slice(0, Math.max(0, n)) : [],
      )
    }
    case 'flatten': {
      const depth = args[0] ? (one(args[0])[0] as number) : 1e9
      return [arr().flat(depth)]
    }
    case 'range': {
      const [from, to] =
        args.length === 1
          ? [0, one(args[0] as Node)[0]]
          : [one(args[0] as Node)[0], one(args[1] as Node)[0]]
      if (typeof from !== 'number' || typeof to !== 'number')
        throw new QueryError('range needs numbers')
      if (to - from > MAX_OUTPUTS) throw new QueryError('range is too large')
      return Array.from({ length: Math.max(0, Math.ceil(to - from)) }, (_, i) => from + i)
    }
    case 'to_entries':
      if (!isObj(input)) throw new QueryError(`${typeOf(input)} has no entries`)
      return [Object.entries(input).map(([key, value]) => ({ key, value }))]
    case 'from_entries':
      return [
        Object.fromEntries(
          arr().map((e) => {
            const o = isObj(e) ? e : {}
            return [String(o.key ?? o.name ?? o.k), o.value ?? o.v ?? null]
          }),
        ),
      ]
    case 'join':
      return withArg((sep) =>
        arr()
          .map((v) => (v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))
          .join(String(sep)),
      )
    case 'split':
      return withArg((sep) => str().split(String(sep)))
    case 'startswith':
      return withArg((s) => str().startsWith(String(s)))
    case 'endswith':
      return withArg((s) => str().endsWith(String(s)))
    case 'ascii_downcase':
      return [str().toLowerCase()]
    case 'ascii_upcase':
      return [str().toUpperCase()]
    case 'tostring':
      return [typeof input === 'string' ? input : JSON.stringify(input)]
    case 'tonumber': {
      const n = typeof input === 'number' ? input : Number(str())
      if (Number.isNaN(n)) throw new QueryError(`${show(input)} cannot be parsed as a number`)
      return [n]
    }
    case 'floor':
    case 'ceil':
    case 'round':
    case 'abs':
    case 'sqrt': {
      if (typeof input !== 'number') throw new QueryError(`${typeOf(input)} is not a number`)
      return [Math[name === 'abs' ? 'abs' : name](input)]
    }
    default:
      throw new QueryError(`${name}/${args.length} is not defined`)
  }
}

function contains(a: Json, b: Json): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.includes(b)
  if (Array.isArray(a) && Array.isArray(b)) return b.every((y) => a.some((x) => contains(x, y)))
  if (isObj(a) && isObj(b)) {
    return Object.entries(b).every(([k, y]) => Object.hasOwn(a, k) && contains(a[k], y))
  }
  return compare(a, b) === 0
}

/** Runs the jq-style `query` over `data` and returns every value it produces. */
export function queryJson(data: Json, query: string): Json[] {
  const ast = parse(query)
  try {
    return run(ast, data, { steps: 0 })
  } catch (error) {
    if (error instanceof RangeError) throw new QueryError('Query is too deep to run')
    throw error
  }
}

export type JsonQueryToolOptions = {
  root: string
  /** Largest file to load, in bytes. @default 20971520 */
  maxBytes?: number
}

/**
 * A `json_query` tool: run a jq-style query over a JSON (or JSON Lines) file in the workspace so the
 * model reads only the slice it needs, not a megabyte of API output. Reads only, inside the
 * workspace jail; results are tagged `untrusted` like any file content.
 */
export function jsonQueryTool(options: JsonQueryToolOptions): ToolDefinition {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024
  return defineTool({
    name: 'json_query',
    description:
      'Query a JSON file with a jq-style expression and get back only the matching values, instead of reading the whole file. Examples: ".dependencies | keys", ".items[] | select(.price > 10) | {name, price}", "map(.id) | length", "group_by(.type) | map({type: .[0].type, n: length})". Supports paths, pipes, select, map, sort_by, group_by, unique, keys, length, add, min/max, if/then/else and // defaults. Give path (a .json or .jsonl file in the workspace) or inline json.',
    input: z.object({
      query: z.string().min(1).max(2000),
      path: z.string().optional(),
      json: z.string().optional(),
      maxChars: z.number().int().min(100).max(200_000).default(20_000),
    }),
    resultTrust: 'untrusted',
    execute: async ({ query, path, json, maxChars = 20_000 }) => {
      if ((path === undefined) === (json === undefined)) {
        throw new Error('Give exactly one of path or json')
      }
      let text = json as string
      if (path !== undefined) {
        const file = await resolveJailed(options.root, path)
        const read = await readTextFile(file, maxBytes)
        if (read.text === undefined) {
          throw new Error(`${path} is ${read.size} bytes; the limit is ${maxBytes}`)
        }
        text = read.text
      }
      let data: Json
      try {
        data = /\.(jsonl|ndjson)$/i.test(path ?? '')
          ? text
              .split(/\r?\n/)
              .filter((l) => l.trim())
              .map((l) => JSON.parse(l))
          : JSON.parse(text)
      } catch (error) {
        throw new Error(`${path ?? 'The input'} is not valid JSON: ${(error as Error).message}`)
      }
      let results: Json[]
      try {
        results = queryJson(data, query)
      } catch (error) {
        if (error instanceof QueryError) throw new Error(`Query error: ${error.message}`)
        throw error
      }
      const kept: Json[] = []
      let used = 2
      for (const r of results) {
        const size = (JSON.stringify(r) ?? 'null').length + 2
        if (used + size > maxChars && kept.length > 0) break
        kept.push(r)
        used += size
      }
      return { count: results.length, results: kept, truncated: kept.length < results.length }
    },
  })
}
