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
        void settled.finally(() => inFlight.delete(settled))
      })

      return {
        async close(closeOpts?: { force?: boolean }) {
          // driver.close() may already have closed this channel — guard so
          // a caller's worker.close() afterward is a safe no-op rather than
          // throwing on an already-closed channel.
          if (!consumerChannels.has(channel)) return
          await channel.cancel(consumerTag)
          if (!closeOpts?.force) {
            await Promise.all([...inFlight])
          }
          consumerChannels.delete(channel)
          await channel.close()
        },
      }
    },

    async close() {
      if (closed) return
      closed = true
      await Promise.all([...consumerChannels].map((c) => c.close()))
      consumerChannels.clear()
      await producerChannel?.close()
      producerChannel = undefined
      if (ownsConnection) {
        await connection?.close()
        connection = undefined
      }
    },
  }
}
