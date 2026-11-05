import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { ChangesSnapshot } from './protocol'

const snapshot: ChangesSnapshot = {
  checkedAt: 1,
  views: [
    {
      workspaceId: 'w-v3',
      name: 'omrs-v3',
      branch: 'v3',
      focused: true,
      changes: [
        { name: 'ready-one', stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 10 } },
        { name: 'busy-one', stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 5, total: 24 } },
        { name: 'done-one', stage: 'complete', artefacts: { done: 4, total: 4 }, tasks: { done: 3, total: 3 } }
      ]
    },
    { workspaceId: 'w-main', name: 'omrs', branch: 'main', focused: false, changes: [] }
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
      { workspaceId: 'w-main', name: 'omrs', branch: 'main', focused: true, changes: [] },
      {
        workspaceId: 'w-v3',
        name: 'omrs-v3',
        branch: 'v3',
        focused: false,
        changes: [{ name: 'busy-one', stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 23, total: 24 } }]
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
