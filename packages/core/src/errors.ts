export class MediaLibraryError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'MEDIA_LIBRARY_ERROR',
  ) {
    super(message)
    this.name = new.target.name
  }
}
export class FileTooLargeError extends MediaLibraryError {
  constructor(m: string) {
    super(m, 'FILE_TOO_LARGE')
  }
}
export class DisallowedExtensionError extends MediaLibraryError {
  constructor(m: string) {
    super(m, 'DISALLOWED_EXTENSION')
  }
}
export class UnacceptableFileError extends MediaLibraryError {
  constructor(m: string) {
    super(m, 'UNACCEPTABLE_FILE')
  }
}
export class UnknownModelError extends MediaLibraryError {
  constructor(m: string) {
    super(m, 'UNKNOWN_MODEL')
  }
}
export class ConversionFailedError extends MediaLibraryError {
  constructor(m: string) {
    super(m, 'CONVERSION_FAILED')
  }
}
export class StorageError extends MediaLibraryError {
  constructor(m: string) {
    super(m, 'STORAGE_ERROR')
  }
}
export class DownloadFailedError extends MediaLibraryError {
  constructor(m: string) {
    super(m, 'DOWNLOAD_FAILED')
  }
}
