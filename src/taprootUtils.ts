// Helper for p2tr x-only pubkey manipulations
export function toXOnly(pubkey: Buffer): Buffer {
  // remove 0x02/0x03 prefix
  return pubkey.slice(1, 33);
}
