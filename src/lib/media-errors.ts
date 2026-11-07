export function micErrorMessage(error: unknown, secure: boolean): string {
  if (!secure) {
    return 'The microphone needs HTTPS or localhost. A phone opened over plain http:// on the local network cannot use the mic.'
  }
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone permission was denied. You can still listen.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. You can still listen.'
  }
  if (name === 'NotReadableError') return 'The microphone is in use by another app. You can still listen.'
  if (name === 'SecurityError') return 'This page is not allowed to use the microphone.'
  if (error instanceof Error && error.message) return error.message
  return 'Microphone unavailable. You can still listen.'
}
