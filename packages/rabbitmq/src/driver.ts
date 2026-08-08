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
 * The subset of an amqplib connection this driver uses. Structural rather
 * than nominal so any managed wrapper — `amqp-connection-manager`, an
 * in-house pool — satisfies it without importing our types.
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
  const consumerChannels = new Set<amqp.Channel>()
  const workers = new Set<QueueWorker>()
  let closed = false

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
      consumerChannels.add(channel)
      await channel.assertQueue(queueName, queueArgs)
      await channel.prefetch(workOpts?.concurrency ?? defaultPrefetch)

      const inFlight = new Set<Promise<void>>()

      const { consumerTag } = await channel.consume(queueName, (msg) => {
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

      const worker: QueueWorker = {
        async close(closeOpts?: { force?: boolean }) {
          // driver.close() may already have closed this channel — guard so
          // a caller's worker.close() afterward is a safe no-op rather than
          // throwing on an already-closed channel.
          if (!consumerChannels.has(channel)) return
          workers.delete(worker)
          await channel.cancel(consumerTag)
          if (!closeOpts?.force) {
            // Drain in-flight jobs while the channel is still open, so their
            // ack()/nack() calls land before close() invalidates the
            // channel. This is also what driver.close() relies on below.
            await Promise.all([...inFlight])
          }
          consumerChannels.delete(channel)
          await channel.close()
        },
      }
      workers.add(worker)
      return worker
    },

    async close() {
      if (closed) return
      closed = true
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
    },
  }
}
