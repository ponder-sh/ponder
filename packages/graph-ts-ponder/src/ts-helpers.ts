export type u8 = number
export type u16 = number
export type u32 = number
export type u64 = number
export type i8 = number
export type i16 = number
export type i32 = number
export type i64 = number
export type f32 = number
export type f64 = number

export type usize = number
export type Int64Array = number
export type Uint64Array = number
export type bool = boolean

export const idof = <T>() => 1

export const changetype = <T>(obj: unknown) => obj as T

export const assert = (isValid: boolean, message: string) => {
  if (!isValid) throw new Error(message)
}

export const abort = (message: string) => {
  throw new Error(message)
}
