// No build step: Orca strips the types and compiles the JSX when it loads.
import {
  atom,
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  host,
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

async function apply(view: WorkspaceView, change: ChangeRow): Promise<void> {
  try {
    const result = await plugin.request(
      'change.apply',
      { workspaceId: view.workspaceId, changeName: change.name, terminalId: read(agentChoice) },
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

async function chooseFile(ref: ChangeRef, path: string): Promise<void> {
  set(fileChoice, path)
  set(fileText, null)
  set(editing, false)
  try {
    const { text } = await plugin.request('file.read', { ...ref, path }, REQUEST)
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

function FileView({ view, change }: { view: WorkspaceView; change: ChangeRow }) {
  const ref = { workspaceId: view.workspaceId, changeName: change.name }
  const choice = read(fileChoice)
  const text = read(fileText)
  const isEditing = read(editing)
  const body =
    text === null ? (
      <Spinner label="Reading file" />
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
        <Markdown content={text} />
      </Stack>
    )
  return (
    <Stack gap="sm">
      <Row justify="between" align="center">
        <Heading>{change.name}</Heading>
        <Button variant="ghost" onPress={closeFiles}>
          Back to changes
        </Button>
      </Row>
      {read(files).length === 0 ? (
        <Text muted size="xs">This change has no markdown files yet.</Text>
      ) : (
        <Tabs label={`${change.name} files`} value={choice} onChange={(path) => void chooseFile(ref, path)}>
          {read(files).map((path) => (
            <Tab key={path} value={path} label={fileLabel(path)} disabled={isEditing && path !== choice}>
              {body}
            </Tab>
          ))}
        </Tabs>
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
    }),
    on('agent.status.changed', () => void loadAgents()),
    { dispose: () => clearInterval(timer) }
  )
}

const percent = (done: number, total: number): number => (total === 0 ? 0 : Math.round((done / total) * 100))

function ChangeCard({ view, change }: { view: WorkspaceView; change: ChangeRow }) {
  const { artefacts, tasks } = change
  const canApply = view.focused && (change.stage === 'ready' || change.stage === 'in-progress')
  return (
    <Card title={change.name}>
      <Stack gap="xs">
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
        <Row gap="xs">
          <Button variant="outline" icon="file-text" onPress={() => void openFiles(view, change)}>
            Open
          </Button>
          {canApply ? (
            <Button
              variant="outline"
              icon="play"
              disabled={!read(agentChoice)}
              tooltip={read(agentChoice) ? undefined : 'Pick an agent terminal first'}
              onPress={() => void apply(view, change)}
            >
              Apply
            </Button>
          ) : null}
        </Row>
      </Stack>
    </Card>
  )
}

function Board({ view }: { view: WorkspaceView }) {
  if (view.changes === null) {
    return (
      <EmptyState icon="info" title="No OpenSpec here" description="This workspace has no openspec/changes folder." />
    )
  }
  const changes = view.changes
  return (
    <Stack gap="md">
      {SECTIONS.map(({ stage, title }) => {
        const inStage = changes.filter((change) => change.stage === stage)
        return (
          <Stack key={stage} gap="xs">
            <Row gap="xs" align="center">
              <Text>{title}</Text>
              <Badge tone="neutral">{String(inStage.length)}</Badge>
            </Row>
            {inStage.length === 0 ? <Text muted size="xs">No changes here</Text> : null}
            {inStage.map((change) => (
              <ChangeCard key={change.name} view={view} change={change} />
            ))}
          </Stack>
        )
      })}
    </Stack>
  )
}

function summary(view: WorkspaceView): string {
  const changes = view.changes ?? []
  const done = changes.reduce((sum, change) => sum + change.tasks.done, 0)
  const total = changes.reduce((sum, change) => sum + change.tasks.total, 0)
  return `${changes.length} changes · ${done} of ${total} tasks complete`
}

export default function Panel() {
  const current = read(snapshot)
  const views = current?.views ?? []
  const chosen = read(viewChoice)
  const view = views.find((v) => v.workspaceId === chosen) ?? views.find((v) => v.focused) ?? views[0]
  const options = read(agentOptions)
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
      {view?.focused && options.length > 0 ? (
        <Select
          label="Send to agent"
          placeholder="Pick an agent terminal"
          value={read(agentChoice)}
          options={options}
          onChange={(value) => set(agentChoice, value)}
        />
      ) : null}
      {view && !view.focused ? (
        <Text muted size="xs">Sibling worktree: read only. Switch to it in Orca to apply a change.</Text>
      ) : null}
      {view ? (
        <Stack gap="sm">
          <Text muted size="xs">{summary(view)}</Text>
          <Board view={view} />
        </Stack>
      ) : !current && !read(problem) ? (
        <Spinner label="Reading OpenSpec changes" />
      ) : null}
    </Stack>
  )
}
