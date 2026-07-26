import { runMediaRepositoryContract } from '../src/testing/repository-contract.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'

runMediaRepositoryContract('InMemoryMediaRepository', async () => new InMemoryMediaRepository())
