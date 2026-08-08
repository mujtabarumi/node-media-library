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

A driver implementing _both_ `attach()` and `work()` is now rejected: the `MediaLibrary` constructor
throws a `MediaLibraryError` before wiring anything. The union type admits that shape, but it would
consume inline in every process that constructs a `MediaLibrary` while `startWorker()` also consumed
from the broker — reinstating the exact defect this split removes.

Adds `@node-media-library/rabbitmq`, an amqplib-backed driver accepting either a `url` or a
caller-owned `connection`. Note that `amqp-connection-manager` is **not** a compatible `connection`
(its `createChannel()` is synchronous and returns a `ChannelWrapper`), so reconnection is the caller's
responsibility — see that package's "Known limitations".
