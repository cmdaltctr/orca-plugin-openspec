// `orca plugin check` renders the panel once per scenario, with the worker on a fresh host.
// The host has no focused workspace, so the panel shows its "no project" state; the board
// itself is covered by the unit tests.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  fresh: {}
})
