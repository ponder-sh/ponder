import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const build = async () => {
  const raw = await readFile(path.join(__dirname, './static.js'), 'utf-8')
  const escaped = raw.replaceAll('`', '\\`').replaceAll('$', '\\$')
  const final = `exports.graphTsStaticString = \`${escaped}\``
  await writeFile(path.join(__dirname, './index.js'), final)
}

build().catch(console.error)
