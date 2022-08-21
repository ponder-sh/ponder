import { readFile } from 'node:fs/promises'

const getStaticGraphTs = async () => {
  const graphTsStaticString = await readFile('./dist/graph-ts-static.js', 'utf-8')

  console.log({ graphTsStaticString })
}

export { getStaticGraphTs }
