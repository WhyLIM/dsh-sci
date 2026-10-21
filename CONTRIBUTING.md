# Contributing

## Requirements

- Node.js >= 22 and npm
- No runtime npm dependencies; tools use Node built-ins and native `fetch`
- macOS is currently the primary development platform; Linux should work for the CLI

## Development

```bash
npm test
DSH_SCI_LIVE_TESTS=1 npm run test:live
npm run deps
```

`npm test` runs `node:test` without network access. Live API smoke tests are manual and should not be added to CI without mocking.

## Install into DSH

```text
plugin_manager action=install_bundle target=/absolute/path/to/dsh-sci
```

After changing the Client bundle, refresh the DSH settings page or restart DSH.

## Data safety

The plugin writes user data outside this repository (`~/.dsh/sci` by default), including notes, PDFs, figures and API caches. Never commit:

- `sci.config.json` / `sci.secrets.json`
- API keys, cookies or account tokens
- downloaded papers/PDFs or user notes
- `.tmp/` scratch files

## Pull requests

- Keep the CLI dependency-free.
- Add or update a `node:test` case for behavior changes.
- Preserve the evidence/safety rules in `templates/AGENTS.md`.
- Do not bypass paywalls, controlled-access databases, or provider rate limits.
