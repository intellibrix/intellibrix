type Rule = { allow: boolean; pattern: string }
type Group = { agents: string[]; rules: Rule[] }

/** A parsed `robots.txt`, as RFC 9309 describes it. */
export type Robots = Group[]

export function parseRobots(text: string): Robots {
  const groups: Group[] = []
  let current: Group | undefined
  let collecting = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const field = (m[1] as string).toLowerCase()
    const value = (m[2] as string).trim()
    if (field === 'user-agent') {
      if (!current || !collecting) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      collecting = true
      current.agents.push(value.toLowerCase())
    } else if ((field === 'allow' || field === 'disallow') && current) {
      collecting = false
      // An empty Disallow allows everything; an empty Allow says nothing.
      if (value) current.rules.push({ allow: field === 'allow', pattern: value })
    } else {
      collecting = false
    }
  }
  return groups
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const re = new RegExp(
    `^${body
      .split('*')
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}${anchored ? '$' : ''}`,
  )
  return re.test(path)
}

/**
 * Whether `userAgent` may fetch `path` (path plus query). The most specific user-agent group wins,
 * then the longest matching rule, with Allow winning a tie.
 */
export function robotsAllows(robots: Robots, userAgent: string, path: string): boolean {
  const token = (userAgent.split('/')[0] ?? userAgent).trim().toLowerCase()
  let best: { group: Group; length: number } | undefined
  for (const group of robots) {
    for (const agent of group.agents) {
      const length = agent === '*' ? 0 : agent && token.includes(agent) ? agent.length : -1
      if (length >= 0 && (!best || length > best.length)) best = { group, length }
    }
  }
  if (!best) return true
  let verdict: { allow: boolean; length: number } | undefined
  for (const rule of best.group.rules) {
    if (!matches(rule.pattern, path)) continue
    const length = rule.pattern.length
    if (!verdict || length > verdict.length || (length === verdict.length && rule.allow)) {
      verdict = { allow: rule.allow, length }
    }
  }
  return verdict?.allow ?? true
}
