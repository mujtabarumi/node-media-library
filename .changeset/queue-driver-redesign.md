---
'@node-media-library/core': major
'@node-media-library/bullmq': major
'@node-media-library/rabbitmq': major
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
(its `createChannel()` is synchronous and returns a `ChannelWrapper`, and it has no
`createConfirmChannel()` at all), so reconnection is the caller's responsibility — see that package's
"Known limitations".

`rabbitmqDriver.enqueue()` now publishes on a confirm channel and resolves only once the broker has
acknowledged the message (rejecting with a `MediaLibraryError` on a nack), rather than resolving as
soon as the bytes reached a socket buffer. This is a **breaking change to the exported
`AmqpLikeConnection` interface**: a caller-supplied `connection` must now provide a
`createConfirmChannel()` alongside `createChannel()`, both resolving to real amqplib
`Channel`/`ConfirmChannel` objects — the `url` option is unaffected, since amqplib's own connection
already has both.

Both broker drivers gain an `onError?: (err: Error) => void` option, called on every `'error'` event
from the underlying connection/channels (`rabbitmqDriver`) or `Queue`/`Worker` (`bullmqDriver`) —
without a listener, Node treats an unhandled `'error'` event as an uncaught exception rather than a
rejected call. Defaults to logging via `console.error`. `rabbitmqDriver` also rejects an oversized
consumed message (over 64 KiB) before parsing it, reporting the rejection through `onError`.

`MediaLibrary.startWorker()` now shape-checks every job payload before it reaches the conversion
engine, throwing `MediaLibraryError` for a payload without a string `mediaId` or with a
`conversionNames` that isn't absent or an array of strings — third-party drivers inherit this for free
and don't need to validate payloads themselves. The in-process/broker driver discriminator now probes
for a callable `attach`/`work` member instead of using the `in` operator, so a declared-but-`undefined`
property (an unused optional field, an object spread) is no longer mistaken for an implemented one.

The `node-media-library worker`/`regenerate`/`clean` CLI commands now close the `MediaLibrary` on
every exit path, including a failed `worker` start — previously only some paths did, so a broker
driver's open connection could keep the process running indefinitely after the command had already
finished. `--concurrency` must now be a positive integer (previously any positive number), and both it
and `--shutdown-timeout` are validated before the config loads.
