export type SiteSurface = 'talk' | 'admin' | 'combined'

export function hostnameOf(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? ''
  if (!trimmed) return null
  try {
    if (trimmed.includes('://')) return new URL(trimmed).hostname
  } catch {
    return null
  }
  const host = trimmed.split('/')[0]?.split(':')[0] ?? ''
  return host || null
}

export function requestHostname(header: string | undefined): string {
  return hostnameOf(header) ?? ''
}

/** Split traffic only when both hosts are configured. Anything else stays one site, including Render. */
export function siteSurface(host: string, publicHost: string | null, adminHost: string | null): SiteSurface {
  if (!publicHost || !adminHost || publicHost === adminHost) return 'combined'
  if (host === adminHost) return 'admin'
  if (host === publicHost) return 'talk'
  return 'talk'
}

/** Prefer the public Host when it is one of the configured names. Otherwise use the first X-Forwarded-Host, which a tunnel may send. */
export function surfaceFromHeaders(hostHeader: string | undefined, forwardedHost: string | undefined, publicHost: string | null, adminHost: string | null): SiteSurface {
  const direct = requestHostname(hostHeader)
  const forwarded = hostnameOf(forwardedHost?.split(',')[0]) ?? ''
  const known = publicHost && adminHost && (direct === publicHost || direct === adminHost)
  return siteSurface(known ? direct : forwarded || direct, publicHost, adminHost)
}

export function isAdminApi(pathname: string): boolean {
  return pathname === '/api/control' || pathname.startsWith('/api/control/') || pathname === '/api/demo' || pathname.startsWith('/api/demo/')
}
