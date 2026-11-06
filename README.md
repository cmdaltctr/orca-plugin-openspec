# OpenSpec for Orca

An Orca panel for projects that use [OpenSpec](https://github.com/Fission-AI/OpenSpec). It reads the
`openspec/changes/*` folders in your workspace and shows each change on a board. Each change shows its
stage (Planning, Ready, In progress, Complete), its artefacts (of 4) and its task progress.

Use it to see what is planned, what is ready to build and what is done, without leaving Orca.
When a change is ready, press Apply to send it to a running agent terminal.

## Install

1. In Orca, install the plugin from the plugin directory, or from this repository's Git URL.
2. Open the **OpenSpec** panel.
3. Approve the access it asks for: read the workspace, read the agent list and send text to a terminal.

## What it shows

- **This worktree.** Reads `openspec/changes/*` in the focused workspace. It never reads another project.
- **Sibling worktrees.** Other worktrees of the same Git repository (for example `v3` and its
  `feat/*` worktrees) appear in the Worktree menu as read-only views. The check is the shared
  Git common directory, so a worktree of a different repository is never listed.
- **All worktrees tab.** When siblings exist, the "All worktrees" tab shows the changes of the focused
  worktree and every sibling on one board. Under each change name is its worktree folder. Hover
  the info button to see the branch, or press it to show the branch under the line.
- **Run order.** Each card shows its run number on the top right, counted within its worktree.
  A number you set by hand wins. To set it, press the number in the focused worktree and pick
  one. The plugin saves it as `order: N` in the change's `.openspec.yaml`. Pick "Auto" to remove
  it. Every other change comes after the changes named in backticks on its `Depends on:` line or
  in its `## Dependency` section of `proposal.md`. Ties go by the `created:` date. Hand-set
  numbers are used as they are, and the other changes take the numbers that are free. A
  hand-set number has an outlined button.
- **Sort.** Each stage with two or more cards has a "Run order ↑" button next to its count.
  Press it to show the highest number first ("Run order ↓"). Press again for #1 first.
- **Pin.** Press the star next to the run number to pin a change. A pinned change moves to the
  Pinned section above every stage. Pinned cards keep their run number, sort #1 first, and show
  their stage. The plugin saves it as `pin: true`
  in `.openspec.yaml` of the worktree that holds the change. You can pin a change in any listed
  worktree, also from the All worktrees tab.
- **Search and filter.** Type in "Search changes" to show only the cards whose change name contains the text. On the All worktrees tab, use "Show worktree" to show one
  worktree only. On both tabs, use "Show stage" to show only Planning, Ready, In progress or
  Complete. Pinned cards stay at the top of the filtered list.
  You can open any change. Apply works only on changes of the focused worktree.
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
