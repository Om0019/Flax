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

`webstreamer-latino` still has source files in `src/webstreamer-latino/` and bundles to `providers/webstreamer-latino.js` for Nuvio compatibility (transpiled for Hermes).

```bash
npm run build
```

## Main files

- `manifest.json`: repository manifest for Nuvio/Flax
- `providers/webstreamer-latino.js`: bundled provider for Nuvio
- `src/webstreamer-latino/`: provider source code
- `stremio-server.js`: addon server (for Stremio)
- `addon.config.json`: active provider list for the server
