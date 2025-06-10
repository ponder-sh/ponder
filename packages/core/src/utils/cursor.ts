import { BaseError, type Hex, size } from "viem";

export type Cursor = {
  data: Hex;
  position: number;

  positionReadCount: Map<number, number>;
  recursiveReadCount: number;
  recursiveReadLimit: number;
};

type CursorConfig = { recursiveReadLimit?: number | undefined };

export const createCursor = (
  data: Hex,
  { recursiveReadLimit = 8_192 }: CursorConfig = {},
): Cursor => {
  return {
    data,
    position: 0,
    recursiveReadCount: 0,
    positionReadCount: new Map(),
    recursiveReadLimit,
  };
};

export type PositionOutOfBoundsErrorType = PositionOutOfBoundsError & {
  name: "PositionOutOfBoundsError";
};
export class PositionOutOfBoundsError extends BaseError {
  constructor({ length, position }: { length: number; position: number }) {
    super(
      `Position \`${position}\` is out of bounds (\`0 < position < ${length}\`).`,
      { name: "PositionOutOfBoundsError" },
    );
  }
}

function assertPosition(cursor: Cursor, position: number) {
  if (position < 0 || position > size(cursor.data) - 1)
    throw new PositionOutOfBoundsError({
      length: size(cursor.data),
      position,
    });
}

export type RecursiveReadLimitExceededErrorType =
  RecursiveReadLimitExceededError & {
    name: "RecursiveReadLimitExceededError";
  };
export class RecursiveReadLimitExceededError extends BaseError {
  constructor({ count, limit }: { count: number; limit: number }) {
    super(
      `Recursive read limit of \`${limit}\` exceeded (recursive read count: \`${count}\`).`,
      { name: "RecursiveReadLimitExceededError" },
    );
  }
}

function assertReadLimit(cursor: Cursor): void {
  if (cursor.recursiveReadCount >= cursor.recursiveReadLimit)
    throw new RecursiveReadLimitExceededError({
      count: cursor.recursiveReadCount + 1,
      limit: cursor.recursiveReadLimit,
    });
}

function _touch(cursor: Cursor) {
  if (cursor.recursiveReadLimit === Number.POSITIVE_INFINITY) return;
  const count = getReadCount(cursor);
  cursor.positionReadCount.set(cursor.position, count + 1);
  if (count > 0) cursor.recursiveReadCount++;
}

function getReadCount(cursor: Cursor, position?: number) {
  return cursor.positionReadCount.get(position || cursor.position) || 0;
}

function convertPosition(position: number) {
  return position * 2 + 2;
}

export function setPosition(cursor: Cursor, position: number) {
  const oldPosition = cursor.position;
  assertPosition(cursor, position);
  cursor.position = position;
  return () => (cursor.position = oldPosition);
}

export function readBytes(cursor: Cursor, length: number, size?: number): Hex {
  assertReadLimit(cursor);
  _touch(cursor);
  const value = inspectBytes(cursor, length);
  cursor.position += size ?? length;
  return `0x${value}`;
}

function inspectBytes(
  cursor: Cursor,
  length: number,
  position_?: number,
): string {
  const position = position_ ?? cursor.position;
  assertPosition(cursor, position + length - 1);

  return cursor.data.substring(
    convertPosition(position),
    convertPosition(position + length),
  );
}
