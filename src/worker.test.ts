import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { applyCommand, register, type Io } from './handlers'

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

const focus = (branch: string, displayName: string) =>
  mockHost({
    results: {
      'workspace.readContext': () => ({ branch, displayName, terminals: [] }),
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
  assert.deepEqual(host.callsOf('terminal.sendText')[0], { terminalId: 't1', text: '/opsx:apply alpha', enter: true })
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

test('applyCommand picks the slash style of the agent', () => {
  assert.equal(applyCommand('claude', 'x'), '/opsx:apply x')
  assert.equal(applyCommand('opencode', 'x'), '/opsx-apply x')
  assert.equal(applyCommand(null, 'x'), '/opsx-apply x')
})
