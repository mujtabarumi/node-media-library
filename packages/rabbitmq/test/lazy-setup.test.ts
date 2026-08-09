import { EventEmitter } from 'node:events'
import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * These cases are about *how many* connections and channels the driver opens,
 * and about what `close()` can still reach afterwards. A real broker can be
 * asked to demonstrate neither: the leak is in the driver's own client-side
 * bookkeeping, and the broker has no way to report that two connections came
 * from one driver that meant to open one. So `amqplib` itself is the seam
 * stood in for here; everything above it is the real driver.
 */
const broker = vi.hoisted(() => ({
  connects: 0,
  channels: 0,
  closedConnections: 0,
  closedChannels: 0,
  /** A non-zero delay is the whole point: it opens the race window. */
  connectDelayMs: 5,
  channelDelayMs: 5,
  /** How many of the next connect() calls should fail. */
  failNextConnects: 0,
  lastConnection: undefined as EventEmitter | undefined,
  lastChannel: undefined as EventEmitter | undefined,
}))

vi.mock('amqplib', () => {
  const makeChannel = async () => {
    broker.channels++
    await new Promise((r) => setTimeout(r, broker.channelDelayMs))
    const channel = Object.assign(new EventEmitter(), {
      assertQueue: async () => ({}),
      prefetch: async () => ({}),
      consume: async () => ({ consumerTag: `ct-${broker.channels}` }),
      cancel: async () => ({}),
      close: async () => {
        broker.closedChannels++
      },
      ack: () => {},
      nack: () => {},
      sendToQueue: (
        _queue: string,
        _content: Buffer,
        _options?: unknown,
        cb?: (err: unknown) => void,
      ) => {
        cb?.(null)
        return true
      },
    })
    broker.lastChannel = channel
    return channel
  }

  return {
    default: {
      connect: async () => {
        broker.connects++
        await new Promise((r) => setTimeout(r, broker.connectDelayMs))
        if (broker.failNextConnects > 0) {
          broker.failNextConnects--
          throw new Error('ECONNREFUSED')
        }
        const connection = Object.assign(new EventEmitter(), {
          createChannel: makeChannel,
          createConfirmChannel: makeChannel,
          close: async () => {
            broker.closedConnections++
          },
        })
        broker.lastConnection = connection
        return connection
      },
    },
  }
})

const { rabbitmqDriver } = await import('../src/driver.js')

const job = { mediaId: 'm1', conversionNames: ['thumb'] }

beforeEach(() => {
  Object.assign(broker, {
    connects: 0,
    channels: 0,
    closedConnections: 0,
    closedChannels: 0,
    connectDelayMs: 5,
    channelDelayMs: 5,
    failNextConnects: 0,
    lastConnection: undefined,
    lastChannel: undefined,
  })
})

describe('lazy setup under concurrency', () => {
  it('opens exactly one connection and one producer channel for concurrent enqueues', async () => {
    const driver = rabbitmqDriver({ url: 'amqp://stub', onError: () => {} })

    // Two parallel HTTP requests both reaching FileAdder.dispatchConversions
    // before the first channel resolves — a cold-start web process. Memoizing
    // the resolved value instead of the promise lets every one of these pass
    // the `if (!connection)` check, so each opens its own connection and
    // channel; all but the last are then orphaned — referenced by nobody, so
    // close() cannot reach them, yet ref'd enough to keep the process alive.
    await Promise.all(Array.from({ length: 5 }, () => driver.enqueue(job)))

    expect(broker.connects).toBe(1)
    expect(broker.channels).toBe(1)

    await driver.close()
    expect(broker.closedConnections).toBe(1)
    expect(broker.closedChannels).toBe(1)
  })

  it('shares one connection between a concurrent enqueue() and work()', async () => {
    const driver = rabbitmqDriver({ url: 'amqp://stub', onError: () => {} })

    const [, worker] = await Promise.all([driver.enqueue(job), driver.work(async () => {})])

    expect(broker.connects).toBe(1)
    // One for the producer, one for the consumer.
    expect(broker.channels).toBe(2)

    await worker.close()
    await driver.close()
    expect(broker.closedConnections).toBe(1)
  })

  it('closes a connection and channel still being opened when close() lands', async () => {
    const driver = rabbitmqDriver({ url: 'amqp://stub', onError: () => {} })

    // close() arrives while the connect is still in flight. Reading a resolved
    // `connection` variable at that moment finds `undefined` and closes
    // nothing, leaving an open socket behind that keeps the process alive
    // after close() resolved — the exact reason library.close() stopped being
    // a reliable shutdown.
    const enqueued = driver.enqueue(job)
    await driver.close()
    await enqueued

    expect(broker.connects).toBe(1)
    expect(broker.closedConnections).toBe(1)
    expect(broker.closedChannels).toBe(1)
  })

  it('retries the connect after a failed one instead of poisoning the memo', async () => {
    broker.failNextConnects = 1
    const driver = rabbitmqDriver({ url: 'amqp://stub', onError: () => {} })

    // A broker that happens to be down at the first enqueue must not leave
    // this driver unable to publish for the rest of the process's life. The
    // memo holds a promise, but a rejected one is cleared so the next caller
    // connects again.
    await expect(driver.enqueue(job)).rejects.toThrow('ECONNREFUSED')
    await expect(driver.enqueue(job)).resolves.toBeUndefined()

    expect(broker.connects).toBe(2)
    await driver.close()
  })

  it('rejects work() that finishes connecting after close() rather than leaking a consumer', async () => {
    const driver = rabbitmqDriver({ url: 'amqp://stub', onError: () => {} })
    // Warm the connection so work() below is past its own `closed` check and
    // inside channel setup when close() lands.
    await driver.enqueue(job)

    const working = driver.work(async () => {})
    await driver.close()

    await expect(working).rejects.toThrow('queue driver is closed')
    // The consumer channel driver.close() could not see was closed by work()
    // itself: one producer channel plus one consumer channel, both shut.
    expect(broker.closedChannels).toBe(2)
  })
})

describe('broker error reporting', () => {
  it('reports a connection error through onError instead of throwing at the process', async () => {
    const errors: Error[] = []
    const driver = rabbitmqDriver({ url: 'amqp://stub', onError: (err) => errors.push(err) })
    await driver.enqueue(job)

    // Node throws on an unhandled 'error' event. With no listener attached
    // this line is an uncaught exception in whatever process holds the driver
    // — the web process as much as the worker.
    broker.lastConnection!.emit('error', new Error('CONNECTION_FORCED'))
    expect(errors.map((e) => e.message)).toEqual(['CONNECTION_FORCED'])

    await driver.close()
  })

  it('reports a producer channel error through onError', async () => {
    const errors: Error[] = []
    const driver = rabbitmqDriver({ url: 'amqp://stub', onError: (err) => errors.push(err) })
    await driver.enqueue(job)

    broker.lastChannel!.emit('error', new Error('PRECONDITION_FAILED'))
    expect(errors.map((e) => e.message)).toEqual(['PRECONDITION_FAILED'])

    await driver.close()
  })

  it('reports a consumer channel error through onError', async () => {
    const errors: Error[] = []
    const driver = rabbitmqDriver({ url: 'amqp://stub', onError: (err) => errors.push(err) })
    const worker = await driver.work(async () => {})

    broker.lastChannel!.emit('error', new Error('CHANNEL_ERROR'))
    expect(errors.map((e) => e.message)).toEqual(['CHANNEL_ERROR'])

    await worker.close()
    await driver.close()
  })
})
