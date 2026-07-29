<!--
Thanks for contributing. Please read CONTRIBUTING.md if you haven't yet.
Keep PRs focused — one logical change per PR gets reviewed fastest.
-->

## What and why

<!-- What does this change, and what problem does it solve? Explain the "why", not just the "what". -->

Closes #

## Affected packages

<!-- Check every package this touches. -->

- [ ] `@node-media-library/core`
- [ ] `@node-media-library/prisma`
- [ ] `@node-media-library/bullmq`
- [ ] `@node-media-library/pdf`
- [ ] `@node-media-library/video`
- [ ] `@node-media-library/optimizers`
- [ ] Repo tooling / CI / docs only

## Checklist

- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm -r test` passes (binary/Redis-gated skips are expected locally)
- [ ] New behavior has tests that would fail without this change
- [ ] Docs, JSDoc, and — if behavior changed — the design spec reflect the new behavior **including its caveats**
- [ ] Commits follow Conventional Commits (`feat(core): …`, `fix(optimizers): …`)
- [ ] Repository-interface changes are covered in `packages/core/src/testing/repository-contract.ts` so every backend is held to them

## Behavior changes

<!--
Is this a breaking change to a public API, storage layout, or stored JSON shape?
If so, describe the impact and any migration a consumer needs to perform.
Write "None" if there are none.
-->

## Deviations from the spec or plan

<!--
Did you intentionally diverge from docs/superpowers/specs/ or from an issue's agreed approach?
Call it out here so a reviewer can confirm it was deliberate. Write "None" if there are none.
-->
