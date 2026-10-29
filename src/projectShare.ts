import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Project, ProjectFile } from 'glpython-editor'

// URL query parameter used to carry a whole project (name, main file, and
// every file's path/label/kind/code, and readOnly for a file to read only,
// e.g. a course's library), the same idea as webTigerPython's
// `?code=` parameter but extended to a full multi-file project instead of a
// single source string.
const SHARE_PARAM = 'project'
const SCHEMA_VERSION = 1
// GitHub Pages answers "414 URI Too Long" when a request's path and query
// exceed 8192 characters - a program of roughly 5,000 to 30,000 characters,
// depending on how well it compresses. A longer link carries the project in
// the fragment instead ("#project=..."), which the browser never sends to
// the server. The glpython LiaScript macro builds its «In IDE öffnen» links
// the same way.
const MAX_PATH_AND_QUERY = 8192

type SharedProjectPayload = {
  v: number
  name: string
  mainFile: string
  files: Record<string, ProjectFile>
}

function isProjectFile(value: unknown): value is ProjectFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<ProjectFile>
  return typeof file.path === 'string' && typeof file.label === 'string' && typeof file.code === 'string' && (file.kind === 'python' || file.kind === 'text')
    && (file.readOnly === undefined || typeof file.readOnly === 'boolean')
}

function isSharedProjectPayload(value: unknown): value is SharedProjectPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<SharedProjectPayload>
  if (typeof payload.name !== 'string' || typeof payload.mainFile !== 'string' || !payload.files || typeof payload.files !== 'object') return false
  return Object.values(payload.files).every(isProjectFile)
}

export function encodeProjectForUrl(project: Project): string {
  const payload: SharedProjectPayload = { v: SCHEMA_VERSION, name: project.name, mainFile: project.mainFile, files: project.files }
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function decodeProjectFromUrl(encoded: string): Project | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    const payload = JSON.parse(json) as unknown
    if (!isSharedProjectPayload(payload) || !payload.files[payload.mainFile]) return null

    return {
      id: `shared-${Date.now()}`,
      name: payload.name.trim() || 'Shared project',
      mainFile: payload.mainFile,
      files: payload.files,
    }
  } catch {
    return null
  }
}

export function buildShareUrl(project: Project): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin)
  const encoded = encodeProjectForUrl(project)
  url.searchParams.set(SHARE_PARAM, encoded)
  if (url.pathname.length + url.search.length <= MAX_PATH_AND_QUERY) return url.toString()
  url.search = ''
  url.hash = new URLSearchParams({ [SHARE_PARAM]: encoded }).toString()
  return url.toString()
}

// Reads a shared project out of the current page URL (if present, in the
// query or, for a long one, the fragment) and strips it from the address bar
// afterwards, so reloading or re-sharing doesn't keep re-importing the same
// snapshot.
export function consumeSharedProjectFromLocation(): Project | null {
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  const encoded = url.searchParams.get(SHARE_PARAM) ?? fragment.get(SHARE_PARAM)
  if (!encoded) return null

  const project = decodeProjectFromUrl(encoded)
  url.searchParams.delete(SHARE_PARAM)
  fragment.delete(SHARE_PARAM)
  url.hash = fragment.toString()
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  return project
}
