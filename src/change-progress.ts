// Reads openspec/changes from disk and works out each change's stage. All disk access goes
// through `Files`, so tests can stand in for the file system.
import { dependsOn, numberChanges, readCreated, readOrder, readPin } from './change-order'
import type { ChangeArea, ChangeRow, ChangeStage, Count, Library } from './protocol'

export interface Files {
  /** Names of the folders and files in a folder, or null when it does not exist. */
  list(path: string): Promise<string[] | null>
  /** File text, or null when it does not exist. */
  text(path: string): Promise<string | null>
}

const ARCHIVE = 'archive'
const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]/gm

export function countTasks(markdown: string): Count {
  let done = 0
  let total = 0
  for (const match of markdown.matchAll(TASK_LINE)) {
    total += 1
    if (match[1] !== ' ') {
      done += 1
    }
  }
  return { done, total }
}

/** Cuts a markdown file at each `##` heading. `preface` is the text before the first one. */
export function splitSections(markdown: string): { preface: string; sections: string[] } {
  const parts = markdown.replace(/\n+$/, '').split(/\n(?=## )/)
  const first = parts[0] ?? ''
  if (first.startsWith('## ')) {
    return { preface: '', sections: parts }
  }
  return { preface: first, sections: parts.slice(1) }
}

/** One unticked task of a tasks.md and the heading it sits under. */
export interface OpenTask {
  section: string | null
  text: string
}

export function openTasks(markdown: string): OpenTask[] {
  const found: OpenTask[] = []
  let section: string | null = null
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const task = /^\s*[-*]\s+\[ \]\s*(.*)$/.exec(line)
    if (heading) {
      section = heading[1].trim()
    } else if (task) {
      found.push({ section, text: task[1].trim() })
    }
  }
  return found
}

/** Planning until all four artefacts exist; then ready, in progress, complete by task ticks. */
export function stageOf(artefacts: Count, tasks: Count): ChangeStage {
  if (artefacts.done < artefacts.total) {
    return 'planning'
  }
  if (tasks.total > 0 && tasks.done === tasks.total) {
    return 'complete'
  }
  return tasks.done > 0 ? 'in-progress' : 'ready'
}

/** One change before its run order is known: the row, plus what the order needs. */
interface ReadChange {
  row: Omit<ChangeRow, 'order' | 'manual' | 'pin'>
  proposal: string | null
  yaml: string | null
}

async function readChange(files: Files, changesDir: string, name: string): Promise<ReadChange> {
  const dir = `${changesDir}/${name}`
  // The default spec-driven schema: proposal, design, specs and tasks.
  const [proposal, design, tasks, specs, yaml] = await Promise.all([
    files.text(`${dir}/proposal.md`),
    files.text(`${dir}/design.md`),
    files.text(`${dir}/tasks.md`),
    files.list(`${dir}/specs`),
    files.text(`${dir}/.openspec.yaml`)
  ])
  const present = [proposal, design, tasks].filter((text) => text !== null).length + (specs && specs.length > 0 ? 1 : 0)
  const artefacts = { done: present, total: 4 }
  const taskCount = tasks ? countTasks(tasks) : { done: 0, total: 0 }
  return { row: { name, stage: stageOf(artefacts, taskCount), artefacts, tasks: taskCount }, proposal, yaml }
}

/** Folder of each area, relative to the workspace. */
export const AREA_ROOT: Record<ChangeArea, string> = {
  changes: 'openspec/changes',
  archive: 'openspec/changes/archive',
  specs: 'openspec/specs'
}

/** True when `name`, inside `dir`, is a real folder and not a dot name. A plain file such as notes.txt lists as null. */
export async function isFolder(files: Files, dir: string, name: string): Promise<boolean> {
  return !name.startsWith('.') && (await files.list(`${dir}/${name}`)) !== null
}

/** The markdown files of a folder, relative to it. A main spec has `spec.md` only; a change has proposal, design, tasks, then each spec. */
export async function listChangeFiles(files: Files, dir: string, area: ChangeArea = 'changes'): Promise<string[]> {
  if (area === 'specs') {
    return (await files.text(`${dir}/spec.md`)) !== null ? ['spec.md'] : []
  }
  const found: string[] = []
  for (const name of ['proposal.md', 'design.md', 'tasks.md']) {
    if ((await files.text(`${dir}/${name}`)) !== null) {
      found.push(name)
    }
  }
  for (const capability of ((await files.list(`${dir}/specs`)) ?? []).sort()) {
    if ((await files.text(`${dir}/specs/${capability}/spec.md`)) !== null) {
      found.push(`specs/${capability}/spec.md`)
    }
  }
  return found
}

/** The archived changes (newest first, as their names start with the date) and the main specs of a workspace. */
export async function readLibrary(files: Files, workspacePath: string): Promise<Library> {
  const names = async (area: ChangeArea): Promise<string[]> => {
    const dir = `${workspacePath}/${AREA_ROOT[area]}`
    const all = (await files.list(dir)) ?? []
    const folder = await Promise.all(all.map((name) => isFolder(files, dir, name)))
    return all.filter((_, i) => folder[i]).sort()
  }
  return { archive: (await names('archive')).reverse(), specs: await names('specs') }
}

/** null when the workspace has no openspec/changes folder. Folders only; `archive` is skipped. */
export async function readChanges(files: Files, workspacePath: string): Promise<ChangeRow[] | null> {
  const changesDir = `${workspacePath}/openspec/changes`
  const names = await files.list(changesDir)
  if (!names) {
    return null
  }
  const read: ReadChange[] = []
  for (const name of names.filter((entry) => entry !== ARCHIVE && !entry.startsWith('.')).sort()) {
    // A plain file such as README.md has no proposal folder, so it lists as null and is skipped.
    if ((await files.list(`${changesDir}/${name}`)) !== null) {
      read.push(await readChange(files, changesDir, name))
    }
  }
  const all = read.map(({ row }) => row.name)
  const order = numberChanges(
    read.map(({ row, proposal, yaml }) => ({
      name: row.name,
      created: readCreated(yaml),
      manual: readOrder(yaml),
      deps: dependsOn(proposal, all, row.name)
    }))
  )
  return read
    .map(({ row, yaml }) => ({ ...row, order: order.get(row.name) ?? 0, manual: readOrder(yaml) !== null, pin: readPin(yaml) }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}
