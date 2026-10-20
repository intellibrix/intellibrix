// Generates the multi-package typedoc site into docs/ and, from the same
// typedoc project model, llms.txt (index) and llms-full.txt (signatures + docs).
import { writeFile } from 'node:fs/promises'
import { Application, Comment, PageEvent, ReflectionKind } from 'typedoc'

const SITE = 'https://intellibrix.dev'
// The typedoc pages are published under /api/ (see scripts/assemble-site.mjs); llms*.txt sit at the root.
const API = `${SITE}/api`
const OUT = 'docs'
const SYMBOL_KINDS =
  ReflectionKind.Class |
  ReflectionKind.Interface |
  ReflectionKind.Function |
  ReflectionKind.TypeAlias |
  ReflectionKind.Variable |
  ReflectionKind.Enum

const app = await Application.bootstrapWithPlugins()
const project = await app.convert()
if (!project) throw new Error('typedoc conversion failed')
// Each page's model -> URL, captured as it renders.
const urls = new Map()
app.renderer.on(PageEvent.BEGIN, (page) => urls.set(page.model, page.url))
await app.generateDocs(project, OUT)

const text = (comment) =>
  comment
    ? Comment.combineDisplayParts(comment.summary)
        .replace(/\{@link\s+([^}|\s]+)(?:[ |][^}]*)?\}/g, '`$1`')
        .trim()
    : ''
const firstSentence = (s) =>
  (s.replace(/\b(e\.g|i\.e)\./g, '$1§').split(/(?<=[.!?])\s+(?=[A-Z`])|\n\n/)[0] ?? '')
    .replace(/§/g, '.')
    .replace(/\s+/g, ' ')
    .trim()

function signatureOf(r) {
  const sig = r.signatures?.[0]
  if (sig) {
    const params = (sig.parameters ?? []).map(
      (p) => `${p.name}${p.flags.isOptional ? '?' : ''}: ${p.type?.toString() ?? 'unknown'}`,
    )
    return `${r.name}(${params.join(', ')}): ${sig.type?.toString() ?? 'void'}`
  }
  if (r.kindOf(ReflectionKind.TypeAlias) || r.kindOf(ReflectionKind.Variable))
    return `${r.name}: ${r.type?.toString() ?? ''}`.trim()
  return r.name
}

function memberLines(r) {
  return (r.children ?? [])
    .filter((c) => !c.flags.isPrivate && !c.flags.isProtected)
    .map(
      (c) =>
        `- \`${signatureOf(c)}\`${text(c.comment ?? c.signatures?.[0]?.comment) ? `: ${firstSentence(text(c.comment ?? c.signatures?.[0]?.comment))}` : ''}`,
    )
}

/** Yields [packageName, symbol] for every documented top-level symbol. */
function* symbols(node, pkg) {
  for (const child of node.children ?? []) {
    if (child.kindOf(ReflectionKind.Module) || child.kindOf(ReflectionKind.Project)) {
      yield* symbols(child, pkg ?? child.name)
    } else if (child.kindOf(SYMBOL_KINDS)) {
      yield [pkg ?? project.name, child]
    }
  }
}

const byPackage = new Map()
for (const [pkg, sym] of symbols(project)) {
  if (!byPackage.has(pkg)) byPackage.set(pkg, [])
  byPackage.get(pkg).push(sym)
}

const link = (r) => {
  // Members without their own page (e.g. variables) link to their parent's page.
  let node = r
  while (node && !urls.has(node)) node = node.parent
  const url = node && urls.get(node)
  return url ? `${API}/${url}` : API
}
let index = `# intellibrix\n\n> Model-agnostic, TypeScript-native, agent-native framework: Structure → Brick → Program, typed tools, an agent loop, MCP, multi-agent structures. Full reference: ${SITE}/llms-full.txt\n`
let full = `# intellibrix: full API reference\n\nGenerated from TSDoc. Index: ${SITE}/llms.txt\n`

for (const [pkg, syms] of [...byPackage].sort(([a], [b]) => a.localeCompare(b))) {
  syms.sort((a, b) => a.name.localeCompare(b.name))
  index += `\n## ${pkg}\n\n`
  full += `\n## ${pkg}\n`
  for (const s of syms) {
    const summary = text(s.comment ?? s.signatures?.[0]?.comment)
    index += `- [${s.name}](${link(s)})${summary ? `: ${firstSentence(summary)}` : ''}\n`
    full += `\n### ${ReflectionKind.singularString(s.kind)} ${s.name}\n\n\`\`\`ts\n${signatureOf(s)}\n\`\`\`\n${summary ? `\n${summary}\n` : ''}`
    if (s.kindOf(ReflectionKind.Class | ReflectionKind.Interface)) {
      const lines = memberLines(s)
      if (lines.length) full += `\n${lines.join('\n')}\n`
    }
  }
}

await writeFile(`${OUT}/llms.txt`, index)
await writeFile(`${OUT}/llms-full.txt`, full)
const count = [...byPackage.values()].reduce((n, s) => n + s.length, 0)
console.log(`llms.txt / llms-full.txt: ${count} symbols across ${byPackage.size} packages`)
