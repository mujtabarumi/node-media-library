---
'@node-media-library/bullmq': minor
---

Support BullMQ 6. The `bullmq` peer range widens from `^5` to `^5 || ^6` — additive, so existing
BullMQ 5 setups are unaffected. Both majors were verified against a real Redis with the full
`QueueDriver` contract suite; CI exercises whichever version the lockfile pins (currently 6).

One thing to know when moving to BullMQ 6: it no longer bundles `ioredis`. Version 5 had it as a
dependency; 6 makes it an optional peer alongside `redis` and `pg`. pnpm auto-installs optional peers,
npm and yarn do not — so on those, install `ioredis` alongside `bullmq` if you pass a plain connection
object such as `{ url }`. Passing your own client instance avoids the question.
