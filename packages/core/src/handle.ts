import { MediaLibraryError } from './errors.js'

/**
 * Handle bound to a single (modelType, modelId) pair, scoped to operate on
 * that model's media. This is a Task 11 stub: only the identity fields are
 * wired up here; `add()` (and future collection-scoped operations) are
 * implemented in Task 11.
 */
export class ModelMediaHandle {
  constructor(
    public readonly modelType: string,
    public readonly modelId: string,
  ) {}

  async add(..._args: unknown[]): Promise<unknown> {
    throw new MediaLibraryError('not implemented')
  }
}
