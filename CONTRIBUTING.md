# Contributing to Mattermost ElizaOS Plugin

## Branching Strategy

Keep it simple - we use a basic two-branch workflow:

- **`main`** - Production-ready code, stable releases
- **`feature/*`** - New features and bug fixes

### Branch Naming
- Features: `feature/description-of-feature`
- Bug fixes: `feature/fix-description`  
- Experiments: `feature/experiment-name`

### Workflow
1. Create feature branch from `main`
2. Make your changes
3. Test your changes (run `npm test`)
4. Commit and push
5. Create PR to merge back to `main`

## Commit Messages

Use simple, descriptive commit messages:
```
feat: add user authentication
fix: resolve WebSocket connection issue
test: add integration tests for message handling
docs: update README installation steps
```

Optional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`

## Pull Requests

- Create PR from your feature branch to `main`
- Include description of what changed
- Link any related issues
- Ensure tests pass before requesting review

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Run tests: `npm test`
4. Build: `npm run build`

## Testing

- Run all tests: `npm test`
- Run integration tests: `npm run test:integration`
- Run e2e tests: `npm run test:e2e`

All tests should pass before submitting PR.

## Project Structure

```
src/
├── clients/          # REST and WebSocket clients
├── managers/         # Message and attachment managers  
├── services/         # Main MattermostService
├── config/           # Configuration management
└── types/            # TypeScript type definitions

__tests__/
├── unit/             # Unit tests
├── integration/      # Integration tests
└── e2e/              # End-to-end tests
```

## Releases

Simple release process:

1. Update version in `package.json`
2. Create git tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
3. Push tag: `git push origin v1.0.0`
4. Create GitHub release from tag with release notes

Use semantic versioning: `MAJOR.MINOR.PATCH`
- MAJOR: Breaking changes
- MINOR: New features
- PATCH: Bug fixes 