---
title: 'API reference'
editUrl: false
description: 'Generated reference for every public export of @node-media-library/core.'
banner:
  content: 'Generated from source by TypeDoc. Prefer the guides for how to use the library — this is the exhaustive surface.'
---
# @node-media-library/core

## Classes

- [CollectionBuilder](/api/classes/CollectionBuilder/)
- [ConversionBuilder](/api/classes/ConversionBuilder/)
- [ConversionFailedError](/api/classes/ConversionFailedError/)
- [DefaultPathGenerator](/api/classes/DefaultPathGenerator/)
- [DefaultUrlGenerator](/api/classes/DefaultUrlGenerator/)
- [DisallowedExtensionError](/api/classes/DisallowedExtensionError/)
- [DownloadFailedError](/api/classes/DownloadFailedError/)
- [FileAdder](/api/classes/FileAdder/)
- [FileSizeOptimizedWidthCalculator](/api/classes/FileSizeOptimizedWidthCalculator/)
- [FileTooLargeError](/api/classes/FileTooLargeError/)
- [InMemoryMediaRepository](/api/classes/InMemoryMediaRepository/)
- [MediaLibrary](/api/classes/MediaLibrary/)
- [MediaLibraryError](/api/classes/MediaLibraryError/)
- [ModelMediaHandle](/api/classes/ModelMediaHandle/)
- [StorageError](/api/classes/StorageError/)
- [TypedEmitter](/api/classes/TypedEmitter/)
- [UnacceptableFileError](/api/classes/UnacceptableFileError/)
- [UnknownModelError](/api/classes/UnknownModelError/)

## Interfaces

- [CleanOptions](/api/interfaces/CleanOptions/)
- [CleanResult](/api/interfaces/CleanResult/)
- [CollectionDefinition](/api/interfaces/CollectionDefinition/)
- [ConversionDefinition](/api/interfaces/ConversionDefinition/)
- [ConversionJob](/api/interfaces/ConversionJob/)
- [CopyMediaOptions](/api/interfaces/CopyMediaOptions/)
- [ImageGenerator](/api/interfaces/ImageGenerator/)
- [ImageOptimizer](/api/interfaces/ImageOptimizer/)
- [IncomingFile](/api/interfaces/IncomingFile/)
- [MediaEventMap](/api/interfaces/MediaEventMap/)
- [MediaFilter](/api/interfaces/MediaFilter/)
- [MediaLibraryConfig](/api/interfaces/MediaLibraryConfig/)
- [MediaRecord](/api/interfaces/MediaRecord/)
- [MediaRepository](/api/interfaces/MediaRepository/)
- [OptimizeContext](/api/interfaces/OptimizeContext/)
- [PathGenerator](/api/interfaces/PathGenerator/)
- [QueueDriver](/api/interfaces/QueueDriver/)
- [RegenerateOptions](/api/interfaces/RegenerateOptions/)
- [ResponsiveImagesEntry](/api/interfaces/ResponsiveImagesEntry/)
- [ResponsiveVariant](/api/interfaces/ResponsiveVariant/)
- [SignedUrlOptions](/api/interfaces/SignedUrlOptions/)
- [StorageConfig](/api/interfaces/StorageConfig/)
- [UrlGenerator](/api/interfaces/UrlGenerator/)
- [UrlGeneratorOptions](/api/interfaces/UrlGeneratorOptions/)
- [WidthCalculator](/api/interfaces/WidthCalculator/)

## Type Aliases

- [ConversionProcessor](/api/type-aliases/ConversionProcessor/)
- [DiskConfig](/api/type-aliases/DiskConfig/)
- [FileNameSanitizer](/api/type-aliases/FileNameSanitizer/)
- [JsonObject](/api/type-aliases/JsonObject/)
- [MediaQueryFilter](/api/type-aliases/MediaQueryFilter/)
- [MediaSource](/api/type-aliases/MediaSource/)
- [NewMediaRecord](/api/type-aliases/NewMediaRecord/)

## Variables

- [DEFAULT\_DISALLOWED\_EXTENSIONS](/api/variables/DEFAULT_DISALLOWED_EXTENSIONS/)
- [RESERVED\_CONVERSION\_NAMES](/api/variables/RESERVED_CONVERSION_NAMES/)
- [VERSION](/api/variables/VERSION/)

## Functions

- [collection](/api/functions/collection/)
- [contentDisposition](/api/functions/contentDisposition/)
- [conversion](/api/functions/conversion/)
- [createMediaLibrary](/api/functions/createMediaLibrary/)
- [sanitizeFileName](/api/functions/sanitizeFileName/)
- [sharpImageGenerator](/api/functions/sharpImageGenerator/)
- [syncDriver](/api/functions/syncDriver/)
- [toNodeStream](/api/functions/toNodeStream/)
