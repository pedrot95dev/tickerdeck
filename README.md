# Tickerdeck

Self-hosted charting site with unlimited watchlists. Stocks come from Tiingo (end of day),
crypto from Binance (daily). No logins; everyone on the network shares one set of data.

## Tiingo token

Stocks need a free [Tiingo](https://www.tiingo.com) API token. Crypto works without one.

```
cp .env.example .env
```

Put the token in `.env` as `TIINGO_API_TOKEN=...`. The file is gitignored; never commit it.

## Run locally

Needs Node 24.

```
npm install
npm run dev        # API on :8080, web app with hot reload on :5173
```

Production-style run:

```
npm run build
npm start          # everything on http://localhost:8080
```

`npm test` runs the tests of both workspaces.

| Variable | Default | Meaning |
|---|---|---|
| `TIINGO_API_TOKEN` | — | Tiingo token; optional at startup |
| `DATA_DIR` | `./data` | Folder holding `tickerdeck.db` |
| `PORT` | `8080` | HTTP port |

## Deploy

Needs Docker with Compose. Every push to `main` publishes the image `ghcr.io/pedrot95dev/tickerdeck:latest`
(Intel/AMD and ARM), so the host needs only `docker-compose.yml`, not the source. Put the Tiingo token in that file as the value
of `TIINGO_API_TOKEN` (on the host only, never in a commit), or keep it in a `.env` file next to it.

```
mkdir -p data
docker compose up -d
```

Open `http://<host>:8080`. Update with `docker compose pull && docker compose up -d`.

To run an image built from local source instead:
`docker build -t ghcr.io/pedrot95dev/tickerdeck:latest . && docker compose up -d`.

The container takes ownership of the `data` folder on start (uid 1000), then runs as that non-root user.

`docker compose ps` shows the container as `healthy` once the site answers. If it does not,
`docker compose logs` shows why.

## Back up

All state is the single file `data/tickerdeck.db`. Stop the container, copy the file, start again:

```
docker compose stop
cp data/tickerdeck.db /path/to/backup/
docker compose start
```

To restore, put the file back in `data/` while the container is stopped.
