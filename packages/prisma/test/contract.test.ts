import { runMediaRepositoryContract } from '@node-media-library/core/testing'
import { prismaAdapter } from '../src/adapter.js'
import { getTestClient } from './helpers/client.js'

runMediaRepositoryContract('PrismaMediaRepository (sqlite)', async () => {
  const client = await getTestClient()
  await client.media.deleteMany({})
  return prismaAdapter(client)
})
