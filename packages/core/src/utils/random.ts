import { Effect, Random } from "effect";

const HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

/**
 * Generates a version 4 UUID with the `Random` service.
 *
 * @dev Not cryptographically secure. Only use for identifiers, such as request ids.
 */
export const randomUUID: Effect.Effect<string> = Effect.map(
  Random.Random,
  (random) => {
    const bytes = new Array<number>(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(random.nextDoubleUnsafe() * 256);
    }

    // Version 4, variant 1
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = bytes.map((byte) => HEX[byte]!);
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  },
);
