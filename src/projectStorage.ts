import JSZip from 'jszip'
import type { Project, ProjectFile, ProjectFileKind } from './project'

const storageKey = 'glpython-project'

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

export function loadLocalProject(fallback: Project): Project {
  const savedProject = localStorage.getItem(storageKey)
  if (!savedProject) return fallback

  try {
    return JSON.parse(savedProject) as Project
  } catch {
    return fallback
  }
}

export function saveLocalProject(project: Project): void {
  localStorage.setItem(storageKey, JSON.stringify(project))
}

export function clearLocalProject(): void {
  localStorage.removeItem(storageKey)
}

export async function exportProjectZip(project: Project): Promise<Blob> {
  const zip = new JSZip()
  for (const file of Object.values(project.files)) zip.file(file.path, file.code)
  zip.file('glpython.json', JSON.stringify({ name: project.name, mainFile: project.mainFile }, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

export async function importProjectZip(file: File, fallback: Project): Promise<Project> {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name !== 'glpython.json' && !entry.name.startsWith('__MACOSX/'))
  const metadataEntry = zip.file('glpython.json')
  const metadata = metadataEntry ? JSON.parse(await metadataEntry.async('text')) as { name?: string; mainFile?: string } : {}
  const files = await Promise.all(entries.map(async (entry) => {
    const path = entry.name.replace(/^\/+/, '')
    const code = await entry.async('text')
    return [path, createProjectFile(path, code)] as const
  }))
  const importedFiles = Object.fromEntries(files)
  const pythonFiles = Object.values(importedFiles).filter((entry) => entry.kind === 'python')
  const mainFile = metadata.mainFile && importedFiles[metadata.mainFile]
    ? metadata.mainFile
    : pythonFiles[0]?.path ?? Object.keys(importedFiles)[0]

  return { ...fallback, name: metadata.name || file.name.replace(/\.zip$/i, '') || fallback.name, mainFile, files: importedFiles }
}

export async function importProjectFolder(fallback: Project): Promise<Project | null> {
  const pickerWindow = window as DirectoryPickerWindow
  if (!pickerWindow.showDirectoryPicker) return null

  const directory = await pickerWindow.showDirectoryPicker()
  const files: ProjectFile[] = []
  await readDirectory(directory, '', files)
  const importedFiles = Object.fromEntries(files.map((file) => [file.path, file]))
  const pythonFiles = files.filter((file) => file.kind === 'python')
  const metadata = await readProjectMetadata(directory)
  const mainFile = metadata.mainFile && importedFiles[metadata.mainFile]
    ? metadata.mainFile
    : importedFiles['main.py']
      ? 'main.py'
      : pythonFiles[0]?.path ?? files[0]?.path
  return { ...fallback, name: metadata.name || directory.name, mainFile, files: importedFiles }
}

async function readProjectMetadata(directory: FileSystemDirectoryHandle): Promise<{ name?: string; mainFile?: string }> {
  try {
    const metadataHandle = await directory.getFileHandle('glpython.json')
    const metadataFile = await metadataHandle.getFile()
    return JSON.parse(await metadataFile.text()) as { name?: string; mainFile?: string }
  } catch {
    return {}
  }
}

async function readDirectory(directory: FileSystemDirectoryHandle, prefix: string, files: ProjectFile[]): Promise<void> {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'file') {
      const file = await handle.getFile()
      if (file.name === 'glpython.json' || file.name.startsWith('.')) continue
      files.push(createProjectFile(path, await file.text()))
    } else {
      await readDirectory(handle, path, files)
    }
  }
}

function createProjectFile(path: string, code: string): ProjectFile {
  const extension = path.split('.').pop()?.toLowerCase()
  const kind: ProjectFileKind = extension === 'py' ? 'python' : 'text'
  return { path, label: path.split('/').pop()?.replace(/\.[^/.]+$/, '') || path, code, kind }
}
