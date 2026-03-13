# ui-server

Persistent generative UI service for `ui.scty.org`.

## Requirements

- Node.js 22
- `UI_SERVER_TOKEN` in the environment for authenticated `PUT /widget/:slug`

## Run

```bash
npm install
npm start
```

The server listens on port `4200` and persists widgets to `/home/deploy/.ui-server/widgets.db`.
