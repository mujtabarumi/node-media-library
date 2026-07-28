#!/usr/bin/env node
import { runCli, defaultLoadLibrary } from './cli/run.js'

process.exitCode = await runCli(process.argv.slice(2), {
  loadLibrary: defaultLoadLibrary,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
