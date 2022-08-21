import { BigDecimal, BigInt } from 'temp_lib/index'
import { Entity, Bytes } from 'temp_lib/index'

export function testEntity(): void {
  let entity = new Entity()

  entity.setBytes('x', new Bytes(1))
  assert(entity.getBytes('x') == new Bytes(1))

  entity.setBoolean('x', true)
  assert(entity.getBoolean('x') == true)

  entity.setBigDecimal('x', new BigDecimal(BigInt.fromI32(2)))
  assert(entity.getBigDecimal('x') !== null)
}
