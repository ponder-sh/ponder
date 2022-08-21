import { readFile } from 'node:fs/promises'
import path from 'node:path'

const getStaticGraphTs = async () => {
  const graphTsStaticString = await readFile(
    path.join(__dirname, 'graph-ts-static.js'),
    'utf-8',
  )

  return graphTsStaticString
}

export { getStaticGraphTs }
