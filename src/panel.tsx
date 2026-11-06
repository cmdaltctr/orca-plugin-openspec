// No build step: Orca strips the types and compiles the JSX when it loads.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  EmptyState,
  Heading,
  host,
  IconButton,
  Markdown,
  on,
  plugin,
  Progress,
  read,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Tab,
  Tabs,
  Text,
  Textarea,
  type PanelContext
} from 'orca'
import { openTasks, splitSections } from './change-progress'
import type { ChangeRef, ChangeRow, ChangesSnapshot, ChangeStage, WorkspaceView } from './protocol'

const POLL_MS = 30_000
const REQUEST = { timeoutMs: 30_000 }

const snapshot = atom<ChangesSnapshot | null>(null)
const problem = atom<string | null>(null)
const notice = atom<string | null>(null)
const agentOptions = atom<{ value: string; label: string }[]>([])
const agentChoice = atom('')
/** Workspace id of the view on show; '' follows the focused workspace. */
const viewChoice = atom('')
/** 'here' shows one worktree; 'all' shows the changes of the focused worktree and every sibling together. */
const scope = atom('here')

const SECTIONS: { stage: ChangeStage; title: string }[] = [
  { stage: 'planning', title: 'Planning' },
  { stage: 'ready', title: 'Ready' },
  { stage: 'in-progress', title: 'In progress' },
  { stage: 'complete', title: 'Complete' }
]

async function load(): Promise<void> {
  try {
    set(snapshot, await plugin.request('changes.get', undefined, REQUEST))
    set(problem, null)
  } catch (error) {
    set(problem, error instanceof Error ? error.message : String(error))
  }
}

async function loadAgents(): Promise<void> {
  try {
    const { agents } = await host.call('agents.list')
    const options = agents.flatMap((agent) =>
      agent.terminalId ? [{ value: agent.terminalId, label: `${agent.title ?? agent.terminalId} (${agent.state})` }] : []
    )
    set(agentOptions, options)
    if (!options.some((option) => option.value === read(agentChoice))) {
      set(agentChoice, options.length === 1 ? options[0].value : '')
    }
  } catch {
    set(agentOptions, [])
  }
}

async function apply(view: WorkspaceView, change: ChangeRow, task?: string): Promise<void> {
  try {
    const result = await plugin.request(
      'change.apply',
      { workspaceId: view.workspaceId, changeName: change.name, terminalId: read(agentChoice), ...(task ? { task } : {}) },
      REQUEST
    )
    set(notice, result.message)
  } catch (error) {
    set(notice, error instanceof Error ? error.message : String(error))
  }
}

/** The change whose files are on show; null shows the board. */
const openChange = atom<ChangeRef | null>(null)
const files = atom<string[]>([])
const fileChoice = atom('')
/** Text on disk for the chosen file; null while it loads or when it cannot be read. */
const fileText = atom<string | null>(null)
const editing = atom(false)
const draft = atom('')

/** A tab of its own that shows the unticked tasks of tasks.md. */
const TODO = 'todo'

async function chooseFile(ref: ChangeRef, path: string): Promise<void> {
  set(fileChoice, path)
  set(fileText, null)
  set(editing, false)
  try {
    const { text } = await plugin.request('file.read', { ...ref, path: path === TODO ? 'tasks.md' : path }, REQUEST)
    // Ignore an answer for a file the person has already left.
    if (read(fileChoice) === path) {
      set(fileText, text ?? '')
    }
  } catch (error) {
    set(notice, error instanceof Error ? error.message : String(error))
  }
}

async function openFiles(view: WorkspaceView, change: ChangeRow): Promise<void> {
  const ref = { workspaceId: view.workspaceId, changeName: change.name }
  set(openChange, ref)
  set(files, [])
  set(fileChoice, '')
  set(fileText, null)
  set(editing, false)
  try {
    const listed = (await plugin.request('file.list', ref, REQUEST)).files
    set(files, listed)
    if (listed[0]) {
      await chooseFile(ref, listed[0])
    }
  } catch (error) {
    set(notice, error instanceof Error ? error.message : String(error))
  }
}

function closeFiles(): void {
  set(openChange, null)
  set(editing, false)
}

async function save(ref: ChangeRef): Promise<void> {
  const path = read(fileChoice)
  const text = read(draft)
  try {
    const result = await plugin.request('file.write', { ...ref, path, text }, REQUEST)
    set(notice, result.message)
    if (result.ok) {
      set(fileText, text)
      set(editing, false)
      void load()
    }
  } catch (error) {
    set(notice, error instanceof Error ? error.message : String(error))
  }
}

const fileLabel = (path: string): string => (path.startsWith('specs/') ? path.split('/')[1] : path.replace(/\.md$/, ''))

const canApply = (view: WorkspaceView, change: ChangeRow): boolean =>
  view.focused && (change.stage === 'ready' || change.stage === 'in-progress')

const agentHelpOpen = atom(false)

function AgentSelect() {
  const options = read(agentOptions)
  if (options.length === 0) {
    return null
  }
  return (
    <Stack gap="xs">
      <Row gap="xs" align="end">
        <Select
          label="Send to agent"
          placeholder="Pick an agent terminal"
          value={read(agentChoice)}
          options={options}
          onChange={(value) => set(agentChoice, value)}
        />
        <IconButton
          icon="info"
          label="About Send to agent"
          tooltip="Which running agent gets the Apply command. Click for details."
          variant="ghost"
          onPress={() => set(agentHelpOpen, !read(agentHelpOpen))}
        />
      </Row>
      {read(agentHelpOpen) ? (
        <Callout icon="info">
          <Stack gap="xs">
            <Text size="xs">Apply types its command into the agent you pick here and presses Enter.</Text>
            <Text size="xs">Only agents in the focused worktree are listed.</Text>
            <Text size="xs">Focus another worktree in Orca to see its agents.</Text>
            <Text size="xs">The word in brackets is the agent's state. An agent that is working receives the text mid-task, so pick one that is idle or waiting.</Text>
          </Stack>
        </Callout>
      ) : null}
    </Stack>
  )
}

/** Why Apply is off, in words for a tooltip; null when it can run. */
function applyBlocker(view: WorkspaceView, change: ChangeRow): string | null {
  if (!view.focused) {
    return 'Sibling worktree: switch to it in Orca to apply'
  }
  if (change.stage !== 'ready' && change.stage !== 'in-progress') {
    return 'Only a Ready or In progress change can be applied'
  }
  return read(agentChoice) ? null : 'Pick an agent terminal first'
}

function ApplyButton({ view, change, task, label = 'Apply' }: { view: WorkspaceView; change: ChangeRow; task?: string; label?: string }) {
  const blocker = applyBlocker(view, change)
  return (
    <Button
      variant="solid"
      tone="success"
      icon="play"
      disabled={blocker !== null}
      tooltip={blocker ?? undefined}
      onPress={() => void apply(view, change, task)}
    >
      {label}
    </Button>
  )
}

/** A markdown file with each `##` section in its own card. */
function SectionCards({ text }: { text: string }) {
  const { preface, sections } = splitSections(text)
  return (
    <Stack gap="sm">
      {preface ? <Markdown content={preface} /> : null}
      {sections.map((section, index) => (
        <Card key={`${index}-${section.slice(0, 40)}`}>
          <Markdown content={section} />
        </Card>
      ))}
    </Stack>
  )
}

function FileView({ view, change }: { view: WorkspaceView; change: ChangeRow }) {
  const ref = { workspaceId: view.workspaceId, changeName: change.name }
  const choice = read(fileChoice)
  const text = read(fileText)
  const isEditing = read(editing)
  const left = text === null ? [] : openTasks(text)
  const body =
    text === null ? (
      <Spinner label="Reading file" />
    ) : choice === TODO ? (
      <Stack gap="xs">
        <Row justify="between" align="center">
          <Text muted size="xs">{`${change.tasks.total - change.tasks.done} of ${change.tasks.total} tasks left`}</Text>
          <ApplyButton view={view} change={change} label="Apply all" />
        </Row>
        {view.focused ? <AgentSelect /> : null}
        {left.length === 0 ? <Text muted size="xs">No tasks left.</Text> : null}
        {left.map((task, index) => (
          <Stack key={`${index}-${task.text}`} gap="xs">
            {task.section !== null && task.section !== left[index - 1]?.section ? <Text weight="semibold">{task.section}</Text> : null}
            <Card>
              <Stack gap="xs">
                <Markdown content={task.text} />
                <Row>
                  <ApplyButton view={view} change={change} task={task.text} />
                </Row>
              </Stack>
            </Card>
          </Stack>
        ))}
      </Stack>
    ) : isEditing ? (
      <Stack gap="xs">
        <Textarea label={`Edit ${choice}`} labelHidden rows={20} value={read(draft)} onChange={(value) => set(draft, value)} />
        <Row gap="xs">
          <Button variant="outline" icon="check" onPress={() => void save(ref)}>
            Save
          </Button>
          <Button variant="ghost" onPress={() => set(editing, false)}>
            Cancel
          </Button>
        </Row>
      </Stack>
    ) : (
      <Stack gap="xs">
        {view.focused ? (
          <Row justify="end">
            <Button
              variant="ghost"
              icon="edit"
              onPress={() => {
                set(draft, text)
                set(editing, true)
              }}
            >
              Edit
            </Button>
          </Row>
        ) : null}
        <SectionCards text={text} />
      </Stack>
    )
  return (
    <Stack gap="sm">
      <Row justify="between" align="center">
        <Heading>{change.name}</Heading>
        <Button variant="outline" onPress={closeFiles}>
          Back to changes
        </Button>
      </Row>
      {read(files).length === 0 ? (
        <Text muted size="xs">This change has no markdown files yet.</Text>
      ) : (
        <>
          {/* The tabs hold labels only, so the strip scrolls sideways on its own and the body stays put. */}
          <Box scroll="x">
            <Tabs label={`${change.name} files`} value={choice} onChange={(path) => void chooseFile(ref, path)}>
              {read(files).flatMap((path) => (path === 'tasks.md' ? [path, TODO] : [path])).map((path) => (
                <Tab key={path} value={path} label={fileLabel(path)} disabled={isEditing && path !== choice} />
              ))}
            </Tabs>
          </Box>
          {body}
        </>
      )}
    </Stack>
  )
}

/** Runs once before the first render. The panel looks again when the focused workspace or an agent changes. */
export function setup(ctx: PanelContext): void {
  void load()
  void loadAgents()
  const timer = setInterval(() => void load(), POLL_MS)
  ctx.subscriptions.push(
    on('workspace.changed', () => {
      set(viewChoice, '')
      closeFiles()
      void load()
      // Orca lists only the focused workspace's agents, so a new focus means a new list.
      void loadAgents()
    }),
    on('agent.status.changed', () => void loadAgents()),
    { dispose: () => clearInterval(timer) }
  )
}

const percent = (done: number, total: number): number => (total === 0 ? 0 : Math.round((done / total) * 100))

/** Key (`workspaceId/change`) of the one card whose branch is shown; '' for none. */
const branchShown = atom('')

/** Worktree icon, folder name, and an info button that shows the branch on hover and on press. Wraps when narrow. */
function WorktreeLine({ view, cardKey }: { view: WorkspaceView; cardKey: string }) {
  const branch = view.branch ?? 'no branch'
  const toggle = () => set(branchShown, read(branchShown) === cardKey ? '' : cardKey)
  return (
    <Stack gap="xs">
      <Row gap="xs" align="center" wrap>
        <IconButton icon="branch" label={`Worktree ${view.folder}`} tooltip="Worktree" variant="ghost" size="xs" onPress={toggle} />
        <Text muted size="xs">{view.focused ? `${view.folder} (this worktree)` : view.folder}</Text>
        <IconButton icon="info" label={`Branch of ${view.folder}`} tooltip={`Branch: ${branch}`} variant="ghost" size="xs" onPress={toggle} />
      </Row>
      {read(branchShown) === cardKey ? <Text muted size="xs">{`Branch: ${branch}`}</Text> : null}
    </Stack>
  )
}

/** Key (`workspaceId/change`) of the one card whose run-order menu is open; '' for none. */
const orderOpen = atom('')

async function setOrder(view: WorkspaceView, change: ChangeRow, value: string): Promise<void> {
  set(orderOpen, '')
  try {
    const order = value === 'auto' ? null : Number(value)
    const result = await plugin.request('change.order', { workspaceId: view.workspaceId, changeName: change.name, order }, REQUEST)
    set(notice, result.message)
    await load()
  } catch (error) {
    set(notice, error instanceof Error ? error.message : String(error))
  }
}

async function setPin(view: WorkspaceView, change: ChangeRow): Promise<void> {
  try {
    const result = await plugin.request('change.pin', { workspaceId: view.workspaceId, changeName: change.name, pin: !change.pin }, REQUEST)
    set(notice, result.message)
    await load()
  } catch (error) {
    set(notice, error instanceof Error ? error.message : String(error))
  }
}

/** The run number on the top right. In the focused worktree, pressing it opens a menu to set the number by hand. */
function OrderControl({ view, change, cardKey }: { view: WorkspaceView; change: ChangeRow; cardKey: string }) {
  const how = change.manual ? 'Set by hand' : 'From Depends on in proposal.md, then by creation date'
  const count = view.changes?.length ?? 1
  return (
    <Stack gap="xs" align="end">
      <Row gap="xs" align="center">
        <IconButton
          icon="star"
          label={`${change.pin ? 'Unpin' : 'Pin'} ${change.name}`}
          tooltip={view.focused ? (change.pin ? 'Pinned to the top of its stage. Press to unpin.' : 'Pin to the top of its stage') : 'Focus this worktree to pin or unpin'}
          variant={change.pin ? 'outline' : 'ghost'}
          size="xs"
          disabled={!view.focused}
          onPress={() => void setPin(view, change)}
        />
        <Button
          variant={change.manual ? 'outline' : 'ghost'}
          size="xs"
          tooltip={view.focused ? `Run order. ${how}. Press to change.` : `Run order. ${how}. Focus this worktree to change it.`}
          disabled={!view.focused}
          onPress={() => set(orderOpen, read(orderOpen) === cardKey ? '' : cardKey)}
        >
          {`#${change.order}`}
        </Button>
      </Row>
      {read(orderOpen) === cardKey ? (
        <Select
          label={`Run order for ${change.name}`}
          labelHidden
          value={change.manual ? String(change.order) : 'auto'}
          options={[
            { value: 'auto', label: 'Auto (Depends on)' },
            ...Array.from({ length: Math.max(count, change.order) }, (_, i) => ({ value: String(i + 1), label: `#${i + 1}` }))
          ]}
          onChange={(value) => void setOrder(view, change, value)}
        />
      ) : null}
    </Stack>
  )
}

function ChangeCard({ view, change, showWorktree }: { view: WorkspaceView; change: ChangeRow; showWorktree?: boolean }) {
  const { artefacts, tasks } = change
  const cardKey = `${view.workspaceId}/${change.name}`
  // The card draws its own header so the name, worktree line and run number sit close together.
  return (
    <Card>
      <Stack gap="md">
        <Row justify="between" align="start">
          <Stack gap="none">
            <Text weight="semibold">{change.name}</Text>
            {showWorktree ? <WorktreeLine view={view} cardKey={cardKey} /> : null}
          </Stack>
          <OrderControl view={view} change={change} cardKey={cardKey} />
        </Row>
        <Box border radius="md" padding="sm" direction="column" gap="xs">
          <Text muted size="xs">{`${artefacts.done} of ${artefacts.total} artefacts`}</Text>
          <Progress
            label={`${change.name}: ${tasks.done} of ${tasks.total} tasks complete`}
            labelHidden
            value={percent(tasks.done, tasks.total)}
          />
          <Row justify="between" align="center">
            <Text muted size="xs">{`${tasks.done} of ${tasks.total} tasks complete`}</Text>
            <Text muted size="xs">{`${percent(tasks.done, tasks.total)}%`}</Text>
          </Row>
        </Box>
        <Row gap="xs">
          <Button variant="outline" icon="file-text" onPress={() => void openFiles(view, change)}>
            Open
          </Button>
          {canApply(view, change) ? <ApplyButton view={view} change={change} /> : null}
        </Row>
      </Stack>
    </Card>
  )
}

interface Entry {
  view: WorkspaceView
  change: ChangeRow
}

const entriesOf = (views: WorkspaceView[]): Entry[] =>
  views.flatMap((view) => (view.changes ?? []).map((change) => ({ view, change })))

/** Stages sorted from the highest run number down; any stage not listed sorts from #1 up. */
const descending = atom<string[]>([])

/** By run number; equal numbers put the focused worktree first, then go by name. */
const byOrder = (a: Entry, b: Entry): number =>
  a.change.order - b.change.order || Number(b.view.focused) - Number(a.view.focused) || a.change.name.localeCompare(b.change.name)

function StageSections({ entries, showWorktree }: { entries: Entry[]; showWorktree?: boolean }) {
  return (
    <Stack gap="md">
      {SECTIONS.map(({ stage, title }) => {
        const down = read(descending).includes(stage)
        const sorted = entries.filter(({ change }) => change.stage === stage).sort(byOrder)
        const ordered = down ? [...sorted].reverse() : sorted
        // Pinned cards stay on top in both directions, in run order among themselves.
        const inStage = [...sorted.filter((e) => e.change.pin), ...ordered.filter((e) => !e.change.pin)]
        const flip = () => set(descending, down ? read(descending).filter((s) => s !== stage) : [...read(descending), stage])
        return (
          <Stack key={stage} gap="xs">
            <Row gap="xs" align="center">
              <Text>{title}</Text>
              <Badge tone="neutral">{String(inStage.length)}</Badge>
              {inStage.length > 1 ? (
                <Button variant="ghost" size="xs" tooltip={down ? 'Highest run number first. Press for #1 first.' : '#1 first. Press for highest first.'} onPress={flip}>
                  {down ? 'Run order ↓' : 'Run order ↑'}
                </Button>
              ) : null}
            </Row>
            {inStage.length === 0 ? <Text muted size="xs">No changes here</Text> : null}
            {inStage.map(({ view, change }) => (
              <ChangeCard key={`${view.workspaceId}/${change.name}`} view={view} change={change} showWorktree={showWorktree} />
            ))}
          </Stack>
        )
      })}
    </Stack>
  )
}

function Board({ view }: { view: WorkspaceView }) {
  if (view.changes === null) {
    return (
      <EmptyState icon="info" title="No OpenSpec here" description="This workspace has no openspec/changes folder." />
    )
  }
  return <StageSections entries={entriesOf([view])} />
}

function summary(entries: Entry[], where = ''): string {
  const done = entries.reduce((sum, { change }) => sum + change.tasks.done, 0)
  const total = entries.reduce((sum, { change }) => sum + change.tasks.total, 0)
  return `${entries.length} changes${where} · ${done} of ${total} tasks complete`
}

/** Every change of the focused worktree and its siblings on one board. Apply still works only on the focused one. */
function AllBoard({ views }: { views: WorkspaceView[] }) {
  const entries = entriesOf(views)
  return (
    <Stack gap="sm">
      <Text muted size="xs">{summary(entries, ` in ${views.length} worktrees`)}</Text>
      <Text muted size="xs">Changes in sibling worktrees are read only. Switch to the worktree in Orca to apply one.</Text>
      <StageSections entries={entries} showWorktree />
    </Stack>
  )
}

export default function Panel() {
  const current = read(snapshot)
  const views = current?.views ?? []
  const chosen = read(viewChoice)
  const view = views.find((v) => v.workspaceId === chosen) ?? views.find((v) => v.focused) ?? views[0]
  const open = read(openChange)
  const openView = open ? views.find((v) => v.workspaceId === open.workspaceId) : undefined
  const openRow = openView?.changes?.find((c) => c.name === open?.changeName)
  if (openView && openRow) {
    return (
      <Stack gap="md">
        {read(notice) ? <Text muted>{read(notice)}</Text> : null}
        <FileView view={openView} change={openRow} />
      </Stack>
    )
  }
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>OpenSpec</Heading>
        <Button variant="ghost" icon="refresh" onPress={() => void load()}>
          Refresh
        </Button>
      </Row>
      {read(problem) ? <Text tone="danger">{read(problem)}</Text> : null}
      {current?.problem ? <EmptyState icon="info" title="No project to show" description={current.problem} /> : null}
      {read(notice) ? <Text muted>{read(notice)}</Text> : null}
      {views.length > 1 ? (
        <Tabs label="Board scope" value={read(scope)} onChange={(value) => set(scope, value)}>
          <Tab value="here" label="This worktree" />
          <Tab value="all" label="All worktrees" />
        </Tabs>
      ) : null}
      {views.length > 1 && read(scope) === 'all' ? (
        <>
          <AgentSelect />
          <AllBoard views={views} />
        </>
      ) : (
        <ScopedBoard current={current} views={views} view={view} />
      )}
    </Stack>
  )
}

function ScopedBoard({ current, views, view }: { current: ChangesSnapshot | null; views: WorkspaceView[]; view?: WorkspaceView }) {
  return (
    <>
      {views.length > 1 ? (
        <Select
          label="Worktree"
          value={view?.workspaceId ?? ''}
          options={views.map((v) => ({
            value: v.workspaceId,
            label: `${v.focused ? 'This worktree' : 'Sibling'}: ${v.name}${v.branch ? ` (${v.branch})` : ''}`
          }))}
          onChange={(value) => set(viewChoice, value)}
        />
      ) : null}
      {view?.focused ? <AgentSelect /> : null}
      {view && !view.focused ? (
        <Text muted size="xs">Sibling worktree: read only. Switch to it in Orca to apply a change.</Text>
      ) : null}
      {view ? (
        <Stack gap="sm">
          <Text muted size="xs">{summary(entriesOf([view]))}</Text>
          <Board view={view} />
        </Stack>
      ) : !current && !read(problem) ? (
        <Spinner label="Reading OpenSpec changes" />
      ) : null}
    </>
  )
}
