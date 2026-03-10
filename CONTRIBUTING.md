# Contributing

Thanks for contributing to SidebarClaw.

## Development Basics

- Use Python 3.11 or newer
- Keep extension changes inside `extension/`
- Keep adapter and fallback logic inside `src/longdoc/`
- Avoid committing local session data, tokens, or machine-specific configuration

## Before Opening a Pull Request

Run:

```bash
python3 -m compileall src
node --check extension/background.js
node --check extension/options.js
node --check extension/sidepanel.js
```

## Pull Request Guidelines

- keep changes focused
- document user-facing changes in `README.md`
- avoid committing generated local data such as `.gateway_data/`
- do not include personal gateway URLs, tokens, or machine-specific paths
