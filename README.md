# OpenSpec for Orca

A board of the OpenSpec changes in the workspace you are looking at. Each change shows its stage
(Planning, Ready, In progress, Complete), its artefacts (of 4) and its task progress.

## What it shows

- **This worktree.** Reads `openspec/changes/*` in the focused workspace. It never reads another project.
- **Sibling worktrees.** Other worktrees of the same Git repository (for example `v3` and its
  `feat/*` worktrees) appear in the Worktree menu as read-only views. The check is the shared
  Git common directory, so a worktree of a different repository is never listed.
- **Apply.** Pick an agent terminal and press Apply on a Ready or In progress change. The plugin types
  `/opsx:apply <change>` (Claude Code) or `/opsx-apply <change>` (other agents) into that terminal,
  followed by one line that asks the agent to use the `omms:omms-memory` skill. Apply is available on
  the focused worktree only, because the agent list covers that workspace.
- **Cards.** Every file of a change (proposal, design, tasks, specs) shows each `##` section in its own card.
- **Agent menu help.** The "i" button beside "Send to agent" shows a tooltip on hover. Click it to open
  a short explanation of which agents are listed and what Apply types.
- **Todo tab.** Open a change and choose the `todo` tab to see the unticked tasks from `tasks.md`,
  one card per task under its section heading. The tab has an agent menu and an "Apply all" button for
  the whole change. Each card has its own Apply, which asks the agent to do only that task and tick it.
  The buttons always show. When Apply cannot run (sibling worktree, change not Ready or In progress,
  no agent picked) the button is greyed out and its tooltip gives the reason.
  The plugin checks that the task is still an unticked line of `tasks.md` before it types anything.

## Stages

| Stage       | Rule                                                              |
| ----------- | ----------------------------------------------------------------- |
| Planning    | Fewer than 4 artefacts (proposal, design, specs, tasks).          |
| Ready       | All 4 artefacts, no task ticked.                                  |
| In progress | Some tasks ticked.                                                |
| Complete    | Every task ticked.                                                |

The plugin reads the files directly and assumes the default `spec-driven` schema. It does not
run the `openspec` CLI.

## Limits

- Local workspaces only. Remote (SSH or WSL) workspaces show a message.
- Orca's plugin API does not expose parent and child worktree links, so a child worktree appears as a
  sibling. A future host API field (`parentWorkspaceId` on `workspace.list`) would allow a child view.
- Orca identifies the focused workspace by branch and name. If two workspaces share both, the
  panel says it cannot tell which is focused.

## Develop

```sh
orca plugin test .
orca plugin check .
orca plugin dev watch .
```

## Licence

MIT. See [LICENSE](./LICENSE).
