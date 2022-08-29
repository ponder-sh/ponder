import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const build = async () => {
  const raw = await readFile(path.join(__dirname, './index.js'), 'utf-8')
  const escaped = raw.replaceAll('`', '\\`').replaceAll('$', '\\$')
  const graphTsStaticString = `\nmodule.exports.graphTsStaticString = \`${escaped}\``
  const injectFilePath = `\nmodule.exports.injectFilePath = \`${path.join(
    __dirname,
    './inject.js',
  )}\``

  await appendFile(
    path.join(__dirname, './index.js'),
    graphTsStaticString + injectFilePath,
  )
}

build().catch(console.error)
