# @node-media-library/pdf

PDF-backed ImageGenerator using poppler's `pdftoppm` for rendering pages as PNG, then applying conversions through the sharp pipeline.

## System Requirements

Requires the `pdftoppm` binary from the poppler utilities:

- **macOS**: `brew install poppler`
- **Linux (Debian/Ubuntu)**: `apt install poppler-utils`
- **Linux (Fedora/RHEL)**: `dnf install poppler-utils`

## Usage

Append the PDF generator to your `imageGenerators` array alongside `sharpImageGenerator`:

```typescript
import { sharpImageGenerator } from '@node-media-library/core'
import { pdfImageGenerator } from '@node-media-library/pdf'

const handler = mediaLibrary({
  imageGenerators: [
    pdfImageGenerator(),
    sharpImageGenerator(),
  ],
})
```

## Configuration

`pdfImageGenerator(options?)`

### Options

- `pdftoppmPath` (string): Path to the `pdftoppm` binary. Default: `'pdftoppm'` (assumes it's on PATH)
- `dpi` (number): Render resolution in DPI. Default: `150`

### Example

```typescript
pdfImageGenerator({
  pdftoppmPath: '/usr/local/bin/pdftoppm',
  dpi: 300,
})
```

## Selecting Pages

Use `conversion().pdfPageNumber(n)` to select which page to render (default is page 1):

```typescript
conversion()
  .pdfPageNumber(2)  // Render page 2
  .width(800)
  .toDefinition()
```

## Testing

Tests include binary-gated suites that skip when `pdftoppm` is not available. Pure tests (those not requiring the binary) always run:

```bash
pnpm --filter @node-media-library/pdf test
```

- ✓ Pure tests (MIME type support) run without pdftoppm
- ⊘ Binary-gated tests skip if pdftoppm not found
- Install poppler to run all tests
