# OpenSpec for Orca

A board of the OpenSpec changes in the workspace you are looking at. Each change shows its stage
(Planning, Ready, In progress, Complete), its artefacts (of 4) and its task progress.

## What it shows

- **This worktree.** Reads `openspec/changes/*` in the focused workspace. It never reads another project.
- **Sibling worktrees.** Other worktrees of the same Git repository (for example `v3` and its
  `feat/*` worktrees) appear in the Worktree menu as read-only views. The check is the shared
  Git common directory, so a worktree of a different repository is never listed.
- **Apply.** Pick an agent terminal and press Apply on a Ready or In progress change. The plugin types
  `/opsx:apply <change>` (Claude Code) or `/opsx-apply <change>` (other agents) into that terminal.
  Apply is available on the focused worktree only, because the agent list covers that workspace.

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
