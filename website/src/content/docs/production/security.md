---
title: Security model
description: What is checked on every upload, what is private by default, and exactly what you take on if you replace a default.
---

File upload is one of the more reliably exploitable parts of a web application. These are the
defaults, stated precisely enough that you can tell what you're relying on.

## MIME type is sniffed, never trusted

The type is detected from the file's actual magic bytes for **every** source kind — buffer, stream,
path, base64, or URL download. A client-supplied `Content-Type` header and the filename extension are
never used as the MIME type.

Both `acceptsMimeTypes` and image-generator dispatch check the sniffed value, so a PHP script named
`photo.png` and sent with `Content-Type: image/png` is rejected by an `image/*` collection.

## Filenames are sanitized, from every source

The default sanitizer strips path separators (`/`, `\`), control characters, and leading dots, then
resolves the result through `basename()`. This applies to a name derived from the source **and** to a
name you pass explicitly with `usingFileName()` — there is no trusted filename path.

That ordering matters: `basename()` runs before the extension blocklist, so a name like
`"evil.php/x.jpg"` can't smuggle a nested storage key past it, and `..` can't reach the repository or
the disk.

## The extension blocklist checks every dot-segment

The default disallowed list — `php`, `phtml`, `phar`, `htaccess` — is tested against **each**
dot-separated segment of the filename, not just the final one. `evil.php.jpg` is rejected.

Set `allowedExtensions` to invert this into an allowlist, which is checked against the final
extension only.

## Size limits are enforced during accumulation

`maxFileSize` (10 MiB by default) is not a check performed after buffering. For stream and URL
sources, bytes are counted as they arrive and `FileTooLargeError` is thrown the moment the running
total exceeds the limit. A hostile stream can't force unbounded memory use before the check runs.

For URL sources there's an additional early exit: a `Content-Length` header that already declares more
than the limit is rejected before any body is read.

## URL ingestion has an allowlist, with a caveat

```ts
add({ url: 'https://cdn.partner.com/photo.jpg', allowedHosts: ['cdn.partner.com'] })
```

The allowlist is an exact, case-insensitive match on `host` **including port**, so `cdn.partner.com`
does not match `cdn.partner.com:8443` — it fails closed. Redirects are rejected outright
(`redirect: 'error'`), which is load-bearing: without it, a `302` to an internal address would defeat
the check entirely.

:::caution[This is not a complete SSRF defense]
The allowlist validates the hostname you were given. It cannot stop DNS rebinding, and it cannot help
if a host you explicitly allowlisted resolves to a private or internal IP. If the URLs come from
untrusted users, put a network-level egress proxy or policy in front of this rather than relying on
`allowedHosts` alone.
:::

## Storage is private by default

Disks default to `visibility: 'private'`, including the disk synthesized from environment variables
when you provide no storage config at all. A collection you never thought about is private.

`collection().public()` marks that collection's writes — original, conversions, and responsive
variants — with `{ visibility: 'public' }`, so the driver applies public ACLs at write time. It does
**not** change which URL method you call: `url()` versus `signedUrl()` remains a per-call decision.

## ZIP entry names are hardened

`customProperties.zipFilenamePrefix` is caller-controlled data, so it's sanitized before use —
leading slashes, backslashes, and `.`/`..` segments are stripped. Duplicate entry names within an
archive are de-duplicated rather than silently overwriting each other.

## If you replace a default, you own it

:::danger[Replacing `fileNameSanitizer` replaces its protections]
The traversal defense and the groundwork for the extension blocklist both live in the default
sanitizer. A permissive custom function that doesn't strip `/`, `\`, and `..` reopens exactly the
holes described above. Extend the default rather than starting from scratch, unless you're certain
what you're removing.
:::

The same reasoning applies to `disallowedExtensions` (replacing the array drops
`php`/`phtml`/`phar`/`htaccess` unless you re-list them) and to a custom `PathGenerator` (which
controls where caller-influenced filenames land on disk).

## Reporting a vulnerability

Please report privately rather than opening a public issue — see
[SECURITY.md](https://github.com/mujtabarumi/node-media-library/blob/main/SECURITY.md) for the
process.
