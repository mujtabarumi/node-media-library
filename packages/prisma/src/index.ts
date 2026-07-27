export const VERSION = '0.0.0'

export type { MediaRow, MediaDelegate, PrismaLikeClient } from './client.js'
export { toMediaRecord, toCreateData } from './mapping.js'
export { MEDIA_MODEL_SNIPPET } from './schema.js'
export { prismaAdapter } from './adapter.js'
export type { PrismaAdapterOptions } from './adapter.js'
export { withMediaCascade } from './cascade.js'
export type { CascadeOptions } from './cascade.js'
