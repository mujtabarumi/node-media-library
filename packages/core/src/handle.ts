import { FileAdder } from './pipeline/file-adder.js'
import type { MediaSource } from './pipeline/source.js'
import type { MediaLibrary } from './library.js'

/**
 * Handle bound to a single (modelType, modelId) pair, scoped to operate on
 * that model's media.
 */
export class ModelMediaHandle {
  constructor(
    public readonly modelType: string,
    public readonly modelId: string,
    private readonly library: MediaLibrary,
  ) {}

  /** Returns a `FileAdder` builder; call `.toCollection()` to run the pipeline. */
  add(source: MediaSource): FileAdder {
    return new FileAdder(this.library, this.modelType, this.modelId, source)
  }
}
