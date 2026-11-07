export function sanitizeDevice(value: string | null | undefined): { ok: true; device: string | null } | { ok: false; message: string } {
  if (!value) return { ok: true, device: null }
  if (!/^[A-Za-z0-9:_.,=-]{1,64}$/.test(value)) {
    return { ok: false, message: 'Audio device names can only use letters, numbers, and : _ . , = -' }
  }
  return { ok: true, device: value }
}
