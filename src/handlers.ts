// The worker's logic. `register` takes the Io so tests can replace the disk and git.
import type { OrcaWorkerApi } from 'orca/worker'
import { AREA_ROOT, isFolder, listChangeFiles, openTasks, readChanges, readLibrary, type Files } from './change-progress'
import { writeOrder, writePin } from './change-order'
import type { ChangeRef, ChangesSnapshot, WorkspaceView } from './protocol'

export interface Io extends Files {
  /** Replaces a file's text. */
  write(path: string, text: string): Promise<void>
  /** Absolute git common directory of a checkout: the same for a repo and all its worktrees. Null outside git. */
  gitCommonDir(cwd: string): Promise<string | null>
}

/** One row of the host's `workspace.list`. */
interface Workspace {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  path: string
  branch: string | null
  hostId: string | null
}

const MEMORY_NOTE =
  'Use the omms:omms-memory skill: search project memory before you start, and save each decision and bug fix as you go.'

/** The text that starts apply. Claude Code writes `/opsx:apply`; other agents write `/opsx-apply`. */
export function applyCommand(agentKind: string | null, changeName: string, task?: string): string {
  const command = agentKind?.toLowerCase().includes('claude') ? '/opsx:apply' : '/opsx-apply'
  const scope = task ? ` Do only this task, then tick it in tasks.md: "${task}".` : ''
  return `${command} ${changeName}${scope} ${MEMORY_NOTE}`
}

/** Orca names the machine it runs on `local`; SSH and paired hosts have other ids. */
const isLocal = (workspace: Workspace): boolean => workspace.hostId === null || workspace.hostId === 'local'

export function register(orca: OrcaWorkerApi, io: Io): void {
  let last: ChangesSnapshot | null = null
  /** Folder of each workspace the last look listed. The panel never sends a path. */
  const paths = new Map<string, string>()

  /** The library (archive and specs) is read only when no change is active. */
  const toView = async (workspace: Workspace, focused: boolean): Promise<WorkspaceView> => {
    paths.set(workspace.id, workspace.path)
    const changes = await readChanges(io, workspace.path)
    return {
      workspaceId: workspace.id,
      name: workspace.name,
      folder: workspace.path.split(/[\\/]/).filter(Boolean).pop() ?? workspace.name,
      branch: workspace.branch,
      focused,
      changes,
      ...(!changes?.length ? { library: await readLibrary(io, workspace.path) } : {})
    }
  }

  /** A view the last look listed: the focused workspace or a sibling. */
  const shownView = (workspaceId: string): WorkspaceView | undefined => last?.views.find((v) => v.workspaceId === workspaceId)

  /** Absolute folder of a change, archived change or main spec the last look listed; null for anything else. */
  async function changeDir(ref: ChangeRef): Promise<string | null> {
    const workspacePath = paths.get(ref.workspaceId)
    const view = shownView(ref.workspaceId)
    if (!workspacePath || !view) {
      return null
    }
    const root = `${workspacePath}/${AREA_ROOT[ref.area ?? 'changes']}`
    // Live changes are the ones the look listed; the archive and specs are read from disk, and only a real folder of the area passes.
    const listed =
      ref.area === undefined || ref.area === 'changes'
        ? view.changes?.some((c) => c.name === ref.changeName)
        : ((await io.list(root)) ?? []).includes(ref.changeName) && (await isFolder(io, root, ref.changeName))
    return listed ? `${root}/${ref.changeName}` : null
  }

  /** Absolute path of a file of that folder; only a path the folder really lists, so `..` or any other file never gets through. */
  async function resolveFile(ref: ChangeRef, path: string): Promise<string | null> {
    const dir = await changeDir(ref)
    if (!dir) {
      return null
    }
    return (await listChangeFiles(io, dir, ref.area)).includes(path) ? `${dir}/${path}` : null
  }

  /** The one workspace Orca shows. `workspaceId` wins when Orca names it; otherwise branch and name must pick exactly one, or no project is shown. */
  function pickFocused(
    workspaces: Workspace[],
    context: { workspaceId?: string; branch: string; displayName: string }
  ): Workspace | string {
    if (context.workspaceId) {
      const byId = workspaces.find((w) => w.id === context.workspaceId)
      if (byId) {
        return byId
      }
    }
    const byBranch = workspaces.filter((w) => (w.branch ?? '') === context.branch)
    const matches = byBranch.length > 1 ? byBranch.filter((w) => w.name === context.displayName) : byBranch
    if (matches.length === 1) {
      return matches[0]
    }
    return byBranch.length === 0
      ? 'Orca did not list the focused workspace'
      : `Several workspaces share the branch "${context.branch}", so Orca cannot tell which one is focused`
  }

  async function look(): Promise<ChangesSnapshot> {
    const context = await orca.host.call('workspace.readContext')
    if (!context) {
      return { views: [], problem: 'No workspace is focused', checkedAt: Date.now() }
    }
    const { workspaces } = await orca.host.call('workspace.list')
    const focused = pickFocused(workspaces, context)
    if (typeof focused === 'string') {
      return { views: [], problem: focused, checkedAt: Date.now() }
    }
    if (!isLocal(focused)) {
      return { views: [], problem: 'Remote workspaces are not supported yet', checkedAt: Date.now() }
    }
    // Only worktrees of the same repository, so another project is never shown.
    const common = focused.kind === 'worktree' ? await io.gitCommonDir(focused.path) : null
    const siblings: Workspace[] = []
    if (common) {
      for (const other of workspaces) {
        if (other.id !== focused.id && other.kind === 'worktree' && isLocal(other)) {
          if ((await io.gitCommonDir(other.path)) === common) {
            siblings.push(other)
          }
        }
      }
    }
    const views = await Promise.all([toView(focused, true), ...siblings.map((sibling) => toView(sibling, false))])
    return { views, checkedAt: Date.now() }
  }

  orca.panels.handle('changes.get', async () => {
    last = await look()
    return last
  })

  orca.panels.handle('file.list', async (ref) => {
    const dir = await changeDir(ref)
    return { files: dir ? await listChangeFiles(io, dir, ref.area) : [] }
  })

  orca.panels.handle('file.read', async (ref) => {
    const file = await resolveFile(ref, ref.path)
    return { text: file ? await io.text(file) : null }
  })

  orca.panels.handle('file.write', async (ref) => {
    // Only a live change of the focused workspace can be saved; the archive and specs are read only.
    const focused = last?.views.find((v) => v.workspaceId === ref.workspaceId)?.focused
    const file = focused && (ref.area ?? 'changes') === 'changes' ? await resolveFile(ref, ref.path) : null
    if (!file) {
      return { ok: false, message: 'That file cannot be saved from here' }
    }
    try {
      await io.write(file, ref.text)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    // Ticked tasks change the progress, so look again; the panel reloads the snapshot after a save.
    last = await look()
    return { ok: true, message: `Saved ${ref.path}` }
  })

  orca.panels.handle('change.order', async ({ workspaceId, changeName, order }) => {
    const view = last?.views.find((v) => v.workspaceId === workspaceId)
    const listed = view?.changes?.some((c) => c.name === changeName)
    if (!view?.focused || !listed) {
      return { ok: false, message: 'Run order can be set only in the focused worktree' }
    }
    if (order !== null && (!Number.isInteger(order) || order < 1 || order > 999)) {
      return { ok: false, message: 'Run order must be a whole number from 1' }
    }
    const file = `${paths.get(workspaceId)}/openspec/changes/${changeName}/.openspec.yaml`
    try {
      await io.write(file, writeOrder(await io.text(file), order))
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    // No rescan here: the panel reloads the snapshot next, and that reload rescans once.
    return { ok: true, message: order === null ? `${changeName} follows Depends on again` : `${changeName} runs #${order}` }
  })

  orca.panels.handle('change.pin', async ({ workspaceId, changeName, pin }) => {
    // Any worktree the last look listed: pins only sort the board, so siblings can be pinned from All worktrees.
    const view = shownView(workspaceId)
    if (!view?.changes?.some((c) => c.name === changeName)) {
      return { ok: false, message: 'That change cannot be pinned from here' }
    }
    const file = `${paths.get(workspaceId)}/openspec/changes/${changeName}/.openspec.yaml`
    try {
      await io.write(file, writePin(await io.text(file), pin === true))
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    // No rescan here: the panel reloads the snapshot next, and that reload rescans once.
    return { ok: true, message: pin ? `Pinned ${changeName}` : `Unpinned ${changeName}` }
  })

  orca.panels.handle('change.apply', async ({ workspaceId, changeName, terminalId, task }) => {
    // Only a ready or in-progress change of the focused workspace that the panel listed.
    const view = last?.views.find((v) => v.workspaceId === workspaceId)
    const change = view?.changes?.find((c) => c.name === changeName)
    if (!view?.focused || !change || (change.stage !== 'ready' && change.stage !== 'in-progress')) {
      return { sent: false, message: 'That change cannot be applied from here' }
    }
    // A single task must be an unticked line of the change's tasks.md, so nothing else is typed.
    if (task !== undefined) {
      const tasksText = await io.text(`${paths.get(workspaceId)}/openspec/changes/${changeName}/tasks.md`)
      if (!openTasks(tasksText ?? '').some((open) => open.text === task)) {
        return { sent: false, message: 'That task is not open any more' }
      }
    }
    // Type only into a terminal Orca still lists as an agent, never into a stale id.
    const { agents } = await orca.host.call('agents.list')
    const agent = agents.find((a) => a.terminalId === terminalId)
    if (!agent) {
      return { sent: false, message: 'That agent terminal is gone' }
    }
    const text = applyCommand(agent.agent, changeName, task)
    const { accepted } = await orca.host.call('terminal.sendText', { terminalId, text, enter: true })
    return { sent: accepted, message: accepted ? `Sent ${text}` : 'Orca did not accept the text' }
  })
}
