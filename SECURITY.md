# Security Policy

## Supported versions

This project has not yet had a stable release. Until `1.0.0` is published, only the latest commit on
`main` receives security fixes.

| Version          | Supported |
| ---------------- | --------- |
| `main`           | Yes       |
| Pre-release tags | No        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately through either channel:

- [GitHub private vulnerability reporting](https://github.com/mujtabarumi/node-media-library/security/advisories/new) (preferred)
- Email **rumi@wpdeveloper.com** with `node-media-library security` in the subject line

Please include, as far as you're able:

- The affected package and version or commit SHA
- A description of the vulnerability and its impact
- Steps to reproduce, ideally a minimal configuration and a failing test
- Any known mitigation or workaround

You can expect an acknowledgement within **7 days** and an assessment with a remediation plan within
**30 days**. We'll keep you updated as a fix progresses and will credit you in the release notes unless
you'd rather stay anonymous. Please give us a reasonable window to ship a fix before disclosing publicly.

## Scope

This library ingests untrusted files, writes them to configurable storage backends, shells out to system
binaries, and generates URLs. Findings in these areas are especially in scope:

- **Filename and path handling** — traversal or storage-key injection past the filename sanitizer or the
  disallowed-extension blocklist; zip-slip in the ZIP download path
- **MIME detection** — a way to make the pipeline trust a client-supplied `Content-Type` or extension
  instead of sniffed magic bytes, or to defeat generator dispatch
- **Resource exhaustion** — bypassing `maxFileSize` enforcement during stream/URL accumulation
- **URL ingestion** — defeating the `allowedHosts` allowlist (note the documented caveats below)
- **Storage visibility** — a path that writes a file publicly when the collection and disk are private
- **Signed URLs** — forging or extending a signed URL's validity
- **Subprocess invocation** — argument or command injection in the `pdftoppm`, `ffmpeg`, `jpegoptim`, or
  `pngquant` call paths

The current security posture, including its deliberate limitations, is documented in
[`packages/core/README.md` → Security model](packages/core/README.md#security-model). Two limitations are
already known and documented rather than being vulnerabilities:

- `allowedHosts` matches the hostname as given. It does not defend against DNS rebinding, nor against an
  allowlisted hostname that resolves to a private or internal address. Put a network-level egress policy
  in front of URL ingestion from untrusted input.
- Replacing `limits.fileNameSanitizer` with your own function replaces the traversal and blocklist
  protection it provides. Extend the default rather than starting from scratch.

## Out of scope

- Vulnerabilities in dependencies with no exploitable path through this library's own API (report those
  upstream; do tell us if we should pin or patch)
- Misconfiguration by the consuming application — for example marking a collection `public()` and then
  being surprised its files are publicly readable
- Attacks that require an already-compromised host, or control over the application's own configuration
  module
- Missing hardening in the system binaries themselves (`pdftoppm`, `ffmpeg`, `jpegoptim`, `pngquant`)
