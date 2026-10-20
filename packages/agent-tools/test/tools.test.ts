import type { ToolDefinition } from 'intellibrix'
import { describe, expect, it } from 'vitest'
import { datetimeTool } from '../src/index.js'

const run = (tool: ToolDefinition, input: unknown) =>
  tool.execute(input as never, { runId: 'r' } as never) as Promise<any>

describe('datetime', () => {
  const NOW = Date.UTC(2026, 2, 4, 15, 30, 0)
  const tool = datetimeTool({ now: () => NOW })

  it('tells the time in any zone, with the weekday', async () => {
    expect(await run(tool, { action: 'now' })).toMatchObject({
      iso: '2026-03-04T15:30:00Z',
      weekday: 'Wednesday',
      unix: NOW / 1000,
    })
    expect(await run(tool, { action: 'now', timeZone: 'Asia/Kolkata' })).toMatchObject({
      iso: '2026-03-04T21:00:00+05:30',
    })
  })

  it('converts, reading offset-less dates in the source zone', async () => {
    const r = await run(tool, {
      action: 'convert',
      date: '2026-07-01T09:00',
      timeZone: 'America/New_York',
      toTimeZone: 'Europe/Paris',
    })
    expect(r.from.iso).toBe('2026-07-01T09:00:00-04:00')
    expect(r.to.iso).toBe('2026-07-01T15:00:00+02:00')
    const explicit = await run(tool, {
      action: 'convert',
      date: '2026-01-01T00:00:00+09:00',
      toTimeZone: 'UTC',
    })
    expect(explicit.to.iso).toBe('2025-12-31T15:00:00Z')
  })

  it('adds calendar units on the wall clock and clamps month ends', async () => {
    expect((await run(tool, { action: 'add', date: '2026-01-31', months: 1 })).iso).toBe(
      '2026-02-28T00:00:00Z',
    )
    expect((await run(tool, { action: 'add', date: '2026-03-04', days: 90 })).iso).toBe(
      '2026-06-02T00:00:00Z',
    )
    expect((await run(tool, { action: 'add', years: -1, hours: 2 })).iso).toBe(
      '2025-03-04T17:30:00Z',
    )
    // +1 day across the US spring-forward keeps 12:00; +24h does not.
    const zone = 'America/New_York'
    const day = await run(tool, {
      action: 'add',
      date: '2026-03-07T12:00',
      days: 1,
      timeZone: zone,
    })
    const hours = await run(tool, {
      action: 'add',
      date: '2026-03-07T12:00',
      hours: 24,
      timeZone: zone,
    })
    expect(day.iso).toBe('2026-03-08T12:00:00-04:00')
    expect(hours.iso).toBe('2026-03-08T13:00:00-04:00')
  })

  it('measures the distance between two dates', async () => {
    const r = await run(tool, { action: 'diff', date: '2024-03-01', other: '2026-03-04T06:00' })
    expect(r.calendar).toEqual({ years: 2, months: 0, days: 3 })
    expect(r.clock).toEqual({ hours: 6, minutes: 0, seconds: 0 })
    expect(r.sign).toBe('later')
    const back = await run(tool, { action: 'diff', date: '2026-03-04', other: '2026-03-01' })
    expect(back).toMatchObject({ sign: 'earlier', totalDays: -3 })
  })

  it('refuses vague dates, impossible dates, unknown zones and missing arguments', async () => {
    await expect(run(tool, { action: 'convert', date: 'next tuesday' })).rejects.toThrow(/ISO 8601/)
    await expect(run(tool, { action: 'convert', date: '2026-02-30' })).rejects.toThrow(/real date/)
    await expect(run(tool, { action: 'now', timeZone: 'Mars/Base' })).rejects.toThrow(/time zone/)
    await expect(run(tool, { action: 'add', date: '2026-01-01' })).rejects.toThrow(/duration/)
    await expect(run(tool, { action: 'diff', date: '2026-01-01' })).rejects.toThrow(/other/)
  })
})
