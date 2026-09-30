# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-09-30

### Added
- Full-page capture of the page content only.
  - Scrolls the real scroll container, whether that's the window or an inner scroller.
  - Stitches strips by absolute row position, so nothing is duplicated.
- Automatic target detection: saved area → known app layout → `<main>` / `role="main"` → largest scrolling container → whole page.
- Overlay handling: fixed headers, side navs, toolbars and bottom bars are hidden during capture, sticky rows are un-stuck, and everything is restored afterwards (including scroll position).
- Lazy content support:
  - pre-scroll so lazily loaded charts and panels render;
  - waits for `aria-busy`, `data-render-complete` and common spinners;
  - markers that never clear are skipped after one timeout.
- **Pick area** mode: `↑`/`↓` to resize the selection, remembered per site.
- Preview tab with automatic PDF save:
  - one continuous page, or A4 portrait/landscape with page breaks placed in blank gaps;
  - lossless (Flate) or JPEG images;
  - Unicode titles.
- Save PNG and Copy image from the preview.
- Keyboard shortcuts: `Alt+Shift+S` (capture) and `Alt+Shift+A` (pick area); `Esc` cancels.
- Correct stitching at fractional display scaling (125 %, 150 %) and browser zoom.
- PDF metadata limited to title and creation date: no producer or tool branding.
- End-to-end test suite (pixel-level verification at 100/125/150/200 %), static checks, and CI for GitHub Actions and GitLab CI with release packaging and SHA-256 checksums.

[Unreleased]: ../../compare/v1.0.0...HEAD
[1.0.0]: ../../tree/v1.0.0
