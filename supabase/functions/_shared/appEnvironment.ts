// Public routing configuration, not credentials. Unknown projects fail closed.
const environments = {
  'https://xvybcmyoblfgzokaifsx.supabase.co': {
    name: 'staging',
    baseUrl: 'https://finviant-office-git-feature-velnu-stage1-mbarone5-1747.vercel.app',
    origins: [
      'https://finviant-office-git-feature-velnu-stage1-mbarone5-1747.vercel.app',
      'http://localhost:5173', 'http://127.0.0.1:5173',
    ],
  },
  'https://qusmeexjbwphoezlcmie.supabase.co': {
    name: 'production',
    baseUrl: 'https://finviant.com',
    origins: ['https://finviant.com', 'https://www.finviant.com'],
  },
} as const

export function resolveAppEnvironment(projectUrl: string | undefined, configuredOrigin?: string) {
  const environment = environments[projectUrl as keyof typeof environments]
  if (!environment) return null
  const baseUrl = configuredOrigin || environment.baseUrl
  const origins: readonly string[] = environment.origins
  if (!baseUrl.startsWith('https://') || !origins.includes(baseUrl)) return null
  return { name: environment.name, baseUrl, origins }
}
