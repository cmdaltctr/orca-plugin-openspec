import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from '../panel'
import type { ChangesSnapshot } from '../protocol'

const snapshot: ChangesSnapshot = {
  checkedAt: 1,
  views: [
    {
      workspaceId: 'w-v3',
      name: 'omrs-v3',
      folder: 'omrs-v3',
      branch: 'v3',
      focused: true,
      changes: [
        { name: 'ready-one', order: 1, pinned: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 10 } },
        { name: 'busy-one', order: 2, pinned: false, stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 5, total: 24 } },
        { name: 'done-one', order: 3, pinned: false, stage: 'complete', artefacts: { done: 4, total: 4 }, tasks: { done: 3, total: 3 } }
      ]
    },
    { workspaceId: 'w-main', name: 'omrs', folder: 'omrs', branch: 'main', focused: false, changes: [] }
  ]
}

const applied: { task?: string }[] = []

const host = () =>
  mockHost({
    requests: {
      'file.list': () => ({ files: ['proposal.md', 'tasks.md'] }),
      'file.read': ({ path }) => ({ text: path === 'tasks.md' ? '- [x] finished\n- [ ] one' : '# Why\nBecause' }),
      'file.write': () => ({ ok: true, message: 'Saved tasks.md' }),
      'changes.get': () => snapshot, 'change.apply': (input) => {
        applied.push(input)
        return { sent: true, message: 'Sent /opsx:apply ready-one' }
      } },
    results: {
      'agents.list': () => ({
        agents: [{ terminalId: 't1', title: 'claude', agent: 'claude', state: 'waiting', stateStartedAt: 1 }]
      })
    }
  })

test('each card shows its run order, and the number can be set by hand in the focused worktree', async () => {
  const ordered: { changeName: string; order: number | null }[] = []
  const h = mockHost({
    requests: {
      'changes.get': () => snapshot,
      'change.order': (input) => {
        ordered.push(input)
        return { ok: true, message: 'Saved run order' }
      }
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  assert.ok(view.find({ text: '#2' }))
  assert.equal(JSON.stringify(view.tree()).includes('Run order for busy-one'), false)
  await view.press({ text: '#2' })
  await view.select({ label: 'Run order for busy-one' }, '1')
  assert.deepEqual(ordered, [{ workspaceId: 'w-v3', changeName: 'busy-one', order: 1 }])
  await view.press({ text: '#2' })
  await view.select({ label: 'Run order for busy-one' }, 'auto')
  assert.deepEqual(ordered[1], { workspaceId: 'w-v3', changeName: 'busy-one', order: null })
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('each stage has a sort toggle that flips the run order of its cards', async () => {
  const two: ChangesSnapshot = {
    checkedAt: 1,
    views: [
      {
        workspaceId: 'w-v3', name: 'omrs-v3', folder: 'omrs-v3', branch: 'v3', focused: true,
        changes: [{ name: 'fourth', order: 4, pinned: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } }]
      },
      {
        workspaceId: 'w-main', name: 'omrs', folder: 'omrs', branch: 'main', focused: false,
        changes: [{ name: 'first', order: 1, pinned: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } }]
      }
    ]
  }
  const h = mockHost({ requests: { 'changes.get': () => two }, results: { 'agents.list': () => ({ agents: [] }) } })
  const view = await mount(panel, { host: h })
  await view.select({ label: 'Board scope' }, 'all')
  const at = (name: string) => JSON.stringify(view.tree()).indexOf(`"${name}"`)
  // Ascending by default, across worktrees.
  assert.ok(at('first') < at('fourth'))
  await view.press({ text: 'Run order ↑' })
  assert.ok(at('fourth') < at('first'))
  assert.ok(view.find({ text: 'Run order ↓' }))
  await view.unmount()
})

test('the This worktree tab has the run numbers and the sort toggle too', async () => {
  const one: ChangesSnapshot = {
    checkedAt: 1,
    views: [
      {
        workspaceId: 'w-v3', name: 'omrs-v3', folder: 'omrs-v3', branch: 'v3', focused: true,
        changes: [
          { name: 'second', order: 2, pinned: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } },
          { name: 'first', order: 1, pinned: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } }
        ]
      },
      { workspaceId: 'w-main', name: 'omrs', folder: 'omrs', branch: 'main', focused: false, changes: [] }
    ]
  }
  const h = mockHost({ requests: { 'changes.get': () => one }, results: { 'agents.list': () => ({ agents: [] }) } })
  const view = await mount(panel, { host: h })
  const at = (name: string) => JSON.stringify(view.tree()).indexOf(`"${name}"`)
  assert.ok(view.find({ text: '#1' }))
  assert.ok(at('first') < at('second'))
  await view.press({ text: 'Run order ↑' })
  assert.ok(at('second') < at('first'))
  await view.unmount()
})

test('shows progress and offers Apply only for ready and in-progress changes', async () => {
  const view = await mount(panel, { host: host() })
  assert.ok(view.find({ text: '5 of 24 tasks complete' }))
  assert.ok(view.find({ text: '3 changes · 8 of 37 tasks complete' }))
  assert.equal(view.findAll({ text: 'Apply' }).length, 2)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Apply sends the change to the single listed agent', async () => {
  const h = host()
  const view = await mount(panel, { host: h })
  await view.press({ text: 'Apply' })
  assert.ok(view.find({ text: 'Sent /opsx:apply ready-one' }))
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the Todo tab shows each unticked task as a card with its own Apply', async () => {
  const h = host()
  const view = await mount(panel, { host: h })
  await view.press({ text: 'Open' })
  await view.select({ label: 'ready-one files' }, 'todo')
  const shown = JSON.stringify(view.tree())
  assert.ok(shown.includes('"content":"one"'))
  assert.equal(shown.includes('finished'), false)
  // "Apply all" on top, then one Apply on the card; the board behind it has its own.
  assert.ok(view.find({ text: 'Apply all' }))
  const cards = view.findAll({ text: 'Apply' }).filter((node) => node !== view.find({ text: 'Apply all' }))
  applied.length = 0
  await view.press(cards[cards.length - 1])
  assert.equal(applied[0]?.task, 'one')
  assert.ok(view.find({ text: 'Sent /opsx:apply ready-one' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('in a sibling worktree the Todo buttons stay visible but disabled, with the reason', async () => {
  const sibling: ChangesSnapshot = {
    checkedAt: 1,
    views: [
      { workspaceId: 'w-main', name: 'omrs', folder: 'omrs', branch: 'main', focused: true, changes: [] },
      {
        workspaceId: 'w-v3',
        name: 'omrs-v3',
        folder: 'omrs-v3',
        branch: 'v3',
        focused: false,
        changes: [{ name: 'busy-one', order: 4, pinned: false, stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 23, total: 24 } }]
      }
    ]
  }
  const h = mockHost({
    requests: {
      'file.list': () => ({ files: ['tasks.md'] }),
      'file.read': () => ({ text: '- [x] finished\n- [ ] last one' }),
      'changes.get': () => sibling
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  await view.select({ label: 'Worktree' }, 'w-v3')
  await view.press({ text: 'Open' })
  await view.select({ label: 'busy-one files' }, 'todo')
  const shown = JSON.stringify(view.tree())
  assert.ok(view.find({ text: 'Apply all' }))
  assert.ok(shown.includes('"content":"last one"'))
  assert.ok(view.find({ text: 'Apply' }))
  assert.ok(shown.includes('"disabled":true,"tooltip":"Sibling worktree: switch to it in Orca to apply"'))
  const playButtons = shown.match(/"icon":"play","disabled":(true|false)/g) ?? []
  assert.ok(playButtons.length >= 2)
  assert.ok(playButtons.every((b) => b.endsWith('true')))
  await view.unmount()
})

test('switching worktree reloads the agent list for the new worktree', async () => {
  let agents = [{ terminalId: 'old', title: 'old worktree agent', agent: 'claude', state: 'done', stateStartedAt: 1 }]
  const h = mockHost({
    requests: { 'changes.get': () => snapshot },
    results: { 'agents.list': () => ({ agents }) }
  })
  const view = await mount(panel, { host: h })
  assert.ok(JSON.stringify(view.tree()).includes('old worktree agent'))
  agents = [
    { terminalId: 'a', title: 'v3 agent one', agent: 'claude', state: 'working', stateStartedAt: 1 },
    { terminalId: 'b', title: 'v3 agent two', agent: 'claude', state: 'waiting', stateStartedAt: 1 }
  ]
  await view.emit('workspace.changed', {})
  const shown = JSON.stringify(view.tree())
  assert.ok(shown.includes('v3 agent one'))
  assert.ok(shown.includes('v3 agent two'))
  assert.equal(shown.includes('old worktree agent'), false)
  await view.unmount()
})

test('the All worktrees tab lists the changes of every sibling, each tagged with its worktree', async () => {
  const many: ChangesSnapshot = {
    checkedAt: 1,
    views: [
      {
        workspaceId: 'w-v3',
        name: 'omrs-v3',
        folder: 'omrs-v3-dir',
        branch: 'v3',
        focused: true,
        changes: [{ name: 'here-one', order: 5, pinned: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 2 } }]
      },
      {
        workspaceId: 'w-feat',
        name: 'omrs-feat-x',
        folder: 'omrs-feat-x-dir',
        branch: 'feat/x',
        focused: false,
        changes: [{ name: 'there-one', order: 6, pinned: false, stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 1, total: 3 } }]
      },
      { workspaceId: 'w-main', name: 'omrs', folder: 'omrs', branch: 'main', focused: false, changes: null }
    ]
  }
  const h = mockHost({
    requests: { 'changes.get': () => many },
    results: { 'agents.list': () => ({ agents: [{ terminalId: 't1', title: 'claude', agent: 'claude', state: 'waiting', stateStartedAt: 1 }] }) }
  })
  const view = await mount(panel, { host: h })
  // The default tab shows the focused worktree only.
  assert.equal(view.find({ text: 'there-one' }), null)
  await view.select({ label: 'Board scope' }, 'all')
  assert.ok(view.find({ text: '2 changes in 3 worktrees · 1 of 5 tasks complete' }))
  assert.ok(view.find({ text: 'here-one' }))
  assert.ok(view.find({ text: 'there-one' }))
  // Each card names its worktree folder only; the branch hides behind the info button.
  assert.ok(view.find({ text: 'omrs-v3-dir (this worktree)' }))
  assert.ok(view.find({ text: 'omrs-feat-x-dir' }))
  assert.equal(view.find({ text: 'Branch: feat/x' }), null)
  await view.press({ label: 'Branch of omrs-feat-x-dir' })
  assert.ok(view.find({ text: 'Branch: feat/x' }))
  // Artefacts, bar and task count sit together in their own bordered box.
  const boxes: string[] = []
  walk(view.tree(), (n) => {
    if (n.type === 'Box' && (n.props as { border?: unknown } | undefined)?.border) boxes.push(JSON.stringify(n))
  })
  assert.ok(boxes.some((box) => box.includes('4 of 4 artefacts') && box.includes('1 of 3 tasks complete')))
  // Apply stays on the focused worktree's change only.
  assert.equal(view.findAll({ text: 'Apply' }).length, 1)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the tasks tab shows each main section as its own card', async () => {
  const h = mockHost({
    requests: {
      'file.list': () => ({ files: ['tasks.md'] }),
      'file.read': () => ({ text: '# Tasks\n## 1. Setup\n- [x] a\n## 2. Build\n- [ ] b\n' }),
      'changes.get': () => snapshot
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  await view.press({ text: 'Open' })
  const shown = JSON.stringify(view.tree())
  assert.equal((shown.match(/"type":"Card"/g) ?? []).length >= 2, true)
  assert.ok(shown.includes('"content":"## 1. Setup\\n- [x] a"'))
  assert.ok(shown.includes('"content":"## 2. Build\\n- [ ] b"'))
  await view.unmount()
})

test('every file, not only tasks, gets a card per ## section', async () => {
  const h = mockHost({
    requests: {
      'file.list': () => ({ files: ['design.md'] }),
      'file.read': () => ({ text: '# Design\n## Context\nSee proposal.\n## Goals / Non-Goals\n- Run it\n' }),
      'changes.get': () => snapshot
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  await view.press({ text: 'Open' })
  const shown = JSON.stringify(view.tree())
  assert.ok(shown.includes('"content":"## Context\\nSee proposal."'))
  assert.ok(shown.includes('"content":"## Goals / Non-Goals\\n- Run it"'))
  await view.unmount()
})

type Node = { type?: string; props?: { scroll?: string }; children?: unknown }
const walk = (node: unknown, visit: (n: Node) => void): void => {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
  } else if (node && typeof node === 'object') {
    visit(node as Node)
    walk((node as Node).children, visit)
  }
}

test('the tab strip scrolls sideways by itself, and the file body sits outside it', async () => {
  const view = await mount(panel, { host: host() })
  await view.press({ text: 'Open' })
  const tree = view.tree()
  let scrollingBox: Node | undefined
  walk(tree, (n) => {
    if (n.type === 'Box' && n.props?.scroll === 'x') scrollingBox = n
  })
  assert.ok(scrollingBox, 'a Box with scroll x exists')
  const inside = JSON.stringify(scrollingBox)
  assert.ok(inside.includes('"type":"Tabs"'))
  assert.equal(inside.includes('Because'), false, 'file text is not inside the scrolling strip')
  assert.ok(JSON.stringify(tree).includes('Because'))
  await view.unmount()
})

test('the agent menu has an info button: hover tooltip, click opens the explanation', async () => {
  const view = await mount(panel, { host: host() })
  assert.equal(view.findAll({ text: 'Only agents in the focused worktree are listed.' }).length, 0)
  assert.ok(JSON.stringify(view.tree()).includes('"icon":"info"'))
  assert.ok(JSON.stringify(view.tree()).includes('"tooltip":"Which running agent gets the Apply command'))
  await view.press({ label: 'About Send to agent' })
  assert.ok(view.find({ text: 'Only agents in the focused worktree are listed.' }))
  await view.press({ label: 'About Send to agent' })
  assert.equal(view.findAll({ text: 'Only agents in the focused worktree are listed.' }).length, 0)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Open shows the files rendered, and Edit then Save writes the draft', async () => {
  const view = await mount(panel, { host: host() })
  await view.press({ text: 'Open' })
  assert.ok(JSON.stringify(view.tree()).includes('"content":"# Why\\nBecause"'))
  await view.press({ text: 'Edit' })
  await view.press({ text: 'Save' })
  assert.ok(view.find({ text: 'Saved tasks.md' }))
  await view.press({ text: 'Back to changes' })
  assert.ok(view.find({ text: 'Planning' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
