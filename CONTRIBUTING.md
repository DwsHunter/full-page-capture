# Contributing

Thanks for helping. Keep changes small and focused, and keep the extension dependency-free.

## Setup

```bash
npm ci
npm run check
npm test          # headless Chromium, Linux x64 (WSL works); elsewhere set CHROME_PATH
```

Load `extension/` unpacked in `chrome://extensions` (Developer mode) to try changes in a real browser. Click the reload ↻ icon after each edit.

## Ground rules

- **No real data anywhere.** Code, tests, fixtures, screenshots and issues must not contain real IPs, hostnames, usernames, tokens or customer data.
  - For example IPs, use the documentation ranges `192.0.2.0/24`, `198.51.100.0/24` and `203.0.113.0/24`, and use `*.example` for hostnames.
  - `npm run check` fails on anything else.
- **No remote code, no network calls, no analytics** in the extension. MV3 forbids remote code, and users rely on the extension being local-only.
- **No new permissions** without a clear need, explained in the PR and in `PRIVACY.md`.
- **Pixel logic changes need tests.** If you touch `content.js` (scroll loop, target geometry) or `stitch.js`, run the full `npm test`. Add a fixture page if you are fixing a site-specific layout.

## Pull / merge requests

- Describe the page layout that failed (anonymised) and how you verified the fix.
- Update `CHANGELOG.md` under **Unreleased** for user-visible changes.
- CI must be green on the platform you are submitting to (GitHub Actions or GitLab CI).

## Releases (maintainers)

See [README → Releasing](README.md#releasing) and [docs/PUBLISHING.md](docs/PUBLISHING.md).
