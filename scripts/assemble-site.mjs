// Combines the Starlight site (website/dist) with the typedoc API reference (docs/) into one
// deployable folder: guides at /, API reference at /api/, llms.txt at the root.
// Requires `pnpm docs` and `pnpm --filter intellibrix-website build:site` first.
import { cp, rm, writeFile } from 'node:fs/promises'

const SITE = 'website/dist'
await rm(`${SITE}/api`, { recursive: true, force: true })
await cp('docs', `${SITE}/api`, { recursive: true })
await cp('docs/llms.txt', `${SITE}/llms.txt`)
await cp('docs/llms-full.txt', `${SITE}/llms-full.txt`)
await writeFile(`${SITE}/.nojekyll`, '')
console.log(`Assembled ${SITE}`)
