import { createHash } from "node:crypto";

export const PAYLOAD_BYTES = 1024 * 1024;
// Versioned, deterministic pseudo-random bytes resist compression. No user data.
export const PAYLOAD = Buffer.alloc(PAYLOAD_BYTES);
let state = 0x6d2b79f5;
for (let i = 0; i < PAYLOAD.length; i++) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  PAYLOAD[i] = state & 255;
}
export const PAYLOAD_SHA256 = createHash("sha256").update(PAYLOAD).digest("hex");
