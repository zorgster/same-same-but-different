export const DECODE_CHAR = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));

export const RC_DECODE_CHAR = [...DECODE_CHAR];
RC_DECODE_CHAR[65] = "T"; RC_DECODE_CHAR[84] = "A";
RC_DECODE_CHAR[67] = "G"; RC_DECODE_CHAR[71] = "C";
RC_DECODE_CHAR[97] = "t"; RC_DECODE_CHAR[116] = "a";
RC_DECODE_CHAR[99] = "g"; RC_DECODE_CHAR[103] = "c";

export function decodeRead(m) {
  const bytes = m.seqBytes;
  const n = bytes.length;
  const out = new Array(n);
  if (m.orientation === 0) {
    for (let i = 0; i < n; i++) out[i] = RC_DECODE_CHAR[bytes[n - 1 - i]];
  } else {
    for (let i = 0; i < n; i++) out[i] = DECODE_CHAR[bytes[i]];
  }
  return out.join("");
}
