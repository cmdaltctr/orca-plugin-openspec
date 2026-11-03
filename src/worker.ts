// Orca starts this worker on the panel's first plugin.request. No build step.
import type { OrcaWorkerApi } from 'orca/worker'
import { realIo } from './disk-io'
import { register } from './handlers'

export default function activate(orca: OrcaWorkerApi): void {
  register(orca, realIo)
}
