# Ray Matthews Marketing Pipeline

Automated marketing pipeline for [Ray Matthews](https://raymatthews.com) fine art photography (Outer Banks, NC). Scores photos with multi-model AI, generates social media captions via Claude, and publishes to Facebook and Instagram — all through a browser-based dashboard.

## How It Works

1. **Score** — The pipeline evaluates candidate photos using three AI models: Gemini (composition), Claude (color and tonal quality), and OpenAI (artistic impact). A curator model ranks the top candidates.
2. **Select** — The highest-ranked photo becomes the current draft. You can also pick a specific photo from the full library.
3. **Caption** — Claude generates a social media caption using a customizable prompt template.
4. **Publish** — Post to Facebook and/or Instagram with one click.

Photos are classified into 13 theme categories (lighthouse, sunset-sunrise, beach-dunes, wildlife, etc.) and the pipeline avoids repeating recent themes.

## Architecture

Fully serverless on AWS:

```
CloudFront CDN
├── /                → S3 (static SPA frontend)
├── /api/*           → API Gateway → Lambda (api-handler)
├── /api/pipeline/*  → Lambda Function URL (pipeline-handler)
└── /photos/*        → S3 (ray-faa-images bucket)

DynamoDB
├── posts table      (GSI: status-createdAt-index)
└── config table

Cognito              → OAuth2 PKCE authentication
```

```
src/
├── config.ts                        # Environment variable config
├── data/
│   ├── types.ts                     # TypeScript interfaces
│   ├── dynamodb.ts                  # DynamoDB data layer
│   └── s3-resources.ts              # S3 resource/photo helpers
├── services/
│   ├── theme.service.ts             # 13-theme classifier via tag keywords
│   ├── photo-selector.service.ts    # Picks unused photo, avoids recent themes
│   ├── scoring.service.ts           # Multi-model AI photo scoring
│   ├── caption.service.ts           # Claude caption generation
│   ├── pipeline.service.ts          # Orchestrator (score → select → caption → publish)
│   ├── publish.service.ts           # Meta Graph API (Facebook + Instagram)
│   └── s3.service.ts                # Photo upload to S3
└── lambda/
    ├── api-handler.ts               # API Gateway Lambda (CRUD, config, photos)
    └── pipeline-handler.ts          # Function URL Lambda (scoring, long-running ops)

frontend/
├── index.html                       # SPA shell (Tailwind CDN)
└── app.js                           # Auth, routing, dashboard, interactions

infrastructure/
├── template.yaml                    # CloudFormation (full stack)
├── deploy.ps1                       # Full deploy from scratch
├── update-frontend.ps1              # Quick frontend-only deploy
├── update-lambda.ps1                # Quick Lambda-only deploy
├── upload-resources.ps1             # Push resource files to S3
├── seed-dynamodb.ps1                # One-time data migration
├── build-lambda.ps1                 # esbuild + zip
├── teardown.ps1                     # Stack deletion
└── _common.ps1                      # Shared PowerShell helpers
```

## Prerequisites

- **Node.js 22+**
- **AWS CLI v2** configured with credentials (`aws configure`)
- **PowerShell 7+** (for deploy scripts; Windows PowerShell 5.1 also works)
- A **Route 53 hosted zone** for your domain
- An existing **S3 bucket** with your photos (default: `ray-faa-images`)

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | Yes | AWS region (default: `us-east-1`) |
| `STACK_NAME` | Yes | CloudFormation stack name (default: `ray-marketing`) |
| `DOMAIN_NAME` | Yes | Your domain (default: `marketing.raymatthews.com`) |
| `HOSTED_ZONE_ID` | Yes | Route 53 hosted zone ID |
| `COGNITO_USER_EMAIL` | Yes | Email for the Cognito admin user |
| `PHOTOS_BUCKET` | Yes | Existing S3 bucket with photos (default: `ray-faa-images`) |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `OPENAI_API_KEY` | Yes | OpenAI API key (photo scoring) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key (photo scoring) |
| `META_PAGE_ACCESS_TOKEN` | For publishing | Meta Graph API page access token |
| `FACEBOOK_PAGE_ID` | For publishing | Facebook page ID |
| `INSTAGRAM_USER_ID` | For publishing | Instagram business account ID |

See [docs/meta-setup.md](docs/meta-setup.md) for detailed Meta/Facebook/Instagram setup instructions.

### 3. Deploy

```powershell
.\infrastructure\deploy.ps1
```

This will:
1. Build and zip Lambda functions
2. Create/update the CloudFormation stack (Cognito, DynamoDB, S3, Lambda, API Gateway, CloudFront, ACM certificate, Route 53 records)
3. Upload Lambda code and frontend files
4. Create a Cognito user (first deploy only — check your email for the temporary password)
5. Invalidate CloudFront cache

The ACM certificate validation can take 5–30 minutes on first deploy. CloudFormation waits for it automatically.

### 4. Upload resources (first deploy)

```powershell
.\infrastructure\upload-resources.ps1
```

Uploads `resources/descriptions.json`, `resources/upload-progress.json`, and `resources/caption-prompt.md` to the resources S3 bucket.

### 5. Seed data (optional, one-time migration)

If you have existing data in `data/posts.json` from the old local version:

```powershell
.\infrastructure\seed-dynamodb.ps1
```

This migrates posts to DynamoDB, mapping old statuses (`pending`/`approved`/`rejected`) to new ones (`discarded`/`posted`). The script refuses to run if the table already has data — use `-Force` to overwrite.

### 6. Open the dashboard

Navigate to `https://your-domain.com/`. Sign in with the email and temporary password from step 3. You'll be prompted to set a permanent password on first login.

## Updating

### Frontend changes only

```powershell
.\infrastructure\update-frontend.ps1
```

Regenerates `config.js`, syncs frontend files to S3, and invalidates CloudFront.

### Lambda/backend changes only

```powershell
.\infrastructure\update-lambda.ps1
```

Rebuilds, zips, and deploys both Lambda functions.

### Full redeploy

```powershell
.\infrastructure\deploy.ps1
```

Safe to re-run — uses `--no-fail-on-empty-changeset`.

## Building

```bash
npm run build          # Build Lambda bundles (esbuild)
```

Output: `dist/api-handler.js` and `dist/pipeline-handler.js`.

The build uses esbuild with CommonJS format targeting Node 22. AWS SDK packages are marked as external (provided by the Lambda runtime). Sharp is bundled — the build script installs the Linux-specific binary before building.

## Teardown

```powershell
.\infrastructure\teardown.ps1
```

Empties the frontend and resources buckets, then deletes the CloudFormation stack. **Your photos bucket is never touched.** The stack's CloudFront access policy on the photos bucket will be removed.

## Resource Files

These read-only files in `resources/` drive the pipeline:

| File | Purpose |
|------|---------|
| `descriptions.json` | Photo metadata (title, description, tags) keyed by filename |
| `upload-progress.json` | Upload records with Fine Art America URLs |
| `caption-prompt.md` | System prompt template for Claude caption generation |

Photo candidates are derived by intersecting photos that have both a description and an upload record with a Fine Art America URL.

## Environment Variables Reference

### Deployment (used by PowerShell scripts)

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | `us-east-1` | AWS region for all resources |
| `STACK_NAME` | `ray-marketing` | CloudFormation stack name |
| `DOMAIN_NAME` | `marketing.raymatthews.com` | Custom domain for CloudFront |
| `HOSTED_ZONE_ID` | — | Route 53 hosted zone ID |
| `COGNITO_USER_EMAIL` | — | Admin user email |
| `PHOTOS_BUCKET` | `ray-faa-images` | Existing S3 bucket with source photos |
| `RESOURCES_BUCKET` | auto-generated | S3 bucket for resource files (leave blank) |

### Lambda Runtime (passed via CloudFormation parameters)

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Claude API key for captions |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Claude model ID |
| `OPENAI_API_KEY` | — | OpenAI API key for artistic impact scoring |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model ID |
| `GEMINI_API_KEY` | — | Gemini API key for composition scoring |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model ID |
| `META_PAGE_ACCESS_TOKEN` | — | Meta Graph API page access token |
| `FACEBOOK_PAGE_ID` | — | Facebook page ID |
| `INSTAGRAM_USER_ID` | — | Instagram business account ID |
| `META_API_VERSION` | `v21.0` | Meta Graph API version |
| `THEME_LOOKBACK` | `2` | Number of recent themes to avoid repeating |

## API Endpoints

All endpoints require Cognito authentication (JWT Bearer token).

### API Lambda (via API Gateway)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/posts?status=` | List posts, optionally filtered by status |
| `GET` | `/api/posts/current` | Get the current draft |
| `GET` | `/api/posts/:id` | Get a single post |
| `DELETE` | `/api/posts/:id` | Discard a post |
| `POST` | `/api/posts/:id/select-photo` | Select a scored photo candidate |
| `POST` | `/api/posts/:id/generate-caption` | Generate a caption for the draft |
| `PUT` | `/api/posts/:id/caption` | Edit the caption |
| `POST` | `/api/posts/:id/post` | Publish to Facebook/Instagram |
| `GET` | `/api/photos` | List all photo candidates |
| `GET` | `/api/config` | Get app config |

### Pipeline Lambda (via Function URL, requires JWT)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/pipeline/run` | Score photos and create a new draft |
| `POST` | `/api/pipeline/pick` | Create a draft from a specific photo |
