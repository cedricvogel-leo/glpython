// Libraries by URL (P25): a share link can name a library - e.g. a course's
// parser.py - by its URL instead of carrying its code. The IDE fetches it
// once, when the link opens, and keeps the text with the tab's project, so a
// reload and offline work use that copy. As in the LiaScript macro, a
// library that can't be loaded is reported and left out: importing it then
// raises Python's own ModuleNotFoundError.

// A library's state in the tab's project: being fetched, fetched (its code is
// then a read-only file of the project), or failed (with the reason).
export type LibraryState = { url: string; status: 'loading' | 'loaded' | 'failed'; failure?: string }

export type LibraryStrings = { networkError: string; timeout: string; libraryTooLarge: string; libraryNotHttps: string }

const MAX_LIBRARY_LENGTH = 1_000_000
const FETCH_TIMEOUT_MS = 15_000

// https, and http only on this computer (a course tested locally).
function allowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  } catch {
    return false
  }
}

export function libraryHost(url: string): string {
  try { return new URL(url).host } catch { return url }
}

export async function fetchLibrary(url: string, strings: LibraryStrings): Promise<{ code: string } | { failure: string }> {
  if (!allowedUrl(url)) return { failure: strings.libraryNotHttps }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-cache' })
    if (!response.ok) return { failure: `HTTP ${response.status}` }
    const code = await response.text()
    if (code.length > MAX_LIBRARY_LENGTH) return { failure: strings.libraryTooLarge }
    return { code }
  } catch (error) {
    // No network and a server without CORS look the same to a page.
    return { failure: (error as Error)?.name === 'AbortError' ? strings.timeout : strings.networkError }
  } finally {
    window.clearTimeout(timer)
  }
}
