# @node-media-library/optimizers

Binary image optimizers for node-media-library: `jpegoptim` for JPEGs and `pngquant` for PNGs, both implementing core's `ImageOptimizer` interface.

## System Requirements

Requires the `jpegoptim` and/or `pngquant` binaries:

- **macOS**: `brew install jpegoptim pngquant`
- **Linux (Debian/Ubuntu)**: `apt install jpegoptim pngquant`
- **Linux (Fedora/RHEL)**: `dnf install jpegoptim pngquant`

## Usage

Add the optimizers to your `optimizers` array:

```typescript
import { createMediaLibrary } from '@node-media-library/core'
import { jpegoptimOptimizer, pngquantOptimizer } from '@node-media-library/optimizers'

createMediaLibrary({
  // ...
  optimizers: [jpegoptimOptimizer(), pngquantOptimizer()],
})
```

Each optimizer inspects `OptimizeContext.format` and returns `null` (pass) for formats it doesn't handle, or when its binary is missing.

## Configuration

`jpegoptimOptimizer(options?)`

- `jpegoptimPath` (string): Path to the `jpegoptim` binary. Default: `'jpegoptim'` (assumes it's on PATH)
- `max` (number): Quality cap 0-100. Default: `85`

`pngquantOptimizer(options?)`

- `pngquantPath` (string): Path to the `pngquant` binary. Default: `'pngquant'` (assumes it's on PATH)
- `quality` (string): Quality range, e.g. `'65-90'`. Default: `undefined` (pngquant's own default)

### Example

```typescript
jpegoptimOptimizer({ jpegoptimPath: '/usr/local/bin/jpegoptim', max: 80 })
pngquantOptimizer({ pngquantPath: '/usr/local/bin/pngquant', quality: '65-90' })
```

## Testing

Tests include binary-gated suites that skip when `jpegoptim`/`pngquant` are not available. Pure tests (arg builders, unsupported-format handling) always run:

```bash
pnpm --filter @node-media-library/optimizers test
```

- ✓ Pure tests (arg builders, format/missing-binary handling) run without either binary
- ⊘ Binary-gated tests skip if jpegoptim/pngquant not found
- Install jpegoptim and pngquant to run all tests
