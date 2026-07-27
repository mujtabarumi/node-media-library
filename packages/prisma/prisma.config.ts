import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'test/prisma/schema.prisma',
  datasource: { url: 'file:./test/tmp/contract.db' },
})
