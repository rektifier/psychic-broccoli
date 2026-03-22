# Contributing to Psychic Broccoli

Thanks for your interest in contributing! This document explains how to get started.

## Types of contributions

- **Bug fixes** - Found a bug? Open an issue first, then submit a PR with the fix.
- **Features** - Want to add something new? Open an issue to discuss the idea before writing code. This avoids wasted effort if the feature doesn't fit the project's direction.
- **Documentation** - Improvements to docs, README, or code comments are always welcome.
- **Bug reports** - Use the bug report issue template to report problems.

## Development setup

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://rustup.rs/) (stable)
- Platform-specific Tauri dependencies - see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Getting started

```bash
# Fork the repo on GitHub, then clone your fork
git clone https://github.com/rektifier/psychic-broccoli.git
cd psychic-broccoli

# Install frontend dependencies
pnpm install

# Run the app in development mode
pnpm tauri dev

# Run type checking
pnpm check
```

## Branching and pull requests

1. Fork the repository and clone your fork
2. Create a feature branch from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/my-feature
   ```
3. Make your changes
4. Run `pnpm check` to verify there are no type errors
5. Commit your changes using [Conventional Commits](#commit-messages)
6. Push your branch and open a PR **targeting the `develop` branch**

PRs should always target `develop`, not `main`. The `main` branch is reserved for releases.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must follow this format:

```
type: short description

Optional longer description
```

Common types:

| Type | When to use |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `chore` | Maintenance, dependencies, CI |
| `refactor` | Code changes that don't fix a bug or add a feature |

Examples:
- `feat: add support for multipart form requests`
- `fix: resolve variable substitution in chained requests`
- `docs: update README with environment file examples`
- `chore: update Tauri to v2.3`

## Code style

- Run `pnpm check` before submitting a PR to catch TypeScript and Svelte errors
- The frontend is Svelte 5 + TypeScript. Follow existing patterns in the codebase.
- The Rust backend is intentionally thin - most logic belongs on the frontend side.

## Reporting bugs

Use the [bug report template](https://github.com/rektifier/psychic-broccoli/issues/new?template=bug_report.yml) when filing bugs. Include steps to reproduce and your OS/version.

## Suggesting features

Open an issue using the [feature request template](https://github.com/rektifier/psychic-broccoli/issues/new?template=feature_request.yml) **before** starting work on a PR. This lets us discuss the approach and avoid duplicate effort.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
