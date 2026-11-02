# Contribution guidelines

First off, thank you for considering contributing to NuwaClaw.

If your contribution is not straightforward, please first discuss the change you
wish to make by creating a new issue before making the change.

## Reporting issues

Before reporting an issue on the
[issue tracker](https://github.com/nuwax-ai/nuwaclaw/issues),
please check that it has not already been reported by searching for some related
keywords.

## Pull requests

Try to do one pull request per change.

## Commit Message Format

This project adheres to [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
A specification for adding human and machine readable meaning to commit messages.

### Commit Message Header

```
<type>(<scope>): <short summary>
  │       │             │
  │       │             └─⫸ Summary in present tense. Not capitalized. No period at the end.
  │       │
  │       └─⫸ Commit Scope
  │
  └─⫸ Commit Type: feat|fix|build|ci|docs|perf|refactor|test|chore
```

#### Type

| feat     | Features                 | A new feature                                                                                          |
|----------|--------------------------|--------------------------------------------------------------------------------------------------------|
| fix      | Bug Fixes                | A bug fix                                                                                              |
| docs     | Documentation            | Documentation only changes                                                                             |
| style    | Styles                   | Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc) |
| refactor | Code Refactoring         | A code change that neither fixes a bug nor adds a feature                                              |
| perf     | Performance Improvements | A code change that improves performance                                                                |
| test     | Tests                    | Adding missing tests or correcting existing tests                                                      |
| build    | Builds                   | Changes that affect the build system or external dependencies (example scopes: main, serde)            |
| ci       | Continuous Integrations  | Changes to our CI configuration files and scripts (example scopes: Github Actions)                     |
| chore    | Chores                   | Other changes that don't modify src or test files                                                      |
| revert   | Reverts                  | Reverts a previous commit                                                                              |

## Developing

### Set up

All client code, shared packages, build tools, and release workflows are maintained in this repository. Clone it normally and work from its root; no base checkout or submodule initialization is needed.

```shell
git clone https://github.com/nuwax-ai/nuwaclaw.git
cd nuwaclaw
pnpm run build:agent-kit
pnpm install --filter @nuwax-ai/nuwaclaw...
make electron-dev
```

### Useful Commands

- Prepare dependencies and binaries:

  ```shell
  make electron-prepare
  ```

- Run in development mode:

  ```shell
  make electron-dev
  ```

- Build for distribution:

  ```shell
  make electron-bundle-unsigned
  ```

- Prepare test resources and run the CI test suite (real OS sandbox tests excluded):

  ```shell
  pnpm -C crates/agent-electron-client prepare:mcp-proxy
  pnpm -C crates/agent-electron-client exec vitest run --exclude 'tests/sandbox-integration/**' --exclude '**/node_modules/**'
  pnpm run test:electron:scripts
  pnpm -C crates/agent-electron-client check:boundaries
  ```

- Build the main and renderer processes: `pnpm -C crates/agent-electron-client build`.
- Keep commits scoped to the change and preserve community product defaults. See [MODULES.md](MODULES.md) for module boundaries and [docs/source-import.md](docs/source-import.md) for the migration source.
