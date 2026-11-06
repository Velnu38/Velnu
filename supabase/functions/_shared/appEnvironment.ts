// Public routing configuration, not credentials. Unknown projects fail closed.
const environments = {
  'https://xvybcmyoblfgzokaifsx.supabase.co': {
    name: 'staging',
    baseUrl: 'https://finviant.com',
    origins: [
      'https://finviant.com', 'https://www.finviant.com',
      'https://finviant-office-git-feature-velnu-stage1-mbarone5-1747.vercel.app',
      'https://finviant-office-git-ux-private-testing-20261029-mbarone5-1747.vercel.app',
      'https://finviant-office-9h30ixf54-mbarone5-1747.vercel.app',
      'http://localhost:5173', 'http://127.0.0.1:5173',
    ],
  },
  'https://qusmeexjbwphoezlcmie.supabase.co': {
    name: 'production',
    baseUrl: 'https://finviant.com',
    origins: ['https://finviant.com', 'https://www.finviant.com'],
  },
} as const

export function resolveAppEnvironment(projectUrl: string | undefined, configuredOrigin?: string, qaProjectRef?: string) {
  const environment = projectUrl && Object.hasOwn(environments, projectUrl)
    ? environments[projectUrl as keyof typeof environments] : undefined
  if (qaProjectRef) {
    if (environment || !/^[a-z]{20}$/.test(qaProjectRef)
      || projectUrl !== `https://${qaProjectRef}.supabase.co`
      || !configuredOrigin || !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app$/.test(configuredOrigin)
      || Object.values(environments).some(({ origins }) => (origins as readonly string[]).includes(configuredOrigin))) return null
    return { name: 'qa' as const, baseUrl: configuredOrigin, origins: [configuredOrigin] }
  }
  if (!environment) return null
  const baseUrl = configuredOrigin || environment.baseUrl
  const origins: readonly string[] = environment.origins
  if (!baseUrl.startsWith('https://') || !origins.includes(baseUrl)) return null
  return { name: environment.name, baseUrl, origins }
}
