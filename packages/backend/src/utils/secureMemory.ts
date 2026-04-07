/**
 * Best-effort cryptographic zeroization for Buffer-backed sensitive material.
 *
 * JavaScript provides no real "secure memory" primitive — strings are immutable
 * and the GC makes pinning impossible without native bindings. Buffers, however,
 * are mutable byte arrays that we *can* overwrite before releasing the reference.
 * This minimizes the window during which sensitive plaintext lives in the heap
 * and protects against memory-disclosure attacks (process dumps, swap, debugger
 * attach, etc.). See OWASP "Cryptographic Storage Cheat Sheet" and NIST SP 800-88.
 */
export function zeroBuffer(buf: Buffer | null | undefined): void {
  if (buf && buf.length > 0) {
    buf.fill(0);
  }
}
