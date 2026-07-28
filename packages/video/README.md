# @node-media-library/video

Video-backed ImageGenerator using ffmpeg to extract frames at specified timestamps, then applying conversions through the sharp pipeline.

## System Requirements

Requires the `ffmpeg` binary:

- **macOS**: `brew install ffmpeg`
- **Linux (Debian/Ubuntu)**: `apt install ffmpeg`
- **Linux (Fedora/RHEL)**: `dnf install ffmpeg`
- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) or `choco install ffmpeg`

## Usage

Append the video generator to your `imageGenerators` array alongside `sharpImageGenerator`:

```typescript
import { createMediaLibrary, sharpImageGenerator } from '@node-media-library/core'
import { videoImageGenerator } from '@node-media-library/video'

createMediaLibrary({
  // ...
  imageGenerators: [sharpImageGenerator(), videoImageGenerator()],
})
```

## Configuration

`videoImageGenerator(options?)`

### Options

- `ffmpegPath` (string): Path to the `ffmpeg` binary. Default: `'ffmpeg'` (assumes it's on PATH)

### Example

```typescript
videoImageGenerator({
  ffmpegPath: '/usr/local/bin/ffmpeg',
})
```

## Selecting Frames

Use `conversion().videoFrameAtSecond(n)` to select which frame to extract (default is frame at 0 seconds):

```typescript
conversion()
  .videoFrameAtSecond(2.5)  // Extract frame at 2.5 seconds
  .width(800)
  .toDefinition()
```

## Testing

Tests include binary-gated suites that skip when `ffmpeg` is not available. Pure tests (those not requiring the binary) always run:

```bash
pnpm --filter @node-media-library/video test
```

- ✓ Pure tests (MIME type support) run without ffmpeg
- ⊘ Binary-gated tests skip if ffmpeg not found
- Install ffmpeg to run all tests
