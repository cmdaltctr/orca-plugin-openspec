// The real disk and git. Tests use a stand-in Io instead.
import { execFile } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import type { Io } from './handlers'

// Orca can start with a short PATH, so add the usual Homebrew locations for `git`.
const PATH = `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin`

export const realIo: Io = {
  list: async (path) => {
    try {
      return await readdir(path)
    } catch {
      return null
    }
  },
  text: async (path) => {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  },
  write: (path, text) => writeFile(path, text, 'utf8'),
  gitCommonDir: (cwd) =>
    new Promise((resolve) => {
      execFile(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd, env: { ...process.env, PATH }, timeout: 10_000 },
        (error, stdout) => resolve(error ? null : stdout.trim() || null)
      )
    })
}
