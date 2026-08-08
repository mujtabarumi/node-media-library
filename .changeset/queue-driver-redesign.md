---
'@node-media-library/core': minor
'@node-media-library/bullmq': minor
'@node-media-library/rabbitmq': minor
---

Split `QueueDriver` into `InProcessQueueDriver` (`attach`) and `BrokerQueueDriver` (`work`), and stop
attaching a processor to broker drivers at construction — a process that merely constructs a
`MediaLibrary` no longer consumes conversion jobs. Consuming now requires an explicit
`MediaLibrary.startWorker()`, or the new `node-media-library worker` command.

`registerProcessor` is removed. In-process drivers use `attach`; broker drivers use `work`, which
returns a `QueueWorker` whose `close()` waits for in-flight jobs unless forced. `deferDriver.close()`
now drains its scheduled callbacks instead of resolving while work is still pending.

Adds `@node-media-library/rabbitmq`, an amqplib-backed driver accepting either a `url` or a
caller-owned `connection`.
