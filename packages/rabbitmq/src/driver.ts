import amqp from 'amqplib'
import {
  MediaLibraryError,
  type BrokerQueueDriver,
  type ConversionJob,
  type ConversionProcessor,
  type QueueWorker,
  type WorkOptions,
} from '@node-media-library/core'

const DEFAULT_QUEUE_NAME = 'media-conversions'
const DEFAULT_PREFETCH = 2

/**
 * The subset of an amqplib connection this driver uses. Structural rather than
 * nominal, so an in-house wrapper or connection pool satisfies it without
 * importing our types — as long as its `createChannel()` *resolves to* a real
 * amqplib `Channel`. That is the whole bar, and it is a narrow one: the driver
 * calls `assertQueue`/`prefetch`/`consume`/`ack`/`nack`/`sendToQueue`/`cancel`
 * on whatever comes back.
 *
 * Notably, `amqp-connection-manager` does **not** fit: its `createChannel()` is
 * synchronous and returns a `ChannelWrapper` (an `addSetup`-based reconnect
 * abstraction), not a `Promise<Channel>`. Reconnection is the caller's problem
 * with this driver — see the package README's "Known limitations".
 */
export interface AmqpLikeConnection {
  createChannel(): Promise<amqp.Channel>
  close(): Promise<void>
}

interface SharedOptions {
  /** @defaultValue 'media-conversions' */
  queueName?: string
  /** Default unacked-message window per worker. @defaultValue 2 */
  prefetch?: number
  /** Exchange failed jobs are dead-lettered to. Omit to drop them. */
  deadLetterExchange?: string
}

export type RabbitmqDriverOptions = SharedOptions &
  ({ url: string; connection?: never } | { connection: AmqpLikeConnection; url?: never })

/**
 * RabbitMQ-backed broker driver.
 *
 * Connections are opened lazily on first `enqueue`/`work`, so constructing
 * the driver never touches the broker. Delivery is at-least-once: a job may
 * be redelivered after a crash, so processors must be idempotent.
 *
 * Ownership: with `url` the driver opened the connection and closes it. With
 * `connection` the caller owns it, and `close()` closes only the channels
 * this driver opened — tearing down a shared connection would break every
 * other consumer in the process.
 */
export function rabbitmqDriver(opts: RabbitmqDriverOptions): BrokerQueueDriver {
  if (!opts.url && !opts.connection) {
    throw new MediaLibraryError('rabbitmqDriver requires either `url` or `connection`')
  }

  const queueName = opts.queueName ?? DEFAULT_QUEUE_NAME
  const defaultPrefetch = opts.prefetch ?? DEFAULT_PREFETCH
  const ownsConnection = !opts.connection

  let connection: AmqpLikeConnection | undefined = opts.connection
  let producerChannel: amqp.Channel | undefined
  const workers = new Set<QueueWorker>()
  let closed = false
  let driverClosing: Promise<void> | undefined

  const queueArgs = opts.deadLetterExchange
    ? { durable: true, arguments: { 'x-dead-letter-exchange': opts.deadLetterExchange } }
    : { durable: true }

  async function getConnection(): Promise<AmqpLikeConnection> {
    if (!connection) {
      // amqplib 0.10.4+ resolves `connect()` to a `ChannelModel`, not the
      // older `Connection` type some `@types/amqplib` versions still export
      // under that name. `ChannelModel` already exposes exactly
      // `createChannel()`/`close()` with matching signatures, so it
      // satisfies `AmqpLikeConnection` structurally — no cast required.
      connection = await amqp.connect(opts.url!)
    }
    return connection
  }

  async function getProducerChannel(): Promise<amqp.Channel> {
    if (!producerChannel) {
      producerChannel = await (await getConnection()).createChannel()
      await producerChannel.assertQueue(queueName, queueArgs)
    }
    return producerChannel
  }

  return {
    async enqueue(job: ConversionJob) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      const channel = await getProducerChannel()
      // `persistent` must be paired with the durable queue above: a durable
      // queue holding non-persistent messages still loses them on restart.
      channel.sendToQueue(queueName, Buffer.from(JSON.stringify(job)), { persistent: true })
    },

    async work(fn: ConversionProcessor, workOpts?: WorkOptions): Promise<QueueWorker> {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      const channel = await (await getConnection()).createChannel()
      const inFlight = new Set<Promise<void>>()

      let consumerTag: string
      try {
        await channel.assertQueue(queueName, queueArgs)
        await channel.prefetch(workOpts?.concurrency ?? defaultPrefetch)

        const consumer = await channel.consume(queueName, (msg) => {
          if (!msg) return
          const settled = (async () => {
            try {
              await fn(JSON.parse(msg.content.toString()) as ConversionJob)
              channel.ack(msg)
            } catch {
              // requeue: false — dead-letter it rather than loop a poison
              // message forever. Retry policy belongs to the broker.
              channel.nack(msg, false, false)
            }
          })()
          inFlight.add(settled)
          // Two independent safeguards against an unhandled rejection, not one:
          // `.finally()` marks `settled` itself handled, but the promise IT
          // returns is a fresh derivative — if that one rejects (ack/nack
          // racing a channel already being torn down) and nothing observes it,
          // Node reports an unhandled rejection and can crash the process
          // under strict handling. The `.catch(() => {})` below closes that
          // gap. Draining `inFlight` before closing the channel (in `close()`
          // below) is what keeps ack/nack from racing teardown in the first
          // place — this catch is the backstop for whatever that drain
          // doesn't cover.
          void settled.finally(() => inFlight.delete(settled)).catch(() => {})
        })
        consumerTag = consumer.consumerTag
      } catch (err) {
        // No QueueWorker exists yet, and driver.close() only closes consumer
        // channels *through* the workers it created — so nothing would ever
        // close this one. It would leak until the connection goes, which with
        // a caller-owned connection may be never.
        await channel.close().catch(() => {})
        throw err
      }

      // Each teardown step is memoized *separately* rather than memoizing
      // close() as a whole. Whole-promise memoization (what BullMQ does) would
      // make a `{ force: true }` call that arrives while a graceful close is
      // still draining return that same pending promise — so the escalation
      // the `worker` CLI performs when `--shutdown-timeout` elapses would wait
      // exactly as long as the drain it was meant to cut short. Per-step
      // memoization keeps both properties: each step runs at most once, and a
      // later force close can still skip the drain and go straight to
      // closing the channel.
      let cancelling: Promise<void> | undefined
      let closingChannel: Promise<void> | undefined
      let draining: Promise<void> | undefined

      const worker: QueueWorker = {
        async close(closeOpts?: { force?: boolean }) {
          workers.delete(worker)
          // Two concurrent closers (a caller's own worker.close() racing
          // driver.close()) must not each cancel the same consumer.
          cancelling ??= channel.cancel(consumerTag).then(() => {})
          await cancelling
          if (!closeOpts?.force) {
            // Drain in-flight jobs while the channel is still open, so their
            // ack()/nack() calls land before close() invalidates the channel.
            // This is also what driver.close() relies on below.
            //
            // allSettled, not all: a settle that *rejected* (an ack that threw
            // on a lost connection, with the nack in its catch throwing for
            // the same reason) is a job we can no longer do anything about,
            // not a reason to reject an otherwise-successful shutdown — and,
            // through driver.close(), exit the worker CLI 1.
            draining ??= Promise.allSettled([...inFlight]).then(() => {})
            await draining
          }
          closingChannel ??= channel.close()
          return closingChannel
        },
      }
      workers.add(worker)
      return worker
    },

    async close() {
      closed = true
      // Memoized rather than `if (closed) return`: that early return lets a
      // concurrent second close() resolve while the first one is still
      // draining, so a caller awaiting it would tear down resources the drain
      // still needs. Every caller awaits the same drain instead.
      driverClosing ??= (async () => {
        // Route through each worker's own graceful close (mirrors
        // packages/bullmq/src/driver.ts) rather than calling `channel.close()`
        // directly: that drains in-flight jobs before the channel closes, so
        // an in-flight processor's later ack()/nack() lands on a still-open
        // channel instead of racing teardown and throwing
        // IllegalOperationError.
        await Promise.all([...workers].map((w) => w.close()))
        workers.clear()
        await producerChannel?.close()
        producerChannel = undefined
        if (ownsConnection) {
          await connection?.close()
          connection = undefined
        }
      })()
      return driverClosing
    },
  }
}
