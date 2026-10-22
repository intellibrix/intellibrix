/**
 * A small, forgiving HTML reader for turning web pages into Markdown: it finds the main content,
 * drops navigation, ads and other page furniture, and keeps headings, links, lists, code and tables.
 */

type El = { tag: string; attrs: Record<string, string>; children: Node[] }
type Node = El | string

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/** Tags that end an open element of the listed kinds (a new `li` ends the previous `li`). */
const CLOSES: Record<string, string[]> = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  option: ['option'],
}
const CLOSES_P = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'fieldset',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
])

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  middot: '·',
  bull: '•',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isInteger(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

const TOKEN = /<!(?:doctype|[^>]*)>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</gi
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of source.matchAll(ATTR)) {
    attrs[(m[1] as string).toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

/** Parse `html` into a tree. Unclosed and stray tags are tolerated. */
export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] }
  const stack: El[] = [root]
  const top = () => stack[stack.length - 1] as El
  const closeWhile = (tags: string[]) => {
    for (let i = stack.length - 1; i > 0; i--) {
      const tag = (stack[i] as El).tag
      if (tags.includes(tag)) {
        stack.length = i
        return
      }
      if (['ul', 'ol', 'table', 'dl', 'body', 'html', 'article', 'main', 'section'].includes(tag))
        return
    }
  }
  for (const m of stripDelimited(stripComments(html), '<![CDATA[', ']]>').matchAll(TOKEN)) {
    const [whole, slash, rawTag, rawAttrs] = m
    if (!rawTag) {
      if (!whole.startsWith('<!') && !whole.startsWith('<')) top().children.push(whole)
      else if (whole === '<') top().children.push('<')
      continue
    }
    const tag = rawTag.toLowerCase()
    if (slash) {
      for (let i = stack.length - 1; i > 0; i--) {
        if ((stack[i] as El).tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    if (CLOSES[tag]) closeWhile(CLOSES[tag])
    if (CLOSES_P.has(tag) && stack.some((e) => e.tag === 'p')) closeWhile(['p'])
    const el: El = { tag, attrs: parseAttrs(rawAttrs ?? ''), children: [] }
    top().children.push(el)
    if (!VOID.has(tag) && !/\/\s*$/.test(rawAttrs ?? '')) stack.push(el)
  }
  return root
}

/** Removes `open … close` spans; an unterminated one swallows the rest, as in a browser. */
function stripDelimited(html: string, open: string, close: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const start = html.indexOf(open, pos)
    if (start < 0) break
    out += html.slice(pos, start)
    const end = html.indexOf(close, start + open.length)
    if (end < 0) return out
    pos = end + close.length
  }
  return out + html.slice(pos)
}

/** Removes `<!-- … -->` comments. */
export function stripComments(html: string): string {
  return stripDelimited(html, '<!--', '-->')
}

/** Removes tags until none are left, so nested fragments like `<<b>script>` cannot survive. */
export function stripTags(html: string): string {
  let text = html
  for (let prev = ''; prev !== text; ) {
    prev = text
    text = removeTagsOnce(text)
  }
  return text
}

function removeTagsOnce(html: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const lt = html.indexOf('<', pos)
    if (lt < 0) break
    const gt = html.indexOf('>', lt + 1)
    if (gt < 0) break
    if (gt === lt + 1) {
      out += html.slice(pos, gt + 1)
    } else {
      out += html.slice(pos, lt)
    }
    pos = gt + 1
  }
  return out + html.slice(pos)
}

/**
 * Finds each `<tag …>…</tag>` element (case-insensitive) without a backtracking regex, so a page
 * of unclosed tags stays linear. `keep` receives the spans outside matches and `onMatch` each match.
 */
function scanElements(
  html: string,
  tags: readonly string[],
  onMatch: (tag: string, inner: string) => string,
): string {
  const opener = new RegExp(`<(${tags.join('|')})\\b`, 'gi')
  const closers = new Map<string, RegExp>()
  const exhausted = new Set<string>()
  let out = ''
  let pos = 0
  for (;;) {
    opener.lastIndex = pos
    const open = opener.exec(html)
    if (!open) break
    const tag = (open[1] as string).toLowerCase()
    const gt = html.indexOf('>', open.index + open[0].length)
    if (gt < 0) break
    if (exhausted.has(tag)) {
      out += html.slice(pos, gt + 1)
      pos = gt + 1
      continue
    }
    const closer = closers.get(tag) ?? new RegExp(`</${tag}\\s*>`, 'gi')
    closers.set(tag, closer)
    closer.lastIndex = gt + 1
    const close = closer.exec(html)
    if (!close) {
      exhausted.add(tag)
      out += html.slice(pos, gt + 1)
      pos = gt + 1
      continue
    }
    out += html.slice(pos, open.index) + onMatch(tag, html.slice(gt + 1, close.index))
    pos = close.index + close[0].length
  }
  return out + html.slice(pos)
}

/** Drops whole elements (and everything inside them) for the given tags. */
export function removeElements(html: string, tags: readonly string[]): string {
  return scanElements(html, tags, () => '')
}

/** The inner HTML of the first `<tag>` element, if it has a closing tag. */
export function firstElementInner(html: string, tag: string): string | undefined {
  let found: string | undefined
  scanElements(html, [tag], (_, inner) => {
    found ??= inner
    return ''
  })
  return found
}

/** Remove raw-text elements the tree builder should never see inside. */
function stripRawText(html: string): string {
  return removeElements(html, [
    'script',
    'style',
    'noscript',
    'template',
    'svg',
    'iframe',
    'textarea',
  ])
}

const find = (node: El, test: (el: El) => boolean, out: El[] = []): El[] => {
  for (const c of node.children) {
    if (typeof c === 'string') continue
    if (test(c)) out.push(c)
    find(c, test, out)
  }
  return out
}

const DROP_TAGS = new Set([
  'nav',
  'footer',
  'aside',
  'form',
  'button',
  'select',
  'input',
  'dialog',
  'canvas',
  'audio',
  'video',
  'object',
  'embed',
  'head',
  'menu',
])
const DROP_ROLES = new Set([
  'navigation',
  'complementary',
  'contentinfo',
  'dialog',
  'search',
  'banner',
])
const NOISE_CLASS =
  /^(ads?|advert|advertisement|adsbygoogle|sponsored|cookie|cookies|cookie-banner|cookie-consent|consent|newsletter|popup|modal|sidebar|share|share-buttons?|social-share|related|related-posts?|comments?|breadcrumbs?)$/i

function isNoise(el: El, keepHeader: boolean): boolean {
  if (DROP_TAGS.has(el.tag)) return true
  if (el.tag === 'header' && !keepHeader) return true
  const role = el.attrs.role?.toLowerCase()
  if (role && DROP_ROLES.has(role) && !(role === 'banner' && keepHeader)) return true
  if ('hidden' in el.attrs || el.attrs['aria-hidden'] === 'true') return true
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.attrs.style ?? '')) return true
  const tokens = `${el.attrs.class ?? ''} ${el.attrs.id ?? ''}`.split(/\s+/)
  return tokens.some((t) => NOISE_CLASS.test(t))
}

function prune(el: El, keepHeader: boolean): El {
  return {
    ...el,
    children: el.children.flatMap((c): Node[] =>
      typeof c === 'string' ? [c] : isNoise(c, keepHeader) ? [] : [prune(c, keepHeader)],
    ),
  }
}

const textOf = (node: Node): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('')

/** The element holding the page's main content: the one `article`, else `main`, else the body. */
function mainContent(root: El): { el: El; keepHeader: boolean } {
  const body = find(root, (e) => e.tag === 'body')[0] ?? root
  const articles = find(body, (e) => e.tag === 'article')
  const candidate =
    (articles.length === 1 ? articles[0] : undefined) ??
    find(body, (e) => e.tag === 'main' || e.attrs.role === 'main')[0]
  if (candidate) {
    const pruned = prune(candidate, true)
    const whole = prune(body, false)
    // A "main" with almost nothing in it is usually a wrapper for a widget, not the content.
    if (textOf(pruned).trim().length >= 200 || textOf(pruned).length * 4 >= textOf(whole).length) {
      return { el: pruned, keepHeader: true }
    }
  }
  return { el: prune(body, false), keepHeader: false }
}

export type MarkdownOptions = {
  /** Resolves relative links and image URLs. */
  baseUrl?: string
  /** Convert the whole page rather than only its main content. @default false */
  wholePage?: boolean
}

function absolute(href: string, base?: string): string | undefined {
  const h = href.trim()
  if (!h || h.startsWith('#') || /^(javascript|data|vbscript):/i.test(h)) return undefined
  try {
    return base ? new URL(h, base).toString() : h
  } catch {
    return h
  }
}

const collapse = (s: string) => s.replace(/\s+/g, ' ')
const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'figure',
  'figcaption',
  'details',
  'summary',
  'address',
  'dl',
  'dt',
  'dd',
  'fieldset',
  'body',
  'html',
  '#root',
])

type Ctx = { base?: string }

function renderChildren(el: El, ctx: Ctx): string {
  return el.children.map((c) => render(c, ctx)).join('')
}

const blockOf = (s: string) => {
  const t = s.trim()
  return t ? `\n\n${t}\n\n` : ''
}

function renderList(el: El, ctx: Ctx): string {
  const ordered = el.tag === 'ol'
  const items = el.children.filter((c): c is El => typeof c !== 'string' && c.tag === 'li')
  const lines = items.map((li, i) => {
    const marker = ordered ? `${i + 1}. ` : '- '
    const body = renderChildren(li, ctx)
      .trim()
      // A nested list sits directly under its item, with no blank line between.
      .replace(/\n\n(?=\s*(?:- |\d+\. ))/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line, n) => (n === 0 ? line : line ? ' '.repeat(marker.length) + line : line))
      .join('\n')
    return marker + body
  })
  return lines.length ? `\n\n${lines.join('\n')}\n\n` : ''
}

function renderTable(el: El, ctx: Ctx): string {
  const rows = find(el, (e) => e.tag === 'tr').map((tr) =>
    tr.children
      .filter((c): c is El => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'))
      .map((cell) =>
        renderChildren(cell, ctx).replace(/\s+/g, ' ').replace(/[\\|]/g, '\\$&').trim(),
      ),
  )
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
  const [head, ...rest] = rows as [string[], ...string[][]]
  return `\n\n${[line(head), line(Array(width).fill('---')), ...rest.map(line)].join('\n')}\n\n`
}

function render(node: Node, ctx: Ctx): string {
  if (typeof node === 'string') return collapse(decodeEntities(node))
  const { tag } = node
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = collapse(renderChildren(node, ctx)).trim()
      return text ? `\n\n${'#'.repeat(Number(tag[1]))} ${text}\n\n` : ''
    }
    case 'br':
      return '\n'
    case 'hr':
      return '\n\n---\n\n'
    case 'ul':
    case 'ol':
      return renderList(node, ctx)
    case 'li':
      return blockOf(renderChildren(node, ctx))
    case 'blockquote':
      return blockOf(
        renderChildren(node, ctx)
          .trim()
          .split('\n')
          .map((l) => `> ${l}`.trimEnd())
          .join('\n'),
      )
    case 'pre': {
      const code = textOf(node).replace(/^\n/, '').replace(/\n$/, '')
      const lang = /language-([\w+-]+)/.exec(
        JSON.stringify(find(node, (e) => e.tag === 'code').map((e) => e.attrs.class ?? '')),
      )?.[1]
      return `\n\n\`\`\`${lang ?? ''}\n${decodeEntities(code)}\n\`\`\`\n\n`
    }
    case 'code': {
      const text = decodeEntities(textOf(node)).replace(/\s+/g, ' ').trim()
      return text ? `\`${text}\`` : ''
    }
    case 'strong':
    case 'b': {
      const t = renderChildren(node, ctx).trim()
      return t ? `**${t}**` : ''
    }
    case 'em':
    case 'i': {
      const t = renderChildren(node, ctx).trim()
      return t ? `*${t}*` : ''
    }
    case 'del':
    case 's': {
      const t = renderChildren(node, ctx).trim()
      return t ? `~~${t}~~` : ''
    }
    case 'a': {
      const text = collapse(renderChildren(node, ctx)).trim()
      const href = node.attrs.href ? absolute(node.attrs.href, ctx.base) : undefined
      if (!text) return ''
      return href && href !== text ? `[${text}](${href})` : text
    }
    case 'img': {
      const alt = (node.attrs.alt ?? '').trim()
      return alt ? `[image: ${alt}]` : ''
    }
    case 'table':
      return renderTable(node, ctx)
    default:
      return BLOCK.has(tag) ? blockOf(renderChildren(node, ctx)) : renderChildren(node, ctx)
  }
}

/** The page title: `<title>`, else the Open Graph title, else the first `h1`. */
export function pageTitle(html: string): string | undefined {
  const title =
    firstElementInner(html, 'title') ??
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
    firstElementInner(html, 'h1')
  const text = title ? collapse(decodeEntities(stripTags(title))).trim() : ''
  return text || undefined
}

/**
 * Converts an HTML page to Markdown, keeping headings, links, lists, code blocks and tables, and
 * dropping scripts, navigation, ads, cookie banners and other page furniture. Only the main
 * content (`<article>` or `<main>`) is kept unless `wholePage` is set.
 */
export function htmlToMarkdown(html: string, options: MarkdownOptions = {}): string {
  const tree = parseHtml(stripRawText(stripComments(html)))
  const el = options.wholePage
    ? prune(find(tree, (e) => e.tag === 'body')[0] ?? tree, false)
    : mainContent(tree).el
  const markdown = render(el, { base: options.baseUrl })
  // Tidy whitespace everywhere except inside code fences, where it is the content.
  return markdown
    .split(/(```[\s\S]*?```)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n (?=\S)/g, '\n')
            .replace(/(\S) {2,}/g, '$1 '),
    )
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
