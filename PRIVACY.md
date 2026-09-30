# Privacy

**Clean Full-Page Capture does not collect, transmit or sell any data.** It makes no network requests, contains no analytics and loads no remote code.

## What stays on your computer

| Data | Where | When it's removed |
|---|---|---|
| Settings (delay, PDF layout, folder name, …) | `chrome.storage.local` | Uninstall |
| Remembered capture area: a CSS selector keyed by site host (e.g. `app.example`) | `chrome.storage.local` | **Forget** in the popup, or uninstall |
| The last 5 captures, so the preview tab can show them | Extension IndexedDB | Overwritten by newer captures, or uninstall |
| PDF / PNG files you save | Your Downloads folder (or where you choose) | You delete them |

## Page access

The extension reads a page only when you ask it to: toolbar button, keyboard shortcut or **Pick area**. It then only works in the tab you invoked it on (`activeTab`).

During a capture it temporarily changes the page's styles and scroll position, and restores both afterwards. It doesn't read form data, cookies, credentials or network traffic.

## Sensitive dashboards

Captures contain whatever the page shows (names, figures, internal data). Treat the saved PDFs like any other export from that system, and follow your organisation's handling rules before sharing them.
