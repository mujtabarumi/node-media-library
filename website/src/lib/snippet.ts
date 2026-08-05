/**
 * Extracts a named region from an example source file.
 *
 * Pages embed real code from `examples/src/*.ts` — the same files the
 * `@node-media-library/examples` test suite executes in CI — rather than
 * retyping snippets into MDX, where they rot silently.
 *
 * Regions are delimited by line comments:
 *
 *   // #region config
 *   ...code...
 *   // #endregion config
 *
 * A missing region THROWS, which fails `astro build`. That is deliberate: if
 * someone renames or deletes a region, the docs must break loudly rather than
 * render an empty code block.
 */
export function snippet(source: string, region: string): string {
  const lines = source.split('\n')

  const start = lines.findIndex((line) => line.trim() === `// #region ${region}`)
  if (start === -1) {
    throw new Error(
      `snippet(): no "// #region ${region}" marker found. Regions available: ${available(lines).join(', ') || '(none)'}`,
    )
  }

  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      (line.trim() === `// #endregion ${region}` || line.trim() === '// #endregion'),
  )
  if (end === -1) {
    throw new Error(`snippet(): region "${region}" is never closed by a "// #endregion".`)
  }

  const body = lines.slice(start + 1, end)
  const indents = body
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length - line.trimStart().length)
  const dedent = indents.length > 0 ? Math.min(...indents) : 0

  return body
    .map((line) => line.slice(dedent))
    .join('\n')
    .trim()
}

function available(lines: string[]): string[] {
  return lines
    .map((line) => /^\s*\/\/ #region (.+)$/.exec(line)?.[1]?.trim())
    .filter((name): name is string => Boolean(name))
}
