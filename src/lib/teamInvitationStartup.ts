const invitationStorageKey = 'finviant-team-invitation'
const validInvitation = (value: string | null): value is string => !!value && /^[a-f0-9]{64}$/.test(value)

type InvitationStartupEnvironment = {
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'>
  replaceUrl: (url: string) => void
}

export function getStartupTeamInvitation(query: URLSearchParams, environment: InvitationStartupEnvironment): string | null {
  const urlInvitation = query.get('invite')
  if (validInvitation(urlInvitation)) {
    // Keep the invitation in the URL if storage is unavailable, so reloading
    // does not lose the only copy of the invitation.
    try {
      environment.getStorage().setItem(invitationStorageKey, urlInvitation)
    } catch {
      return urlInvitation
    }
    try { environment.replaceUrl('/auth') } catch { /* The URL can safely stay unchanged. */ }
    return urlInvitation
  }

  try {
    const storedInvitation = environment.getStorage().getItem(invitationStorageKey)
    return validInvitation(storedInvitation) ? storedInvitation : null
  } catch {
    return null
  }
}
