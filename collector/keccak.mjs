const MASK_64 = (1n << 64n) - 1n;
const ROTATION = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14
];
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

export function keccak256Hex(value) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const rate = 136;
  const paddedLength = Math.ceil((input.length + 1) / rate) * rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const state = Array.from({ length: 25 }, () => 0n);

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane += 1) {
      let word = 0n;
      for (let byte = 0; byte < 8; byte += 1) {
        word |= BigInt(padded[offset + lane * 8 + byte]) << BigInt(byte * 8);
      }
      state[lane] ^= word;
    }
    permute(state);
  }

  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number((state[Math.floor(index / 8)] >> BigInt((index % 8) * 8)) & 0xffn);
  }
  return `0x${[...output].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function permute(state) {
  for (const roundConstant of ROUND_CONSTANTS) {
    const column = Array(5).fill(0n);
    const delta = Array(5).fill(0n);
    const mixed = Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) column[x] ^= state[x + 5 * y];
    }
    for (let x = 0; x < 5; x += 1) {
      delta[x] = column[(x + 4) % 5] ^ rotate(column[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] ^= delta[x];
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        mixed[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(state[x + 5 * y], ROTATION[x + 5 * y]);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = mixed[x + 5 * y] ^ ((~mixed[(x + 1) % 5 + 5 * y]) & mixed[(x + 2) % 5 + 5 * y]);
      }
    }
    state[0] ^= roundConstant;
  }
}

function rotate(value, offset) {
  if (offset === 0) return value & MASK_64;
  const shift = BigInt(offset);
  return ((value << shift) | (value >> (64n - shift))) & MASK_64;
}
