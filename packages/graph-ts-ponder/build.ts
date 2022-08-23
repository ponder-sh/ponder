import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const build = async () => {
  const raw = await readFile(path.join(__dirname, './index.js'), 'utf-8')
  const escaped = raw.replaceAll('`', '\\`').replaceAll('$', '\\$')
  const final = `\nmodule.exports.graphTsStaticString = \`${escaped}\``

  await appendFile(path.join(__dirname, './index.js'), final)
}

build().catch(console.error)
