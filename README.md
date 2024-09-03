# Notes

A standalone, personal notes app with a block editor, nested pages, databases, backlinks, graph views, attachments, history, and light/dark themes. Notes stay in this browser's IndexedDB. When Jazz is configured, the same notebook syncs to Jazz Cloud for this local-first account.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:8870**. Keep using that exact address: browser storage belongs to an origin, so changing the hostname, protocol, or port opens a separate notebook.

Copy `.env.example` to `.env` to sync through Jazz. `VITE_JAZZ_APP_ID` and `VITE_JAZZ_SERVER_URL` are public. `JAZZ_ADMIN_SECRET` and `BACKEND_SECRET` stay on the machine that deploys the schema; they are not included in the browser bundle. The dev server publishes `src/jazz/schema.ts` when those values are set. Without them, the notebook stays on this browser only.

For a production build served locally:

```sh
npm run build
npm start
```

Stop the development server before starting the production server on the same port. Both use the same address and notebook storage.

## Docker

```sh
docker compose up --build -d
```

Open **http://127.0.0.1:8870**. To stop: `docker compose down`. The container serves static files; notes are stored in the browser, not the container. Use backups to move your notebook between browsers or machines.

## Data and backups

Notes, settings, page history, and attachments are stored in this browser's IndexedDB database. Data survives reloads and server restarts. Clearing site data, using a different browser profile, or losing access to the browser can remove your notebook. Private browsing may discard it when the session ends.

Use **Settings → Download backup** to export all records and attachments as JSON. Use **Settings → Restore backup…** to restore it. Restore replaces the current notebook after confirmation. Keep a backup before restoring or moving to another address. Backup files contain your notebook and attachments in readable form; store them appropriately.

This version is for personal use. It does not provide sharing, invitations, remote agents, or collaborative text merging. With Jazz configured, each browser has a local-first account and syncs only the rows that account created. Open tabs on the same origin refresh one another's changes; concurrent edits to the same field use the last committed write, and the newer sync clock wins across devices. Link cards do not request remote metadata. Embedded content and linked images may contact their respective providers when displayed.

## Development

```sh
npm run typecheck
npm test
npm run build
```

The included tests cover page trees, persistent records, concurrent field patches, binary attachment backups, and rejection of malformed restore data. The build output in `dist/` can be served from any static web server; use localhost or HTTPS so browser storage is available. The Vite development and preview commands bind only to loopback.

## Provenance and license status

Adapted from Terminus Notes, published by Terminus as `@terminus/notes`, version 0.0.1, retrieved through an existing fork. The original editor and UI code are retained with a new local persistence layer, local file storage, backup and restore, and standalone build scripts. This project is an independent adaptation and is not presented as the original author's work or an official release.

No license was included with the original source, and none has been added here. See `NOTICE` for attribution; third-party dependencies retain their own licenses.
