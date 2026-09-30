# Publishing to GitHub and GitLab

Step-by-step guide: first push to both hosts, recommended settings, and cutting a release.

## 0. Before the first push

- `LICENSE` names the copyright holder as **BB**. Change it if you want your full name or an organisation.
- Optional local check. Needs Node 20+; the end-to-end tests need Linux or WSL, and CI runs them anyway:
  ```bash
  npm ci && npm run check && npm test
  ```
- Pick the repository visibility (public or private). CI works on both. Private repositories use your CI-minutes quota.

## 1. Create two empty repositories

**GitHub:** **+** → *New repository*

- Name: `clean-full-page-capture`
- Leave **Add a README**, **.gitignore** and **license** *unticked*. The repo already has them, and an initialised remote would reject the first push.

**GitLab:** *New project* → *Create blank project*

- Name: `clean-full-page-capture`
- *Untick* **Initialize repository with a README**.

## 2. First push: one local repo, two remotes

Replace `<you>` with your GitHub username and your GitLab username or group.

```bash
cd clean-full-page-capture
git init -b main
git add .
git commit -m "Clean Full-Page Capture v1.0.0"

git remote add github git@github.com:<you>/clean-full-page-capture.git
git remote add gitlab git@gitlab.com:<you>/clean-full-page-capture.git

git push -u github main
git push -u gitlab main
```

HTTPS instead of SSH: use `https://github.com/<you>/clean-full-page-capture.git` and `https://gitlab.com/<you>/clean-full-page-capture.git`. Git will ask for a personal access token, not your password.

**Optional: push to both with one command.** Configure a single `origin` with two push URLs. The first `--add --push` replaces the default push URL, which is why GitHub is added again:

```bash
git remote add origin git@github.com:<you>/clean-full-page-capture.git
git remote set-url --add --push origin git@github.com:<you>/clean-full-page-capture.git
git remote set-url --add --push origin git@gitlab.com:<you>/clean-full-page-capture.git
git push -u origin main          # pushes to GitHub and GitLab
git remote -v                    # verify: 1 fetch URL, 2 push URLs
```

On Windows, `.gitattributes` keeps line endings consistent. No `core.autocrlf` tweaks are needed.

## 3. Check CI is green

| Host | Where | Expect |
|---|---|---|
| GitHub | *Actions* tab → **CI** | Job **Check, test, package** ✔ (static checks, 29 end-to-end tests, zip build) |
| GitLab | *Build → Pipelines* | **test** ✔ and **package** ✔ |

The first GitLab run takes longer while it pulls the Playwright image (a few GB). If a test fails, the captured images are attached to the failed job as artifacts:

- **GitHub:** `test-output`
- **GitLab:** `tests/output/`

## 4. Recommended repository settings

**GitHub**

- *Settings → Code security → Private vulnerability reporting* → **Enable**. `SECURITY.md` tells reporters to use it.
- *Settings → Code security* → enable **Dependabot alerts** (`.github/dependabot.yml` already schedules weekly update PRs).
- *Settings → Rules → Rulesets* → new branch ruleset for `main`:
  - require a pull request;
  - require the status check **Check, test, package**;
  - block force pushes.
- *About* (gear icon on the repo page):
  - add a description;
  - add topics: `chrome-extension`, `browser-extension`, `screenshot`, `pdf`, `full-page-screenshot`, `web-extension`.

**GitLab**

- *Settings → Repository → Protected branches:* protect `main` (allowed to push: Maintainers).
- *Settings → Repository → Protected tags:* protect `v*` (allowed to create: Maintainers).
- *Settings → General → Visibility → Package registry* must stay **on**. Release zips are stored there.
- *Settings → General → Merge requests:* tick **Pipelines must succeed**.
- Self-managed GitLab only: the pipeline needs a runner with the Docker executor. gitlab.com's shared runners work as-is.

## 5. Cut a release

```bash
# 1. bump the version in BOTH files (must match), update CHANGELOG.md
#    extension/manifest.json  "version": "1.0.1"
#    package.json             "version": "1.0.1"
npm run check                          # fails if the two versions differ

git commit -am "Release v1.0.1"
git tag -a v1.0.1 -m "v1.0.1"
git push github main --follow-tags
git push gitlab main --follow-tags     # or: git push origin main --follow-tags
```

To publish the current version right away:

```bash
git tag -a v1.0.0 -m "v1.0.0"
git push github v1.0.0
git push gitlab v1.0.0
```

The tag pipeline builds `clean-full-page-capture-vX.Y.Z.zip` and `SHA256SUMS.txt`:

- **GitHub:** a GitHub Release, with notes generated from the commits.
- **GitLab:** files uploaded to *Deploy → Package registry*, plus a Release under *Deploy → Releases* that links to them.

Both pipelines refuse a tag that doesn't match the manifest version.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `! [rejected] main -> main (fetch first)` on first push | The remote was created with a README. Recreate it empty, or run `git pull <remote> main --allow-unrelated-histories` once. |
| GitHub release job: *Tag vX does not match manifest* | Bump `extension/manifest.json` and `package.json`, delete and recreate the tag. |
| GitLab `package` job: `403` on upload | The package registry is disabled for the project, or the project is a fork without registry access. |
| GitLab `release` job skipped | It runs only for tags of the form `vX.Y.Z`. |
| Deleting a wrong tag | `git tag -d vX.Y.Z` locally, then `git push github :refs/tags/vX.Y.Z` and `git push gitlab :refs/tags/vX.Y.Z` |
