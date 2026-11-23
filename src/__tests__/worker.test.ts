import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { applyCommand, register, type Io } from '../handlers'

// Orca reports local workspaces with hostId "local" (seen in a real run), not null.
const WORKSPACES = [
  { id: 'w-main', kind: 'worktree', name: 'omrs', path: '/p/omrs', branch: 'main', hostId: 'local' },
  { id: 'w-v3', kind: 'worktree', name: 'omrs-v3', path: '/p/omrs-v3', branch: 'v3', hostId: 'local' },
  { id: 'w-feat', kind: 'worktree', name: 'omrs-feat-x', path: '/p/omrs-feat-x', branch: 'feat/x', hostId: null },
  { id: 'w-other', kind: 'worktree', name: 'other', path: '/p/other', branch: 'main', hostId: 'local' },
  { id: 'w-ssh', kind: 'worktree', name: 'omrs-ssh', path: '/p/omrs-ssh', branch: 'ssh-branch', hostId: 'ssh:box' }
]

/** omrs, omrs-v3 and omrs-feat-x share one repo. `other` is another project. */
const COMMON: Record<string, string> = {
  '/p/omrs': '/p/omrs/.git',
  '/p/omrs-v3': '/p/omrs/.git',
  '/p/omrs-feat-x': '/p/omrs/.git',
  '/p/other': '/p/other/.git'
}

const TASKS: Record<string, string> = {
  '/p/omrs-v3/openspec/changes/alpha/tasks.md': '- [x] a\n- [ ] b',
  '/p/omrs-v3/openspec/changes/alpha/proposal.md': '',
  '/p/omrs-v3/openspec/changes/alpha/design.md': '',
  '/p/omrs-v3/openspec/changes/alpha/specs/s/spec.md': '',
  '/p/omrs/openspec/changes/main-only/proposal.md': '',
  '/p/omrs/openspec/changes/archive/2026-01-02-old-one/proposal.md': '# Old',
  '/p/omrs/openspec/changes/archive/2026-03-04-newer/proposal.md': '# Newer',
  '/p/omrs/openspec/changes/archive/2026-03-04-newer/specs/auth/spec.md': '# Newer auth',
  '/p/omrs/openspec/specs/auth/spec.md': '# Auth spec',
  '/p/omrs/openspec/specs/README.md': 'not a spec',
  '/p/omrs-feat-x/openspec/specs/billing/spec.md': '# Billing spec',
  '/p/omrs-feat-x/openspec/specs/notes.txt': 'a stray file, not a spec',
  '/p/omrs-feat-x/openspec/changes/archive/notes.txt': 'a stray file, not a change',
  '/p/omrs-feat-x/openspec/changes/archive/2026-02-01-shipped/proposal.md': '# Shipped',
  '/p/other/openspec/changes/secret/proposal.md': ''
}

const written: Record<string, string> = {}
const io: Io = {
  write: async (path, text) => {
    written[path] = text
  },
  gitCommonDir: async (cwd) => COMMON[cwd] ?? null,
  text: async (path) => written[path] ?? TASKS[path] ?? null,
  list: async (path) => {
    const names = Object.keys(TASKS)
      .filter((p) => p.startsWith(`${path}/`))
      .map((p) => p.slice(path.length + 1).split('/')[0])
    return names.length > 0 ? [...new Set(names)] : null
  }
}

const focus = (branch: string, displayName: string, workspaceId?: string) =>
  mockHost({
    results: {
      'workspace.readContext': () => ({ workspaceId, branch, displayName, terminals: [] }),
      'workspace.list': () => ({ workspaces: WORKSPACES, truncated: false }),
      'agents.list': () => ({
        agents: [{ terminalId: 't1', title: 'claude', agent: 'claude', state: 'waiting', stateStartedAt: 1 }]
      }),
      'terminal.sendText': () => ({ accepted: true })
    }
  })

const mount = (host: ReturnType<typeof mockHost>) => mountWorker({ default: (orca) => register(orca, io) }, { host })

test('shows the focused workspace first, then git siblings, never another project', async () => {
  const worker = await mount(focus('v3', 'omrs-v3'))
  const snapshot = await worker.request('changes.get')
  assert.deepEqual(
    snapshot.views.map((v) => [v.workspaceId, v.focused]),
    [['w-v3', true], ['w-main', false], ['w-feat', false]]
  )
  // The folder name, never the full path: the panel must not learn where files live.
  assert.deepEqual(snapshot.views.map((v) => v.folder), ['omrs-v3', 'omrs', 'omrs-feat-x'])
  assert.equal(snapshot.views[0]?.changes?.[0]?.stage, 'in-progress')
  assert.deepEqual(snapshot.views[1]?.changes?.map((c) => c.name), ['main-only'])
  assert.equal(snapshot.views.some((v) => v.workspaceId === 'w-other'), false)
  await worker.deactivate()
})

test('refuses a workspace on an SSH host', async () => {
  const worker = await mount(focus('ssh-branch', 'omrs-ssh'))
  const snapshot = await worker.request('changes.get')
  assert.deepEqual(snapshot.views, [])
  assert.match(snapshot.problem ?? '', /Remote workspaces/)
  await worker.deactivate()
})

test('says so when two workspaces share the focused branch and name', async () => {
  const worker = await mount(focus('main', 'omrs'))
  assert.equal((await worker.request('changes.get')).views[0]?.workspaceId, 'w-main')
  const ambiguous = await mount(focus('main', 'nope'))
  const snapshot = await ambiguous.request('changes.get')
  assert.deepEqual(snapshot.views, [])
  assert.match(snapshot.problem ?? '', /Several workspaces/)
  await worker.deactivate()
  await ambiguous.deactivate()
})

test('picks the focused workspace by id when several share the branch and name', async () => {
  const DUPLICATES = [
    { id: 'w-main', kind: 'worktree', name: 'main', path: '/p/one', branch: 'main', hostId: 'local' },
    { id: 'w-main2', kind: 'worktree', name: 'main', path: '/p/two', branch: 'main', hostId: 'local' }
  ]
  const host = mockHost({
    results: {
      'workspace.readContext': () => ({ workspaceId: 'w-main', branch: 'main', displayName: 'main', terminals: [] }),
      'workspace.list': () => ({ workspaces: DUPLICATES, truncated: false })
    }
  })
  const worker = await mount(host)
  const snapshot = await worker.request('changes.get')
  assert.equal(snapshot.problem, undefined)
  assert.deepEqual(snapshot.views.map((v) => [v.workspaceId, v.focused]), [['w-main', true]])
  // An id Orca no longer lists falls back to branch and name.
  const stale = await mount(focus('main', 'omrs', 'w-gone'))
  const fallback = await stale.request('changes.get')
  assert.equal(fallback.views[0]?.workspaceId, 'w-main')
  await worker.deactivate()
  await stale.deactivate()
})

test('every workspace carries its archive and specs, with or without active changes', async () => {
  const empty = await mount(focus('feat/x', 'omrs-feat-x'))
  const [view] = (await empty.request('changes.get')).views
  assert.deepEqual(view?.changes, [])
  assert.deepEqual(view?.library, { archive: ['2026-02-01-shipped'], specs: ['billing'] })
  const busy = await mount(focus('v3', 'omrs-v3'))
  assert.deepEqual((await busy.request('changes.get')).views[0]?.library, { archive: [], specs: [] })
  assert.deepEqual((await busy.request('changes.get')).views[1]?.library, { archive: ['2026-03-04-newer', '2026-01-02-old-one'], specs: ['auth'] })
  await empty.deactivate()
  await busy.deactivate()
})

test('archive and specs files are read only and only real folders of the listed workspace open', async () => {
  const worker = await mount(focus('feat/x', 'omrs-feat-x'))
  await worker.request('changes.get')
  const billing = { workspaceId: 'w-feat', changeName: 'billing', area: 'specs' as const }
  assert.deepEqual((await worker.request('file.list', billing)).files, ['spec.md'])
  assert.equal((await worker.request('file.read', { ...billing, path: 'spec.md' })).text, '# Billing spec')
  // An archived change of a sibling worktree reads like a live one: files in order, newest folder first in the library.
  const newer = { workspaceId: 'w-main', changeName: '2026-03-04-newer', area: 'archive' as const }
  assert.deepEqual((await worker.request('file.list', newer)).files, ['proposal.md', 'specs/auth/spec.md'])
  assert.equal((await worker.request('file.read', { ...newer, path: 'proposal.md' })).text, '# Newer')
  // Saving is refused, even in the focused worktree.
  assert.equal((await worker.request('file.write', { ...billing, path: 'spec.md', text: 'x' })).ok, false)
  assert.equal(written['/p/omrs-feat-x/openspec/specs/billing/spec.md'], undefined)
  // A name that is not a folder of the area, a dot-dot name and a workspace the look did not list are refused.
  assert.equal((await worker.request('file.list', { ...billing, changeName: 'nope' })).files.length, 0)
  assert.equal((await worker.request('file.list', { ...billing, changeName: '../changes' })).files.length, 0)
  assert.equal((await worker.request('file.list', { ...billing, workspaceId: 'w-other', changeName: 'billing' })).files.length, 0)
  // A sibling worktree of the same repository can be read.
  assert.deepEqual((await worker.request('file.list', { ...billing, workspaceId: 'w-main', changeName: 'auth' })).files, ['spec.md'])
  assert.equal((await worker.request('file.read', { ...billing, path: '../../../etc/passwd' })).text, null)
  await worker.deactivate()
})

test('a stray file in the archive or specs folder is never listed and never opens', async () => {
  const worker = await mount(focus('feat/x', 'omrs-feat-x'))
  const [view] = (await worker.request('changes.get')).views
  assert.deepEqual(view?.library, { archive: ['2026-02-01-shipped'], specs: ['billing'] })
  assert.equal((await worker.request('file.list', { workspaceId: 'w-feat', changeName: 'notes.txt', area: 'archive' })).files.length, 0)
  assert.equal((await worker.request('file.list', { workspaceId: 'w-feat', changeName: 'notes.txt', area: 'specs' })).files.length, 0)
  await worker.deactivate()
})

test('apply types the command only for a ready or in-progress change of the focused view', async () => {
  const host = focus('v3', 'omrs-v3')
  const worker = await mount(host)
  await worker.request('changes.get')
  const ask = (workspaceId: string, changeName: string, terminalId = 't1') =>
    worker.request('change.apply', { workspaceId, changeName, terminalId })
  assert.equal((await ask('w-main', 'main-only')).sent, false)
  assert.equal((await ask('w-v3', 'missing')).sent, false)
  assert.equal((await ask('w-v3', 'alpha', 'gone')).sent, false)
  assert.equal(host.callsOf('terminal.sendText').length, 0)
  assert.equal((await ask('w-v3', 'alpha')).sent, true)
  // One task: only an unticked task listed in tasks.md goes through.
  const askTask = (task: string) => worker.request('change.apply', { workspaceId: 'w-v3', changeName: 'alpha', terminalId: 't1', task })
  assert.equal((await askTask('a')).sent, false)
  assert.equal((await askTask('invented')).sent, false)
  assert.equal(host.callsOf('terminal.sendText').length, 1)
  assert.equal((await askTask('b')).sent, true)
  assert.match(host.callsOf('terminal.sendText')[1]?.text ?? '', /^\/opsx:apply alpha .*"b".*omms:omms-memory/)
  const [sent] = host.callsOf('terminal.sendText')
  assert.equal(sent?.terminalId, 't1')
  assert.equal(sent?.enter, true)
  assert.match(sent?.text ?? '', /^\/opsx:apply alpha .*omms:omms-memory/)
  await worker.deactivate()
})

test('lists, reads and saves files of a listed change, only in the focused worktree', async () => {
  const worker = await mount(focus('v3', 'omrs-v3'))
  await worker.request('changes.get')
  const alpha = { workspaceId: 'w-v3', changeName: 'alpha' }
  assert.deepEqual((await worker.request('file.list', alpha)).files, ['proposal.md', 'design.md', 'tasks.md', 'specs/s/spec.md'])
  assert.equal((await worker.request('file.read', { ...alpha, path: 'tasks.md' })).text, '- [x] a\n- [ ] b')
  assert.equal((await worker.request('file.write', { ...alpha, path: 'tasks.md', text: '- [x] a\n- [x] b' })).ok, true)
  assert.equal(written['/p/omrs-v3/openspec/changes/alpha/tasks.md'], '- [x] a\n- [x] b')
  // Progress follows the save.
  assert.equal((await worker.request('changes.get')).views[0]?.changes?.[0]?.stage, 'complete')
  // Paths outside the change, other workspaces' unknown changes and sibling saves are refused.
  assert.equal((await worker.request('file.read', { ...alpha, path: '../../../../etc/passwd' })).text, null)
  assert.equal((await worker.request('file.write', { ...alpha, path: '../x.md', text: 'x' })).ok, false)
  assert.equal((await worker.request('file.write', { workspaceId: 'w-main', changeName: 'main-only', path: 'proposal.md', text: 'x' })).ok, false)
  assert.equal((await worker.request('file.list', { workspaceId: 'w-v3', changeName: 'nope' })).files.length, 0)
  await worker.deactivate()
})

test('change.order saves a hand-set number in .openspec.yaml, only in the focused worktree', async () => {
  const worker = await mount(focus('v3', 'omrs-v3'))
  const first = await worker.request('changes.get')
  assert.deepEqual(first.views[0]?.changes?.map((c) => [c.name, c.order, c.manual]), [['alpha', 1, false]])
  const yaml = '/p/omrs-v3/openspec/changes/alpha/.openspec.yaml'
  assert.equal((await worker.request('change.order', { workspaceId: 'w-v3', changeName: 'alpha', order: 4 })).ok, true)
  assert.equal(written[yaml], 'order: 4\n')
  assert.deepEqual((await worker.request('changes.get')).views[0]?.changes?.map((c) => [c.order, c.manual]), [[4, true]])
  assert.equal((await worker.request('change.order', { workspaceId: 'w-v3', changeName: 'alpha', order: null })).ok, true)
  assert.equal(written[yaml], '')
  assert.equal((await worker.request('change.order', { workspaceId: 'w-main', changeName: 'main-only', order: 1 })).ok, false)
  assert.equal((await worker.request('change.order', { workspaceId: 'w-v3', changeName: 'alpha', order: 0 })).ok, false)
  await worker.deactivate()
})

test('change.pin saves pin: true in .openspec.yaml, in any listed worktree', async () => {
  const worker = await mount(focus('v3', 'omrs-v3'))
  await worker.request('changes.get')
  const yaml = '/p/omrs-v3/openspec/changes/alpha/.openspec.yaml'
  assert.equal((await worker.request('change.pin', { workspaceId: 'w-v3', changeName: 'alpha', pin: true })).ok, true)
  assert.equal(written[yaml], 'pin: true\n')
  assert.equal((await worker.request('changes.get')).views[0]?.changes?.[0]?.pin, true)
  assert.equal((await worker.request('change.pin', { workspaceId: 'w-v3', changeName: 'alpha', pin: false })).ok, true)
  assert.equal(written[yaml], '')
  // A sibling worktree can be pinned from the All worktrees tab.
  assert.equal((await worker.request('change.pin', { workspaceId: 'w-main', changeName: 'main-only', pin: true })).ok, true)
  assert.equal(written['/p/omrs/openspec/changes/main-only/.openspec.yaml'], 'pin: true\n')
  // A change the last look did not list is refused.
  assert.equal((await worker.request('change.pin', { workspaceId: 'w-other', changeName: 'secret', pin: true })).ok, false)
  assert.equal((await worker.request('change.pin', { workspaceId: 'w-main', changeName: 'nope', pin: true })).ok, false)
  await worker.deactivate()
})

test('change.pin and change.order only write the file: the panel reload does the one rescan', async () => {
  let scans = 0
  const host = mockHost({
    results: {
      'workspace.readContext': () => {
        scans += 1
        return { branch: 'v3', displayName: 'omrs-v3', terminals: [] }
      },
      'workspace.list': () => ({ workspaces: WORKSPACES, truncated: false })
    }
  })
  const worker = await mount(host)
  await worker.request('changes.get')
  scans = 0
  const ref = { workspaceId: 'w-v3', changeName: 'alpha' }
  assert.equal((await worker.request('change.pin', { ...ref, pin: true })).ok, true)
  assert.equal((await worker.request('change.pin', { ...ref, pin: false })).ok, true)
  assert.equal((await worker.request('change.order', { ...ref, order: 2 })).ok, true)
  assert.equal((await worker.request('change.order', { ...ref, order: null })).ok, true)
  assert.equal(scans, 0)
  await worker.deactivate()
})

test('applyCommand picks the slash style of the agent and asks for omms memory', () => {
  assert.match(applyCommand('claude', 'x'), /^\/opsx:apply x /)
  assert.match(applyCommand('opencode', 'x'), /^\/opsx-apply x /)
  assert.match(applyCommand(null, 'x'), /^\/opsx-apply x /)
  assert.match(applyCommand('claude', 'x'), /omms:omms-memory/)
})
