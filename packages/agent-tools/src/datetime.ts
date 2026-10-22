import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i

type Zoned = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: string
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        weekday: 'long',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      })
    } catch {
      throw new Error(
        `Unknown time zone "${timeZone}". Use an IANA name like "Europe/Paris" or "UTC".`,
      )
    }
    formatters.set(timeZone, f)
  }
  return f
}

/** The wall-clock fields of the instant `ms` as seen in `timeZone`. */
function zonedParts(ms: number, timeZone: string): Zoned {
  const p: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(ms)) p[part.type] = part.value
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: p.weekday as string,
  }
}

const utcOf = (z: Omit<Zoned, 'weekday'>) =>
  Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)

/** `timeZone`'s offset from UTC at the instant `ms`, in ms. */
function offsetAt(ms: number, timeZone: string): number {
  return utcOf(zonedParts(ms, timeZone)) - Math.floor(ms / 1000) * 1000
}

/** The instant at which the wall clock in `timeZone` reads `local` (a time in a DST gap moves later). */
function instantOf(local: Omit<Zoned, 'weekday'>, timeZone: string): number {
  const guess = utcOf(local)
  const first = guess - offsetAt(guess, timeZone)
  const second = guess - offsetAt(first, timeZone)
  return second === first ? first : guess - offsetAt(second, timeZone)
}

function parseInstant(input: string, timeZone: string): number {
  const m = ISO.exec(input.trim())
  if (!m) {
    throw new Error(
      `Cannot read "${input}" as a date. Use ISO 8601, like 2026-03-04 or 2026-03-04T15:30:00+01:00.`,
    )
  }
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((v) =>
    v === undefined ? 0 : Number(v),
  ) as [number, number, number, number, number, number]
  const millis = m[7] ? Number(m[7].padEnd(3, '0')) : 0
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error(`"${input}" is not a real date or time`)
  }
  const zone = m[8]
  if (zone) {
    const offset =
      zone.toUpperCase() === 'Z'
        ? 0
        : (zone.startsWith('-') ? -1 : 1) *
          (Number(zone.slice(1, 3)) * 60 + Number(zone.replace(':', '').slice(3, 5) || 0)) *
          60_000
    return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offset
  }
  return instantOf({ year, month, day, hour, minute, second }, timeZone) + millis
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** `2026-03-04T15:30:00+01:00`: the instant `ms` written in `timeZone`. */
function formatLocal(ms: number, timeZone: string): string {
  const z = zonedParts(ms, timeZone)
  const offset = offsetAt(ms, timeZone) / 60_000
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  const suffix = offset === 0 ? 'Z' : `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  return `${pad(z.year, 4)}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}${suffix}`
}

function describe(ms: number, timeZone: string) {
  return {
    iso: formatLocal(ms, timeZone),
    utc: new Date(ms).toISOString(),
    timeZone,
    weekday: zonedParts(ms, timeZone).weekday,
    unix: Math.floor(ms / 1000),
  }
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

const UNITS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'] as const
type Duration = Partial<Record<(typeof UNITS)[number], number>>

/** Calendar units move the wall clock (so "+1 day" across a DST change keeps the hour); clock units move time itself. */
function addDuration(ms: number, d: Duration, timeZone: string): number {
  const z = zonedParts(ms, timeZone)
  const months = (d.years ?? 0) * 12 + (d.months ?? 0)
  const total = z.year * 12 + (z.month - 1) + months
  const year = Math.floor(total / 12)
  const month = (((total % 12) + 12) % 12) + 1
  const day = Math.min(z.day, daysInMonth(year, month))
  const shifted = new Date(Date.UTC(year, month - 1, day + (d.days ?? 0) + (d.weeks ?? 0) * 7))
  const local = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: z.hour,
    minute: z.minute,
    second: z.second,
  }
  const clock = ((d.hours ?? 0) * 3600 + (d.minutes ?? 0) * 60 + (d.seconds ?? 0)) * 1000
  return instantOf(local, timeZone) + (((ms % 1000) + 1000) % 1000) + clock
}

function between(from: number, to: number, timeZone: string) {
  const sign = to < from ? -1 : 1
  const [a, b] = sign === 1 ? [from, to] : [to, from]
  const x = zonedParts(a, timeZone)
  const y = zonedParts(b, timeZone)
  let years = y.year - x.year
  let months = y.month - x.month
  let days = y.day - x.day
  const secondsOfDay = (z: Zoned) => z.hour * 3600 + z.minute * 60 + z.second
  if (secondsOfDay(y) < secondsOfDay(x)) days -= 1
  if (days < 0) {
    months -= 1
    const prev = y.month === 1 ? [y.year - 1, 12] : [y.year, y.month - 1]
    days += daysInMonth(prev[0] as number, prev[1] as number)
  }
  if (months < 0) {
    years -= 1
    months += 12
  }
  const totalSeconds = Math.floor((b - a) / 1000)
  return {
    sign: sign === 1 ? 'later' : 'earlier',
    totalSeconds: sign * totalSeconds,
    totalDays: (sign * Math.round(((b - a) / 86_400_000) * 1000)) / 1000,
    calendar: { years, months, days },
    clock: {
      hours: Math.floor((totalSeconds % 86_400) / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
    },
  }
}

export type DatetimeToolOptions = {
  /** Time zone used when the model gives none. @default 'UTC' */
  timeZone?: string
  /** The clock, for tests or a fixed "today". @default `Date.now` */
  now?: () => number
}

/**
 * A `datetime` tool for the things models get wrong: what time it is now, converting between time
 * zones, adding to a date, and the distance between two dates. Works on ISO 8601 text and IANA time
 * zone names, with no dependencies.
 */
export function datetimeTool(options: DatetimeToolOptions = {}): ToolDefinition {
  const defaultZone = options.timeZone ?? 'UTC'
  const now = options.now ?? Date.now
  const unit = z.number().finite().optional()
  return defineTool({
    name: 'datetime',
    description:
      'Date and time, exactly. action "now": the current time. "convert": a date/time in another time zone. "add": a date plus a duration (years, months, weeks, days, hours, minutes, seconds; negative to subtract). "diff": the distance between date and other. Dates are ISO 8601 (2026-03-04 or 2026-03-04T15:30:00+01:00); a date with no offset is read in timeZone. Time zones are IANA names like "America/New_York".',
    input: z.object({
      action: z.enum(['now', 'convert', 'add', 'diff']),
      date: z.string().optional(),
      other: z.string().optional(),
      timeZone: z.string().optional(),
      toTimeZone: z.string().optional(),
      years: unit,
      months: unit,
      weeks: unit,
      days: unit,
      hours: unit,
      minutes: unit,
      seconds: unit,
    }),
    execute: async (input) => {
      const zone = input.timeZone ?? defaultZone
      formatter(zone)
      const at = (value: string | undefined) =>
        value === undefined ? now() : parseInstant(value, zone)
      switch (input.action) {
        case 'now':
          return describe(now(), zone)
        case 'convert': {
          if (!input.date) throw new Error('convert needs a date')
          const to = input.toTimeZone ?? defaultZone
          const ms = parseInstant(input.date, zone)
          return { from: describe(ms, zone), to: describe(ms, to) }
        }
        case 'add': {
          const d: Duration = {}
          for (const u of UNITS) if (input[u] !== undefined) d[u] = input[u]
          if (Object.keys(d).length === 0) throw new Error('add needs at least one duration unit')
          return describe(addDuration(at(input.date), d, zone), zone)
        }
        case 'diff': {
          if (!input.other) throw new Error('diff needs date and other')
          return between(at(input.date), parseInstant(input.other, zone), zone)
        }
      }
    },
  })
}
