// The panel <-> worker contract, declared once: src/panel.tsx and src/handlers.ts both read it.
export type ChangeStage = 'planning' | 'ready' | 'in-progress' | 'complete'

export interface Count {
  done: number
  total: number
}

/** One folder under openspec/changes (never the archive). */
export interface ChangeRow {
  name: string
  stage: ChangeStage
  artefacts: Count
  tasks: Count
}

/** The changes of one workspace. `focused` is the workspace Orca shows now; the rest are git siblings. */
export interface WorkspaceView {
  workspaceId: string
  name: string
  branch: string | null
  focused: boolean
  /** null when the workspace has no openspec/changes folder. */
  changes: ChangeRow[] | null
}

/** One change of one workspace, as the panel names it. */
export interface ChangeRef {
  workspaceId: string
  changeName: string
}

export interface ChangesSnapshot {
  views: WorkspaceView[]
  /** Set when no workspace could be chosen, for example no workspace is focused. */
  problem?: string
  checkedAt: number
}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** Looks again at the focused workspace and its git siblings. */
    'changes.get': { output: ChangesSnapshot }
    /** The markdown files of one change: proposal, design, tasks and each spec. Paths are relative to the change folder. */
    'file.list': { input: ChangeRef; output: { files: string[] } }
    'file.read': { input: ChangeRef & { path: string }; output: { text: string | null } }
    /** Saves a file of a change in the focused workspace. Sibling worktrees are read only. */
    'file.write': {
      input: ChangeRef & { path: string; text: string }
      output: { ok: boolean; message: string }
    }
    /** Types the apply command into an agent terminal of the focused workspace. */
    'change.apply': {
      input: { workspaceId: string; changeName: string; terminalId: string }
      output: { sent: boolean; message: string }
    }
  }
}
