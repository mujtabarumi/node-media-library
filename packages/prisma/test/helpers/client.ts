import { PrismaClient } from '../prisma/generated/client.js'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export type TestClient = PrismaClient

let client: PrismaClient | undefined

export async function getTestClient(): Promise<TestClient> {
  if (!client) {
    const dbPath = join(dirname(fileURLToPath(import.meta.url)), '../tmp/contract.db')
    const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
    client = new PrismaClient({ adapter })
  }
  return client
}
