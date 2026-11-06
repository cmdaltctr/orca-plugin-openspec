import { assert, test } from 'orca/testing'
import { dependsOn, numberChanges, readOrder, readPin, writeOrder, writePin } from '../change-order'

const NAMES = ['runtime', 'backend', 'flow', 'docs']

test('dependsOn reads backticked change names from a Depends on line or a Dependency section', () => {
  const line = '## Why\n- **Depends on:** `runtime` (the seam) and `backend`. Both must be merged first.\nUses `not-a-change`.'
  assert.deepEqual(dependsOn(line, NAMES, 'flow'), ['runtime', 'backend'])
  const section = '## Why\nx\n## Dependency\nThis lands after `backend`.\n## What changes\nTalks about `runtime`.'
  assert.deepEqual(dependsOn(section, NAMES, 'flow'), ['backend'])
  // Unknown names and the change itself are dropped.
  assert.deepEqual(dependsOn('Depends on: `flow`, `elsewhere`', NAMES, 'flow'), [])
  assert.deepEqual(dependsOn(null, NAMES, 'flow'), [])
})

test('numberChanges puts each change after its dependencies, ties by created date then name', () => {
  const order = numberChanges([
    { name: 'flow', created: '2026-01-01', manual: null, deps: ['backend'] },
    { name: 'backend', created: '2026-01-02', manual: null, deps: ['runtime'] },
    { name: 'runtime', created: '2026-01-03', manual: null, deps: [] },
    { name: 'docs', created: '2026-01-01', manual: null, deps: [] }
  ])
  assert.deepEqual(Object.fromEntries(order), { docs: 1, runtime: 2, backend: 3, flow: 4 })
})

test('a hand-set number wins and the rest fill the free numbers', () => {
  const order = numberChanges([
    { name: 'a', created: '2026-01-01', manual: null, deps: [] },
    { name: 'b', created: '2026-01-02', manual: null, deps: [] },
    { name: 'x', created: '2026-01-03', manual: 1, deps: [] },
    { name: 'y', created: '2026-01-04', manual: 3, deps: [] }
  ])
  assert.deepEqual(Object.fromEntries(order), { x: 1, a: 2, y: 3, b: 4 })
})

test('a dependency loop still numbers every change', () => {
  const order = numberChanges([
    { name: 'a', created: '2026-01-01', manual: null, deps: ['b'] },
    { name: 'b', created: '2026-01-02', manual: null, deps: ['a'] }
  ])
  assert.deepEqual(Object.fromEntries(order), { a: 1, b: 2 })
})

test('readOrder and writeOrder handle the order line of .openspec.yaml', () => {
  const yaml = 'schema: spec-driven\ncreated: 2026-11-01\n'
  assert.equal(readOrder(yaml), null)
  const manual = writeOrder(yaml, 2)
  assert.equal(manual, 'schema: spec-driven\ncreated: 2026-11-01\norder: 2\n')
  assert.equal(readOrder(manual), 2)
  assert.equal(writeOrder(manual, 5), 'schema: spec-driven\ncreated: 2026-11-01\norder: 5\n')
  assert.equal(writeOrder(manual, null), yaml)
  assert.equal(writeOrder(null, 1), 'order: 1\n')
})

test('readPin and writePin handle the pin line of .openspec.yaml', () => {
  const yaml = 'schema: spec-driven\norder: 2\n'
  assert.equal(readPin(yaml), false)
  const on = writePin(yaml, true)
  assert.equal(on, 'schema: spec-driven\norder: 2\npin: true\n')
  assert.equal(readPin(on), true)
  assert.equal(writePin(on, false), yaml)
  assert.equal(writeOrder(on, null), 'schema: spec-driven\npin: true\n')
})
