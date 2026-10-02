import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Project, ProjectFile } from './project'

// URL query parameter used to carry a whole project (name, main file, and
// every file's path/label/kind/code), the same idea as webTigerPython's
// `?code=` parameter but extended to a full multi-file project instead of a
// single source string.
const SHARE_PARAM = 'project'
const SCHEMA_VERSION = 1

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
  url.searchParams.set(SHARE_PARAM, encodeProjectForUrl(project))
  return url.toString()
}

// Reads a shared project out of the current page URL (if present) and
// strips the parameter from the address bar afterwards, so reloading or
// re-sharing doesn't keep re-importing the same snapshot.
export function consumeSharedProjectFromLocation(): Project | null {
  const url = new URL(window.location.href)
  const encoded = url.searchParams.get(SHARE_PARAM)
  if (!encoded) return null

  const project = decodeProjectFromUrl(encoded)
  url.searchParams.delete(SHARE_PARAM)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  return project
}
