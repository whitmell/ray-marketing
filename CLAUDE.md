# Ray Matthews Marketing Pipeline

Automated marketing pipeline for Ray Matthews fine art photography (Outer Banks, NC). Generates social media captions via Claude AI, presents them in a dashboard for approval, and runs on a configurable weekly schedule.

## Build & Run

```bash
npm run build        # TypeScript compile + copy EJS views to dist/
npm run dev          # Watch mode (tsx watch src/index.ts)
npm start            # Run compiled dist/index.js
```

Docker:
```bash
docker-compose up --build
```

## Environment Variables

Required: `ANTHROPIC_API_KEY`

Optional (with defaults):
- `CLAUDE_MODEL` → `claude-sonnet-4-20250514`
- `PORT` → `3000`
- `PIPELINE_CRON` → `0 9 * * 1` (Monday 9AM)
- `TIMEZONE` → `America/New_York`
- `RESOURCES_PATH` → `./resources`
- `DATA_PATH` → `./data`
- `THEME_LOOKBACK` → `2`

Copy `.env.example` to `.env` and fill in values.

## Architecture

```
src/
├── index.ts                     # Entry: loads candidates, starts server + scheduler
├── config.ts                    # Centralized env var config
├── data/
│   ├── types.ts                 # Interfaces: Post, PhotoCandidate, ThemeCategory, etc.
│   └── store.ts                 # JSON file persistence (atomic writes via .tmp + rename)
├── services/
│   ├── theme.service.ts         # Classifies photos into 13 themes via tag keyword matching
│   ├── photo-selector.service.ts # Picks unused photo, excludes recent themes
│   ├── caption.service.ts       # Claude API call using caption-prompt.md as system prompt
│   └── pipeline.service.ts      # Orchestrator + post CRUD (select → generate → save)
├── scheduler/
│   └── cron.ts                  # node-cron start/stop/restart
└── server/
    ├── app.ts                   # Express setup + route registration
    ├── routes/
    │   ├── posts.ts             # HTML pages (dashboard, post detail)
    │   ├── api.posts.ts         # POST approve/reject/regenerate
    │   ├── api.pipeline.ts      # POST /api/pipeline/run (manual trigger)
    │   └── api.config.ts        # GET/PUT schedule config
    └── views/                   # EJS templates + Tailwind CDN
```

## Data Storage

**No database.** All state is JSON files:
- `data/posts.json` — array of Post objects (pending/approved/rejected)
- `data/config.json` — runtime config (cron schedule, timezone, lookback)
- `resources/` — read-only source data (descriptions.json, upload-progress.json, caption-prompt.md)

Photo candidates are derived at startup by intersecting `descriptions.json` ∩ `upload-progress.json` (must have `faaUrl`). Cached in memory; restart to pick up resource changes.

## Key Concepts

**Theme classification:** 13 categories (`lighthouse`, `sunset-sunrise`, `beach-dunes`, `wildlife`, `ocean-waves`, `winter-weather`, `marsh-wetland`, `aerial`, `pier-dock`, `night-sky`, `architecture`, `forest-trees`, `general`). Tags scored against keyword lists; ties broken by specificity priority.

**Photo selection:** Random from unused pool, excluding themes of last N posts (`THEME_LOOKBACK`). Relaxes constraints progressively if pool is too narrow.

**"Used" photo:** Appears in `posts.json` with status `pending` or `approved`. Rejected posts free the photo for reuse.

## API Endpoints

```
GET  /                              Dashboard HTML (?status=pending|approved|rejected)
GET  /posts/:id                     Post detail HTML
POST /api/posts/:id/approve         Approve pending post
POST /api/posts/:id/reject          Reject pending post
POST /api/posts/:id/regenerate      New caption for same photo (rejects old)
POST /api/pipeline/run              Manual pipeline trigger
GET  /api/config                    Current config
PUT  /api/config/schedule           Update cron (body: { pipelineCron })
```

## Coding Conventions

- **TypeScript strict mode**, no `any` types
- **camelCase** functions/variables, **PascalCase** types/interfaces, **UPPER_CASE** constants
- Services are functional (exported functions, not classes)
- Router factories return `Router` instances
- Lazy initialization for API client and prompt template
- Atomic JSON writes (write `.tmp`, then `fs.rename`)
- Console logging with prefixes: `[Init]`, `[Server]`, `[Pipeline]`, `[Scheduler]`, `[API]`
- EJS views use header/footer partials pattern (no layout engine)
- Frontend interactions via vanilla `fetch()` calls in inline `<script>` (no framework)

## Docker

Multi-stage build: Node 22 Alpine. Volumes: `./resources` (read-only), `./data` (persistent). EJS views copied separately since tsc doesn't process them.
