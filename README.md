# Flax Nuvio Plugin

This repository provides a Latino streaming provider for Nuvio, Flax, and other compatible apps.

## Use in Nuvio / Flax

To add this plugin to your Nuvio or Flax app:

1.  Open the **Nuvio** app.
2.  Go to **Settings** -> **Providers** -> **Add Repository URL**.
3.  Enter the URL of your hosted `manifest.json` (e.g., `https://your-github-username.github.io/Flax-plugin/manifest.json`).
4.  The **Flax** scraper should now appear in your list.

## Run locally (Stremio Addon)

```bash
npm start
```

Default local URLs:

```text
http://127.0.0.1:7010/manifest.json
http://127.0.0.1:7010/health
```

## Build the bundled provider

`flax` keeps its source files in `src/flax/` and bundles to `providers/flax.js` for Nuvio compatibility (transpiled for Hermes).

```bash
npm run build
```

To add another provider, create `src/<provider>/index.js` and `src/<provider>/provider.json`. The build will bundle `providers/<provider>.js` and regenerate `manifest.json` from every built provider's metadata.

## Main files

- `manifest.json`: repository manifest for Nuvio/Flax
- `providers/flax.js`: bundled provider for Nuvio
- `src/flax/`: provider source code
- `stremio-server.js`: addon server (for Stremio)
- `addon.config.json`: active provider list for the server
