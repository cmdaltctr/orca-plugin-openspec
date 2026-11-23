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
        { name: 'ready-one', order: 1, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 10 } },
        { name: 'busy-one', order: 2, manual: false, pin: false, stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 5, total: 24 } },
        { name: 'done-one', order: 3, manual: false, pin: false, stage: 'complete', artefacts: { done: 4, total: 4 }, tasks: { done: 3, total: 3 } }
      ]
    },
    { workspaceId: 'w-main', name: 'omrs', folder: 'omrs', branch: 'main', focused: false, changes: [] }
  ]
}

/** The tree as text without menus, so a stage name in Show stage does not count as a heading. */
const boardText = (tree: unknown): string =>
  JSON.stringify(tree, (_key, value) => (value && typeof value === 'object' && value.type === 'Select' ? undefined : value))

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
        changes: [{ name: 'fourth', order: 4, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } }]
      },
      {
        workspaceId: 'w-main', name: 'omrs', folder: 'omrs', branch: 'main', focused: false,
        changes: [{ name: 'first', order: 1, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } }]
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

test('pinned cards sit in a Pinned section above every stage, and the pin button toggles them', async () => {
  const pins: { changeName: string; pin: boolean }[] = []
  const snap: ChangesSnapshot = {
    checkedAt: 1,
    views: [
      {
        workspaceId: 'w-v3', name: 'omrs-v3', folder: 'omrs-v3', branch: 'v3', focused: true,
        changes: [
          { name: 'first', order: 1, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } },
          { name: 'middle', order: 2, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } },
          { name: 'stuck', order: 3, manual: false, pin: true, stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } },
          { name: 'later', order: 4, manual: false, pin: true, stage: 'planning', artefacts: { done: 1, total: 4 }, tasks: { done: 0, total: 0 } }
        ]
      },
      { workspaceId: 'w-main', name: 'omrs', folder: 'omrs', branch: 'main', focused: false, changes: [] }
    ]
  }
  const h = mockHost({
    requests: {
      'changes.get': () => snap,
      'change.pin': (input) => {
        pins.push(input)
        return { ok: true, message: 'Pinned' }
      }
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  const at = (name: string) => boardText(view.tree()).indexOf(`"${name}"`)
  // Pinned first (in run order, with their stage named), then the stages without them.
  assert.ok(at('Pinned') < at('stuck') && at('stuck') < at('later') && at('later') < at('Planning'))
  assert.ok(at('Stage: In progress') > at('Pinned') && at('Stage: In progress') < at('Planning'))
  assert.ok(at('Planning') < at('first') && at('first') < at('middle'))
  // A pinned card shows once: the stages count only the cards left in them.
  const count = (name: string) => boardText(view.tree()).split(`"${name}"`).length - 1
  assert.equal(count('stuck'), count('first'))
  assert.equal(count('Pinned'), 1)
  // Pinned cards have a green outline; the others keep the plain card.
  const outlined: string[] = []
  walk(view.tree(), (n) => {
    if (n.type === 'Box' && n.props?.border === 'success') outlined.push(JSON.stringify(n))
  })
  // Two nested green borders per pinned card make the outline thicker.
  assert.equal(outlined.length, 4)
  assert.ok(outlined.some((o) => o.includes('"stuck"')) && outlined.some((o) => o.includes('"later"')))
  assert.equal(outlined.some((o) => o.includes('"first"')), false)
  await view.press({ text: 'Run order ↑' })
  assert.ok(at('stuck') < at('later') && at('middle') < at('first'))
  assert.ok(view.find({ text: '#3' }))
  await view.press({ label: 'Unpin stuck' })
  await view.press({ label: 'Pin first' })
  assert.deepEqual(pins, [
    { workspaceId: 'w-v3', changeName: 'stuck', pin: false },
    { workspaceId: 'w-v3', changeName: 'first', pin: true }
  ])
  await view.unmount()
})

test('a pressed pin moves the card at once, and the reload puts back what is on disk', async () => {
  const snap: ChangesSnapshot = {
    checkedAt: 1,
    views: [
      {
        workspaceId: 'w-v3', name: 'omrs-v3', folder: 'omrs-v3', branch: 'v3', focused: true,
        changes: [{ name: 'first', order: 1, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } }]
      }
    ]
  }
  let whileWaiting = ''
  const h = mockHost({
    requests: {
      'changes.get': () => snap,
      'change.pin': async () => {
        // A slow worker: the board is read while the request is still open.
        await new Promise((resolve) => setTimeout(resolve, 10))
        whileWaiting = boardText(view.tree())
        return { ok: false, message: 'Could not write .openspec.yaml' }
      }
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  assert.equal(boardText(view.tree()).includes('"Pinned"'), false)
  await view.press({ label: 'Pin first' })
  assert.ok(whileWaiting.includes('"Pinned"') && whileWaiting.includes('Unpin first'))
  // The write failed, so the reload shows the card unpinned again, with the reason.
  assert.equal(boardText(view.tree()).includes('"Pinned"'), false)
  assert.ok(view.find({ text: 'Could not write .openspec.yaml' }))
  await view.unmount()
})

test('All worktrees can show one worktree, search by name, and pin a sibling card', async () => {
  const pins: { workspaceId: string; changeName: string; pin: boolean }[] = []
  const row = (name: string, order: number) =>
    ({ name, order, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } }) as const
  const snap: ChangesSnapshot = {
    checkedAt: 1,
    views: [
      { workspaceId: 'w-v3', name: 'omrs-v3', folder: 'omrs-v3', branch: 'v3', focused: true, changes: [row('add-login', 1), row('fix-cache', 2)] },
      { workspaceId: 'w-feat', name: 'feat/x', folder: 'omrs-feat-x', branch: 'feat/x', focused: false, changes: [row('add-export', 1)] }
    ]
  }
  const h = mockHost({
    requests: {
      'changes.get': () => snap,
      'change.pin': (input) => {
        pins.push(input)
        return { ok: true, message: 'Pinned' }
      }
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  await view.select({ label: 'Board scope' }, 'all')
  const shown = (name: string) => boardText(view.tree()).includes(`"${name}"`)
  assert.ok(shown('add-login') && shown('add-export'))
  await view.select({ label: 'Show worktree' }, 'w-feat')
  assert.ok(shown('add-export'))
  assert.equal(shown('add-login') || shown('fix-cache'), false)
  await view.select({ label: 'Show worktree' }, 'every')
  await view.type({ label: 'Search changes' }, 'ADD-')
  assert.ok(shown('add-login') && shown('add-export'))
  assert.equal(shown('fix-cache'), false)
  // Search looks at change names only: a worktree folder name matches nothing.
  await view.type({ label: 'Search changes' }, 'feat-x', { replace: true })
  assert.equal(shown('add-export'), false)
  await view.type({ label: 'Search changes' }, 'add-export', { replace: true })
  // A sibling card can be pinned here.
  await view.press({ label: 'Pin add-export' })
  assert.deepEqual(pins, [{ workspaceId: 'w-feat', changeName: 'add-export', pin: true }])
  assert.deepEqual(view.errors, [])
  await view.type({ label: 'Search changes' }, '', { replace: true })
  // Show stage keeps one stage and hides the other stage headings.
  await view.select({ label: 'Show stage' }, 'planning')
  assert.equal(shown('add-login') || shown('Ready'), false)
  assert.ok(shown('Planning'))
  await view.select({ label: 'Show stage' }, 'ready')
  assert.ok(shown('add-login') && shown('Ready'))
  assert.equal(shown('Planning'), false)
  await view.select({ label: 'Show stage' }, 'every')
  await view.unmount()
})

test('the This worktree tab has the run numbers and the sort toggle too', async () => {
  const one: ChangesSnapshot = {
    checkedAt: 1,
    views: [
      {
        workspaceId: 'w-v3', name: 'omrs-v3', folder: 'omrs-v3', branch: 'v3', focused: true,
        changes: [
          { name: 'second', order: 2, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } },
          { name: 'first', order: 1, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 1 } }
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
  await view.type({ label: 'Search changes' }, 'sec')
  assert.ok(at('second') >= 0 && at('first') < 0)
  assert.ok(view.find({ text: 'Showing 1 of 2 changes' }))
  await view.type({ label: 'Search changes' }, '')
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

test('the Todo tab shows a task longer than the 1024-character key limit', async () => {
  // Orca refuses a key over 1024 characters, so a long task used as a key left the tab on its spinner.
  const long = `6.10 ${'word '.repeat(300)}`.trim()
  const h = mockHost({
    requests: {
      'file.list': () => ({ files: ['tasks.md'] }),
      'file.read': () => ({ text: `- [ ] ${long}` }),
      'changes.get': () => snapshot
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  await view.press({ text: 'Open' })
  await view.select({ label: 'ready-one files' }, 'todo')
  assert.deepEqual(view.errors, [])
  assert.ok(view.find({ text: 'Apply all' }))
  assert.ok(JSON.stringify(view.tree()).includes(`"content":"${long}"`))
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
        changes: [{ name: 'busy-one', order: 4, manual: false, pin: false, stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 23, total: 24 } }]
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
        changes: [{ name: 'here-one', order: 5, manual: false, pin: false, stage: 'ready', artefacts: { done: 4, total: 4 }, tasks: { done: 0, total: 2 } }]
      },
      {
        workspaceId: 'w-feat',
        name: 'omrs-feat-x',
        folder: 'omrs-feat-x-dir',
        branch: 'feat/x',
        focused: false,
        changes: [{ name: 'there-one', order: 6, manual: false, pin: false, stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 1, total: 3 } }]
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

const emptyView = (library: { archive: string[]; specs: string[] }, focused: boolean) => ({
  workspaceId: 'w-empty',
  name: 'empty-project',
  folder: 'empty-project',
  branch: 'main',
  focused,
  changes: [],
  library
})

test('with no active change, the empty stages stay and the Archive and Specs list below them; a spec opens read only', async () => {
  const quiet: ChangesSnapshot = { checkedAt: 1, views: [emptyView({ archive: [], specs: ['auth'] }, true)] }
  const requested: { area?: string; changeName: string }[] = []
  const h = mockHost({
    requests: {
      'file.list': (ref) => {
        requested.push(ref)
        return { files: ['spec.md'] }
      },
      'file.read': () => ({ text: '# Auth spec' }),
      'changes.get': () => quiet
    },
    results: { 'agents.list': () => ({ agents: [] }) }
  })
  const view = await mount(panel, { host: h })
  // The empty stages stay, with the Archive and Specs below them.
  assert.ok(view.find({ text: 'Planning' }))
  assert.ok(view.find({ text: 'Complete' }))
  assert.ok(view.find({ text: 'Archive' }))
  assert.ok(view.find({ text: 'Specs' }))
  assert.ok(view.find({ text: 'auth' }))
  assert.ok(view.find({ text: 'No archive here' }))
  await view.press({ text: 'Open' })
  assert.deepEqual(requested, [{ workspaceId: 'w-empty', changeName: 'auth', area: 'specs' }])
  assert.ok(JSON.stringify(view.tree()).includes('"content":"# Auth spec"'))
  // Read only: no Edit, no Todo tab.
  assert.equal(view.find({ text: 'Edit' }), null)
  await view.press({ text: 'Back' })
  assert.ok(view.find({ text: 'Planning' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('a problem still says No project to show, with the reason', async () => {
  const none: ChangesSnapshot = { checkedAt: 1, views: [], problem: 'No workspace is focused' }
  const view = await mount(panel, { host: mockHost({ requests: { 'changes.get': () => none }, results: { 'agents.list': () => ({ agents: [] }) } }) })
  assert.ok(JSON.stringify(view.tree()).includes('No project to show'))
  assert.ok(JSON.stringify(view.tree()).includes('No workspace is focused'))
  assert.equal(view.find({ text: 'Project' }), null)
  await view.unmount()
})

test('a long archive shows five names, then all of them on Show all', async () => {
  const names = Array.from({ length: 7 }, (_, i) => `2026-01-0${i + 1}-c${i + 1}`)
  const long: ChangesSnapshot = { checkedAt: 1, views: [emptyView({ archive: names, specs: [] }, true)] }
  const view = await mount(panel, { host: mockHost({ requests: { 'changes.get': () => long }, results: { 'agents.list': () => ({ agents: [] }) } }) })
  assert.ok(view.find({ text: names[4] }))
  assert.equal(view.find({ text: names[5] }), null)
  await view.press({ text: 'Show all 7' })
  assert.ok(view.find({ text: names[6] }))
  await view.press({ text: 'Show fewer' })
  assert.equal(view.find({ text: names[5] }), null)
  await view.unmount()
})

test('a project with no OpenSpec at all says so, with no empty Archive or Specs lists', async () => {
  const plain: ChangesSnapshot = { checkedAt: 1, views: [{ ...emptyView({ archive: [], specs: [] }, true), changes: null }] }
  const view = await mount(panel, { host: mockHost({ requests: { 'changes.get': () => plain }, results: { 'agents.list': () => ({ agents: [] }) } }) })
  assert.ok(JSON.stringify(view.tree()).includes('No OpenSpec here'))
  assert.equal(view.find({ text: 'Archive' }), null)
  assert.equal(view.find({ text: 'Specs' }), null)
  await view.unmount()
})

test('a project with main specs but no openspec/changes shows the empty stages and its Specs', async () => {
  const specsOnly: ChangesSnapshot = { checkedAt: 1, views: [{ ...emptyView({ archive: [], specs: ['auth'] }, true), changes: null }] }
  const view = await mount(panel, { host: mockHost({ requests: { 'changes.get': () => specsOnly }, results: { 'agents.list': () => ({ agents: [] }) } }) })
  assert.equal(JSON.stringify(view.tree()).includes('No OpenSpec here'), false)
  assert.ok(view.find({ text: 'Planning' }))
  assert.ok(view.find({ text: 'auth' }))
  await view.unmount()
})
