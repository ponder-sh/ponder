const fs = require('fs')
const asc = require('assemblyscript/cli/asc')
const path = require('path')
const { StringDecoder } = require('string_decoder')

async function main() {
  // Copy index.ts to a temporary subdirectory so that asc doesn't put all the
  // index.ts exports in the global namespace.
  if (!fs.existsSync('test/temp_lib')) {
    fs.mkdirSync('test/temp_lib')
  }

  if (!fs.existsSync('test/temp_out')) {
    fs.mkdirSync('test/temp_out')
  }

  if (!fs.existsSync('test/temp_lib/chain')) {
    fs.mkdirSync('test/temp_lib/chain')
  }

  if (!fs.existsSync('test/temp_lib/common')) {
    fs.mkdirSync('test/temp_lib/common')
  }

  fs.copyFileSync('common/collections.ts', 'test/temp_lib/common/collections.ts')
  fs.copyFileSync('common/conversion.ts', 'test/temp_lib/common/conversion.ts')
  fs.copyFileSync('common/datasource.ts', 'test/temp_lib/common/datasource.ts')
  fs.copyFileSync('common/eager_offset.ts', 'test/temp_lib/common/eager_offset.ts')
  fs.copyFileSync('common/json.ts', 'test/temp_lib/common/json.ts')
  fs.copyFileSync('common/numbers.ts', 'test/temp_lib/common/numbers.ts')
  fs.copyFileSync('common/value.ts', 'test/temp_lib/common/value.ts')
  fs.copyFileSync('chain/arweave.ts', 'test/temp_lib/chain/arweave.ts')
  fs.copyFileSync('chain/ethereum.ts', 'test/temp_lib/chain/ethereum.ts')
  fs.copyFileSync('chain/near.ts', 'test/temp_lib/chain/near.ts')
  fs.copyFileSync('chain/cosmos.ts', 'test/temp_lib/chain/cosmos.ts')
  fs.copyFileSync('index.ts', 'test/temp_lib/index.ts')

  try {
    const outputWasmPath = 'test/temp_out/test.wasm'

    const promises = {}
    promises['bigInt'] = testFile('test/bigInt.ts', outputWasmPath)
    promises['bytes'] = testFile('test/bytes.ts', outputWasmPath)
    promises['entity'] = testFile('test/entity.ts', outputWasmPath)

    const entries = Object.entries(promises)
    const results = await Promise.allSettled(entries.map((entry) => entry[1]))
    const failures = Object.fromEntries(
      results
        .map((result, index) => [entries[index][0], result])
        .filter(([index, result]) => result.status === 'rejected'),
    )

    if (Object.keys(failures).length > 0) {
      throw failures
    }
  } finally {
    fs.unlinkSync('test/temp_lib/common/collections.ts')
    fs.unlinkSync('test/temp_lib/common/conversion.ts')
    fs.unlinkSync('test/temp_lib/common/datasource.ts')
    fs.unlinkSync('test/temp_lib/common/eager_offset.ts')
    fs.unlinkSync('test/temp_lib/common/json.ts')
    fs.unlinkSync('test/temp_lib/common/numbers.ts')
    fs.unlinkSync('test/temp_lib/common/value.ts')
    fs.rmdirSync('test/temp_lib/common')
    fs.unlinkSync('test/temp_lib/chain/arweave.ts')
    fs.unlinkSync('test/temp_lib/chain/ethereum.ts')
    fs.unlinkSync('test/temp_lib/chain/near.ts')
    fs.unlinkSync('test/temp_lib/chain/cosmos.ts')
    fs.rmdirSync('test/temp_lib/chain')
    fs.unlinkSync('test/temp_lib/index.ts')
    fs.rmdirSync('test/temp_lib')
    fs.unlinkSync('test/temp_out/test.wasm')
    fs.rmdirSync('test/temp_out')
  }
}

async function testFile(sourceFile, outputWasmPath) {
  console.log(`Compiling test file ${sourceFile} to WASM...`)
  if (
    asc.main([
      '--explicitStart',
      '--exportRuntime',
      '--importMemory',
      '--runtime',
      'stub',
      sourceFile,
      '--lib',
      'test',
      '-b',
      outputWasmPath,
    ]) != 0
  ) {
    throw Error('Failed to compile')
  }

  const wasmCode = new Uint8Array(fs.readFileSync(outputWasmPath))
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 })
  const module = await WebAssembly.instantiate(wasmCode, {
    env: {
      memory,
      abort: function (messagePtr, fileNamePtr, lineNumber, columnNumber) {
        let fileSource = path.join(__dirname, '..', sourceFile)
        let message = 'assertion failure'
        if (messagePtr !== 0) {
          message += `: ${getString(memory, messagePtr)}`
        }

        throw new Error(`${message} (${fileSource}:${lineNumber}:${columnNumber})`)
      },
    },
    conversion: {
      'typeConversion.bytesToHex': function () {},
    },
  })

  // Call AS start explicitly
  module.instance.exports._start()

  console.log(`Running "${sourceFile}" tests...`)
  for (const [testName, testFn] of Object.entries(module.instance.exports)) {
    if (typeof testFn === 'function' && testName.startsWith('test')) {
      console.log(`Running "${testName}"...`)
      testFn()
    }
  }
}

function getString(memory, addr) {
  let byteCount = Buffer.from(new Uint8Array(memory.buffer, addr - 4, 4)).readInt32LE()
  let buffer = new Uint8Array(memory.buffer, addr, byteCount)
  let encoder = new StringDecoder('utf16le')

  return encoder.write(buffer)
}

main().catch((error) => {
  console.error('Test suite failed', error)

  process.exit(1)
})
