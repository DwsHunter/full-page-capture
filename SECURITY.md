# Security Policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please report privately, **not** in a public issue:

- **GitHub:** Security tab → *Report a vulnerability* (private vulnerability reporting).
- **GitLab:** open a new issue and tick **"This issue is confidential"**.

Include the extension version, the browser version, and steps to reproduce. Redact hostnames, IPs and any sensitive data from screenshots. You should get an acknowledgement within 7 days.

## Scope

In scope:
- anything that makes the extension send data off the machine;
- access to tabs or sites beyond the one the user explicitly invoked it on;
- script injection into pages, or into the extension's own pages (popup, preview);
- crafted PDF or file-name output (e.g. path traversal in download names).

Out of scope: content a user deliberately captures and shares, and vulnerabilities in the browser itself.

## Security design

- **Permissions:** `activeTab`, `scripting`, `storage` and `downloads` only. There are no host permissions and no persistent access to sites.
- **Local only:**
  - no network requests, no remote code (Manifest V3), no analytics;
  - no `eval` / `new Function`, enforced by `npm run check`.
- **Local storage:** captures stay in the extension's local IndexedDB (last 5) until they're overwritten or the extension is uninstalled.
- **Download names:** file names are sanitised (path separators and reserved characters removed) before they reach `chrome.downloads`.
- **Minimal PDF metadata:** generated PDFs contain only the image, a title and a creation date.
