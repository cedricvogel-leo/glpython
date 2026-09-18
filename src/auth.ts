import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID || 'common'

export const loginRequest = {
  scopes: ['User.Read'],
}

export const isAuthConfigured = Boolean(clientId)

const msalInstance = isAuthConfigured
  ? new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: 'sessionStorage',
      },
    })
  : null

let initialization: Promise<void> | null = null

export async function initializeAuth(): Promise<AccountInfo | null> {
  if (!msalInstance) return null
  initialization ??= msalInstance.initialize().then(async () => {
    await msalInstance.handleRedirectPromise()
    const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0]
    if (account) msalInstance.setActiveAccount(account)
  })
  await initialization
  return msalInstance.getActiveAccount()
}

// Sign-in uses a full-page redirect rather than a popup. Cross-origin
// isolation (required for the input() dialog's SharedArrayBuffer bridge)
// severs the window.opener link that MSAL's popup flow depends on, so the
// redirect flow is used to stay compatible.
export async function signIn(): Promise<void> {
  if (!msalInstance) return
  await initializeAuth()
  await msalInstance.loginRedirect(loginRequest)
}

export async function signOut(): Promise<void> {
  if (!msalInstance) return
  await initializeAuth()
  await msalInstance.logoutRedirect({ account: msalInstance.getActiveAccount() ?? undefined })
}
