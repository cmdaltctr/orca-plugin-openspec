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

const host = () =>
  mockHost({
    requests: {
      'file.list': () => ({ files: ['proposal.md', 'tasks.md'] }),
      'file.read': ({ path }) => ({ text: path === 'tasks.md' ? '- [ ] one' : '# Why\nBecause' }),
      'file.write': () => ({ ok: true, message: 'Saved tasks.md' }),
      'changes.get': () => snapshot, 'change.apply': () => ({ sent: true, message: 'Sent /opsx:apply ready-one' }) },
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
