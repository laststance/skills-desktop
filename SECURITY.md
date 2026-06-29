# Security Policy

## Supported Versions

Security fixes are provided for the latest released version of Skills Desktop.
Please update to the newest release before reporting a suspected vulnerability
unless the issue only affects the current development branch.

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.
Use GitHub's private vulnerability reporting flow for this repository when it is
available. If private reporting is unavailable, contact the maintainer through
the Laststance.io GitHub organization and include a short note that the report
is security-sensitive.

Include:

- affected Skills Desktop version or commit
- macOS version and architecture
- reproduction steps or proof of concept
- expected impact
- whether the issue requires local filesystem access, a malicious skill, a
  malicious marketplace listing, or a compromised update channel

## Response Targets

- Initial acknowledgement: within 7 days
- Triage update: within 14 days when reproduction details are sufficient
- Coordinated disclosure: after a fix is available, or earlier if public risk
  requires it

These are targets, not guarantees, because this is an open-source project with
limited maintainer capacity.

## Scope

In scope:

- Electron main/preload/renderer privilege boundary issues
- IPC validation bypasses
- unintended filesystem access outside configured skills directories
- unsafe external link, webview, or marketplace preview behavior
- update, signing, notarization, or release artifact integrity issues
- CI/CD, dependency, and GitHub Actions supply-chain risks

Out of scope:

- issues requiring arbitrary local code execution before launching the app
- denial of service from intentionally corrupt local development checkouts
- social engineering against maintainers or users
- vulnerabilities in third-party services that are not controlled by this repo

## Security Posture

Skills Desktop is an Electron app that manages local skills directories. The app
keeps renderer filesystem access behind preload IPC, runs BrowserWindows with
sandboxing and context isolation, disables Node.js integration in renderers,
validates IPC arguments in the main process, validates filesystem paths against
allowed skills locations, restricts external links to http(s), and notarizes
macOS release builds with the hardened runtime enabled.

GitHub security automation is tracked in issue #241 and includes CodeQL,
dependency review, production dependency audit, secret scanning, Dependabot
security updates, least-privilege GitHub Actions permissions, and branch
protection.
