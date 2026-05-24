# fzfetch

[中文说明](./README_zh.md)

The web version of fzf. A high-performance fuzzy search tool for local files.

When you need to find a file, you usually do not want to wait, stand up extra services, or remember a pile of commands. `fzfetch` keeps the goal simple: start fast, search faster.

## Screenshot

![fzfetch UI screenshot](./screenshot.jpg)

## Quick Start

### Run With Docker

```bash
docker run --rm -p 3000:3000 \
  -e FZFETCH_SEARCH_DIR=/files \
  -e FZFETCH_DATA_DIR=/data \
  -v "$(pwd)/files:/files" \
  -v fzfetch-data:/data \
  ghcr.io/zhpjy/fzfetch:latest
```

Or:

```bash
docker compose up -d
```

### Run Locally

Build the embedded frontend assets before compiling the backend:

```bash
npm --prefix frontend install
npm --prefix frontend run build
cargo run
```

For frontend development, you can also run the Vite dev server after installing dependencies:

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

By default, `fzfetch` uses:

- `./files` as the search directory
- `./data` as the application data directory
- `./data/cache.txt` as the cache file

If these directories do not exist, `fzfetch` creates them automatically.

Release binaries serve the embedded frontend and do not require a separate `frontend/dist` directory.

## Local Development

Common commands:

```bash
# Backend
cargo run
cargo test

# Frontend
npm --prefix frontend install
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend test
```

The backend listens on `0.0.0.0:3000` by default.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `FZFETCH_CONFIG` | unset | Optional path to a TOML config file |
| `FZFETCH_SEARCH_DIR` | `files` | Search directory to index |
| `FZFETCH_DATA_DIR` | `data` | Application state directory that stores the cache file |
| `FZFETCH_EXCLUDE_DIRS` | empty | Comma-separated relative directory list to exclude from indexing |
| `FZFETCH_REFRESH_TTL_SECS` | `86400` | Cache expiration in seconds; the next search after expiry triggers a background refresh |
| `FZFETCH_IDLE_TTL_SECS` | `1800` | Idle lifetime in seconds before the in-memory index is unloaded |
| `FZFETCH_CLEANUP_INTERVAL_SECS` | `60` | Cleanup loop interval in seconds |
| `FZFETCH_TOP_K` | `100` | Maximum number of results returned per search |
| `FZFETCH_NUCLEO_THREADS` | `4` | Number of `nucleo` matcher threads used to bound search worker memory growth |

Notes:

- Use `fzfetch.example.toml` as a starting point for a local `fzfetch.toml`
- When `FZFETCH_CONFIG` is unset, `fzfetch` optionally tries `./fzfetch.toml`, ignores it if absent, and fails startup if the file exists but is invalid
- When `FZFETCH_CONFIG` is set, the specified file must be readable and valid TOML, or startup fails
- `FZFETCH_*` environment variables override values from the config file
- The cache file path is always `FZFETCH_DATA_DIR/cache.txt`
- The local default is `data/cache.txt`
- The container default is `/data/cache.txt`
- Every entry in `FZFETCH_EXCLUDE_DIRS` is resolved relative to `FZFETCH_SEARCH_DIR`, for example `tmp,cache/private`
- Excluded directories and all of their descendants are skipped during indexing

## More Information

- [docs/backend.md](./docs/backend.md)
