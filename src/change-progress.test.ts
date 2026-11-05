import { assert, test } from 'orca/testing'
import { countTasks, openTasks, readChanges, splitSections, stageOf, type Files } from './change-progress'

/** A fake disk: a map of file path to text. A folder exists when any file sits under it. */
function fakeFiles(tree: Record<string, string>): Files {
  const paths = Object.keys(tree)
  return {
    text: async (path) => tree[path] ?? null,
    list: async (path) => {
      const under = paths.filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1).split('/')[0])
      return under.length > 0 ? [...new Set(under)] : null
    }
  }
}

const ROOT = '/repo/openspec/changes'

test('countTasks counts ticked and unticked checkboxes only', () => {
  assert.deepEqual(countTasks('# Tasks\n- [x] a\n- [ ] b\n  - [X] nested\nplain [ ] text\n* [ ] star'), { done: 2, total: 4 })
})

test('openTasks lists unticked tasks with their section heading', () => {
  const tasks = '# Tasks\n## 1. Setup\n- [x] a\n- [x] b\n## 2. Build\n- [x] c\n- [ ] 2.2 d `code`\n  - [ ] nested\n* [ ] e\n'
  assert.deepEqual(openTasks(tasks), [
    { section: '2. Build', text: '2.2 d `code`' },
    { section: '2. Build', text: 'nested' },
    { section: '2. Build', text: 'e' }
  ])
  assert.deepEqual(openTasks('## Done\n- [x] a'), [])
  assert.deepEqual(openTasks('- [ ] loose'), [{ section: null, text: 'loose' }])
})

test('splitSections cuts at each ## heading and keeps the text before the first one', () => {
  const md = '# Tasks\nintro\n## 1. Setup\n- [x] a\n### sub\n- [ ] b\n## 2. Build\n- [ ] c\n'
  assert.deepEqual(splitSections(md), {
    preface: '# Tasks\nintro',
    sections: ['## 1. Setup\n- [x] a\n### sub\n- [ ] b', '## 2. Build\n- [ ] c']
  })
  assert.deepEqual(splitSections('- [ ] loose'), { preface: '- [ ] loose', sections: [] })
})

test('stageOf follows artefacts then task ticks', () => {
  assert.equal(stageOf({ done: 3, total: 4 }, { done: 0, total: 0 }), 'planning')
  assert.equal(stageOf({ done: 4, total: 4 }, { done: 0, total: 5 }), 'ready')
  assert.equal(stageOf({ done: 4, total: 4 }, { done: 2, total: 5 }), 'in-progress')
  assert.equal(stageOf({ done: 4, total: 4 }, { done: 5, total: 5 }), 'complete')
})

test('readChanges reads each change, skips the archive and plain files', async () => {
  const files = fakeFiles({
    [`${ROOT}/alpha/proposal.md`]: '',
    [`${ROOT}/alpha/design.md`]: '',
    [`${ROOT}/alpha/specs/x/spec.md`]: '',
    [`${ROOT}/alpha/tasks.md`]: '- [x] one\n- [ ] two',
    [`${ROOT}/beta/proposal.md`]: '',
    [`${ROOT}/archive/old/proposal.md`]: '',
    [`${ROOT}/README.md`]: ''
  })
  assert.deepEqual(await readChanges(files, '/repo'), [
    { name: 'alpha', stage: 'in-progress', artefacts: { done: 4, total: 4 }, tasks: { done: 1, total: 2 } },
    { name: 'beta', stage: 'planning', artefacts: { done: 1, total: 4 }, tasks: { done: 0, total: 0 } }
  ])
})

test('readChanges answers null when the workspace has no openspec/changes', async () => {
  assert.equal(await readChanges(fakeFiles({}), '/repo'), null)
})
