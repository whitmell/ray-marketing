# AWS Serverless Migration — Design Document

## Intent

Migrate the Ray Matthews Marketing Pipeline from a local Docker/Express/JSON-file application to a fully serverless AWS architecture with a simplified, human-driven workflow. The goal is the cheapest possible hosting for a low-traffic, single-user content creation tool.

### Why Now

The application runs only on Whit's local machine via Docker. Moving to AWS makes it accessible from anywhere, eliminates the need to keep Docker Desktop running, and enables one-click publishing to Facebook/Instagram from any device.

## Goals

1. **Cost-effective** — target well under $1/month at current usage (a few runs per week, single user)
2. **Accessible anywhere** — hosted at `marketing.raymatthews.com` (configurable via `.env`)
3. **DynamoDB storage** — replace JSON file persistence with DynamoDB, seeded from existing `data/posts.json`
4. **Cognito authentication** — dashboard is protected behind login, not publicly accessible
5. **Streamlined workflow** — score photos first, then choose, then caption, then post (see Workflow section)
6. **PowerShell deployment** — scripts that read from `.env` and deploy/update the stack
7. **Keep the human in the loop** — no automated cron; every step is manual

## Non-Goals

- Automated scheduled pipeline runs (the cron scheduler is removed)
- Multi-user support (Cognito is configured for a single user)
- CI/CD pipeline (deploy is manual via PowerShell)
- Migrating the photo scoring service to separate Lambda functions (it stays monolithic for simplicity)
- Migrating AI scoring to AWS Bedrock (direct API calls to Claude, OpenAI, and Gemini are kept as-is)

## Anti-Goals

- Over-engineering: no CDK, no SAM, no Terraform. Plain CloudFormation templates deployed via AWS CLI.
- Unnecessary new infrastructure: the existing `ray-faa-images` S3 bucket is reused for photo storage.

## Workflow

The workflow is redesigned to give the user full control at every step. Caption generation is deferred until after photo selection, and publishing goes directly to Meta with no intermediate "approved" state.

### Post Statuses

| Status | Meaning |
|--------|---------|
| `draft` | Candidates scored, awaiting photo selection / caption / publishing |
| `posted` | Published to at least one Meta platform |
| `discarded` | Replaced by a newer draft or manually dismissed |

### Step-by-Step Flow

```
┌─────────────────┐
│ Generate New Post│  User clicks button (with optional search filter)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Score 3 Photos  │  3 candidates scored by Gemini + Claude + OpenAI + curator
│  Display Results │  Tabbed UI shows all 3, top pick selected by default
│  Status: draft   │  NO caption generated yet
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Select Photo    │  User picks their preferred photo (may differ from AI's top pick)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Generate Caption │  User clicks "Generate Caption" → AI creates caption for selected photo
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Edit Caption    │  Caption is editable inline (optional)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Post to Meta    │  Platform checkboxes (FB + IG both checked by default)
│  Status: posted  │  User clicks "Post" → publishes to selected platforms
└─────────────────┘
```

### Key Behaviors

- **Generating a new batch replaces the current draft.** If a draft exists when "Generate New Post" is clicked, the old draft is set to `discarded` and all 3 of its candidate photos return to the pool.
- **Only `posted` photos are excluded from the pool.** Draft and discarded photos are always available for future runs.
- **Caption generation is a separate, explicit step.** The pipeline run only scores photos — no caption is generated until the user asks for one.
- **No approve/reject cycle.** The old `pending` → `approved` → `publish` flow is collapsed into `draft` → `posted`.
- **"Pick Photo" (manual selection from full catalog) still works.** Creates a draft with a single candidate (no scoring), then follows the same caption → post flow.

### Dashboard Views

| Tab | Shows |
|-----|-------|
| **Current** | The active draft (if any) — the main workspace |
| **Posted** | History of published posts with platform badges and dates |

The "Current" tab is the default view. If no draft exists, it shows an empty state with the "Generate New Post" and "Pick Photo" buttons.

## Architecture

```
                    Route 53
                       │
            marketing.raymatthews.com
                       │
                   CloudFront
                       │
          ┌────────────┼────────────────┐
          │            │                │
     S3 Bucket    API Gateway    Lambda Function URL
     (frontend)   (REST API)    (long-running: pipeline)
          │            │                │
          │       ┌────┴────┐     ┌────┴────┐
          │    Cognito    Lambda   Lambda
          │  (authorizer) (API)   (pipeline)
          │                │           │
          │       ┌────────┼───────────┤
          │       │        │           │
          │  DynamoDB  S3 Bucket   External APIs
          │  (posts,  (ray-faa-   (Claude, OpenAI,
          │   config)  images)     Gemini, Meta)
          │
     Cognito Hosted UI
     (login page)
```

### Component Details

#### 1. Authentication (Cognito)

Amazon Cognito User Pool protects the entire application. Single user account created during deployment.

- **Cognito User Pool**: `ray-marketing-users`
- **Cognito App Client**: configured for the frontend SPA (authorization code flow with PKCE)
- **Cognito Domain**: `ray-marketing.auth.us-east-1.amazoncognito.com` (or custom subdomain)
- **Login flow**: user visits `marketing.raymatthews.com` → redirected to Cognito Hosted UI → signs in → redirected back with tokens → frontend stores tokens and includes them in API calls
- **API Gateway authorizer**: Cognito authorizer validates JWT tokens on all API routes
- **Lambda Function URL auth**: IAM auth type; the frontend calls it via API Gateway which proxies to the Function URL (keeping Cognito protection)
- **Initial user**: created by deploy script via `aws cognito-idp admin-create-user` with email `whitmell@gmail.com`

Cost: Cognito is free for up to 10,000 monthly active users.

#### 2. Static Frontend (S3 + CloudFront)

The current EJS templates become static HTML + vanilla JS. The server-side rendering is thin — it just passes data to templates — so this is mostly extracting the existing HTML/JS into standalone files that call the API directly.

- **S3 bucket**: `ray-marketing-frontend-{account-id}` — hosts `index.html`, CSS, JS
- **CloudFront distribution**: serves both the S3 bucket and API at the custom domain
- **CloudFront error pages**: 403/404 → `/index.html` with 200 status (enables SPA client-side routing)
- **Files**: `index.html` (SPA shell), `app.js` (dashboard + post detail + auth + all interactions), Tailwind CDN loaded via `<script>` tag

Client-side routing:
- `/` → dashboard ("Current" tab by default, showing active draft or empty state)
- `/posts/{id}` → post detail view (for viewing posted history)
- `/login` → redirect to Cognito Hosted UI

The frontend handles Cognito token management:
- Stores tokens in `sessionStorage` (not `localStorage` for security)
- Includes `Authorization: Bearer {idToken}` header on all API requests
- Redirects to Cognito login when tokens expire or are missing

#### 3. API Backend (API Gateway + Lambda)

Two Lambda functions behind a single CloudFront distribution:

**Lambda 1 — API handler** (behind API Gateway):
Fast routes: reads, caption generation, caption edits, publishing, discarding.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/posts` | List posts by status (query param: `draft`, `posted`, `discarded`) |
| GET | `/api/posts/{id}` | Get single post with photo metadata |
| GET | `/api/posts/current` | Get the active draft (convenience endpoint) |
| GET | `/api/photos` | List photo candidates (with `used` flag for posted photos) |
| GET | `/api/config` | Get app config |
| POST | `/api/posts/{id}/select-photo` | Select which candidate photo to use for the draft |
| POST | `/api/posts/{id}/generate-caption` | Generate AI caption for the selected photo |
| PUT | `/api/posts/{id}/caption` | Edit caption text manually |
| POST | `/api/posts/{id}/post` | Publish to Meta (body: `{ platforms: ["facebook", "instagram"] }`) |
| DELETE | `/api/posts/{id}` | Discard a draft (sets status to `discarded`) |

- Runtime: Node.js 22.x
- Memory: 256 MB
- Timeout: 29 seconds (API Gateway maximum)

**Lambda 2 — Pipeline handler** (Lambda Function URL):
Long-running operations that exceed API Gateway's 29-second timeout. The scoring pipeline sends images to 3 LLM providers in parallel and waits for a curator ranking — typically 30-60 seconds.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/pipeline/run` | Score 3 candidates, create draft (no caption) |
| POST | `/api/pipeline/pick` | Create draft from a specific photo (no scoring, no caption) |

When `/api/pipeline/run` is called and a draft already exists, the existing draft is automatically set to `discarded` before creating the new one.

- Runtime: Node.js 22.x
- Memory: 512 MB (handles parallel image processing + LLM calls)
- Timeout: 120 seconds
- Auth: routed through API Gateway / CloudFront for Cognito protection

**CloudFront routing:**
- Default behavior → S3 (frontend)
- `/api/pipeline/*` → Lambda Function URL origin
- `/api/*` → API Gateway origin
- `/photos/*` → `ray-faa-images` S3 bucket origin (for photo thumbnails in the UI)

**Environment variables** (set from `.env` during deploy):
- `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `PHOTOS_BUCKET` (`ray-faa-images`)
- `DYNAMODB_TABLE_POSTS`, `DYNAMODB_TABLE_CONFIG`
- `META_PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `INSTAGRAM_USER_ID`, `META_API_VERSION`
- `RESOURCES_BUCKET` (for caption-prompt.md and description/upload-progress data)

#### 4. DynamoDB Tables

**Posts table: `ray-marketing-posts`**

| Attribute | Type | Key |
|-----------|------|-----|
| `id` | String | Partition key |
| `status` | String | GSI partition key (`status-createdAt-index`) |
| `createdAt` | String (ISO) | GSI sort key |
| `photoFilename` | String | The selected candidate's filename |
| `caption` | String \| null | null until "Generate Caption" is clicked |
| `primaryTheme` | String | |
| `postedAt` | String \| null | When published to Meta |
| `imageUrl` | String \| null | S3 URL after upload for Instagram publishing |
| `publishedTo` | List of `{ platform, publishedAt, platformPostId }` |
| `candidates` | List of `ScoringCandidate` objects (all 3 scored photos) |

**GSI: `status-createdAt-index`** — partition key `status`, sort key `createdAt` (descending). Enables queries: "current draft" (`status = draft`), "posted history" (`status = posted`, newest first).

**Config table: `ray-marketing-config`**

| Attribute | Type | Key |
|-----------|------|-----|
| `key` | String | Partition key |
| `value` | Map | |

Single item with `key = "app"` storing `{ themeLookback: 2 }`.

Both tables use **on-demand capacity** (pay-per-request) — at single-user traffic this is effectively free within the DynamoDB free tier.

#### 5. Photo & Resource Storage

**Existing bucket: `ray-faa-images`** (already deployed via `deploy/aws/s3-bucket-user.yml`)
- Contains photo JPEG files used by the scoring service and displayed in the frontend photo picker
- IAM user `rayphotog` has read/write access (access key already provisioned)
- Lambda function's execution role gets read access to this bucket
- CloudFront serves photos from this bucket at `/photos/*` path for the frontend

**New bucket: `ray-marketing-resources-{account-id}`**
- `descriptions.json` — photo metadata (titles, descriptions, tags)
- `upload-progress.json` — upload status and Fine Art America URLs
- `caption-prompt.md` — Claude system prompt for caption generation

The Lambda function reads resource files from S3 at invocation time, caching them in module scope for warm starts. The `loadPhotoCandidates()` function is refactored to read from S3 instead of the local filesystem. Photos for the scoring service are downloaded from `ray-faa-images`, resized in memory with `sharp`, and sent as base64 to the LLM APIs.

#### 6. Domain & HTTPS

- **Route 53 hosted zone**: `raymatthews.com` (already exists)
- **ACM certificate**: `marketing.raymatthews.com` in `us-east-1` (required for CloudFront)
- **CloudFront distribution**: single distribution with multiple origins
  - Default behavior → S3 frontend bucket (OAC)
  - `/api/pipeline/*` → Lambda Function URL origin
  - `/api/*` → API Gateway origin
  - `/photos/*` → `ray-faa-images` S3 bucket origin (OAC)
- **Route 53 A record**: `marketing.raymatthews.com` → CloudFront distribution (alias)

Single domain for everything — no CORS needed.

#### 7. Deployment

**CloudFormation template**: `infrastructure/template.yaml` — defines all AWS resources

**PowerShell scripts** in `infrastructure/`:

| Script | Purpose |
|--------|---------|
| `deploy.ps1` | Full deploy: reads `.env`, creates/updates CloudFormation stack, builds + uploads Lambda, uploads frontend, creates Cognito user |
| `update-frontend.ps1` | Quick redeploy of static frontend files + CloudFront invalidation |
| `update-lambda.ps1` | Quick redeploy of Lambda function code |
| `seed-dynamodb.ps1` | One-time: reads `data/posts.json`, maps old statuses to new (`pending`/`approved` → `discarded`, posts with `publishedTo` → `posted`), seeds DynamoDB |
| `upload-resources.ps1` | Upload resource files (descriptions, upload-progress, caption-prompt) to S3 |
| `teardown.ps1` | Delete the CloudFormation stack (preserves `ray-faa-images` bucket) |

All scripts read from `.env` in the project root. Required `.env` additions:

```env
# AWS Deployment
AWS_REGION=us-east-1
STACK_NAME=ray-marketing-pipeline
DOMAIN_NAME=marketing.raymatthews.com
HOSTED_ZONE_ID=Z...

# Cognito
COGNITO_USER_EMAIL=whitmell@gmail.com

# Existing infrastructure
PHOTOS_BUCKET=ray-faa-images
```

## Data Migration

**DynamoDB seeding** (`seed-dynamodb.ps1`):
1. Reads `data/posts.json`
2. Maps old statuses to new:
   - Posts with entries in `publishedTo` → `posted`
   - All others (`pending`, `approved`, `rejected`) → `discarded`
3. Maps old fields to new: `reviewedAt` → `postedAt` (for posted items), removes `notes`
4. Writes each post to the `ray-marketing-posts` DynamoDB table using `BatchWriteItem`
5. Writes a default config item `{ key: "app", value: { themeLookback: 2 } }` to `ray-marketing-config`

**Resource upload** (`upload-resources.ps1`):
1. Uploads `resources/descriptions.json` to S3 resources bucket
2. Uploads `resources/upload-progress.json` to S3 resources bucket
3. Uploads `resources/caption-prompt.md` to S3 resources bucket

Photos are already in `ray-faa-images` — no photo migration needed.

## Code Changes

### Removed
- `src/scheduler/` — cron scheduler (no automated runs)
- `src/server/` — Express app, EJS views, routes (replaced by Lambda + static frontend)
- `src/data/store.ts` — JSON file persistence (replaced by DynamoDB module)
- `node-cron`, `express`, `ejs` dependencies

### New: `src/data/dynamodb.ts`
Replaces `store.ts` with async DynamoDB operations:
- `readPosts(status?)` → Query on `status-createdAt-index` GSI (returns newest first)
- `readPost(id)` → GetItem by partition key
- `getCurrentDraft()` → Query `status = draft`, limit 1 (there should be at most one)
- `writePost(post)` → PutItem (full item write, used for new posts)
- `updatePost(id, updates)` → UpdateItem with expression (status changes, caption, photo selection)
- `discardDraft(id)` → UpdateItem setting `status = discarded`
- `readAppConfig()` → GetItem `{ key: "app" }`
- `writeAppConfig(config)` → PutItem
- `loadPhotoCandidates(classifyFn)` → reads `descriptions.json` + `upload-progress.json` from S3, intersects, classifies, caches in module scope

### New: `src/data/s3.ts`
S3 read helpers:
- `getResourceFile(key)` → read JSON/text files from the resources bucket
- `getPhotoBuffer(filename)` → read photo from `ray-faa-images` bucket

### New: `src/lambda/api-handler.ts`
Lambda entry point for API Gateway. Lightweight router that maps `{ httpMethod, resource, pathParameters, body }` to handler functions. Returns `{ statusCode, headers, body }`.

### New: `src/lambda/pipeline-handler.ts`
Lambda entry point for Function URL. Handles `/api/pipeline/run` and `/api/pipeline/pick`. Auto-discards existing draft before creating new one.

### New: `frontend/`
Static files:
- `index.html` — SPA shell with Tailwind CDN, nav bar, main content area
- `app.js` — client-side router, Cognito auth (token management, login redirect), API client, all rendering:
  - **Current tab**: shows active draft with candidate tabs, "Select Photo" buttons, "Generate Caption" button, caption editor, platform checkboxes (FB + IG, both checked by default), "Post" button
  - **Posted tab**: history of published posts with platform badges and dates
  - **Empty state**: "Generate New Post" and "Pick Photo" buttons when no draft exists

### Modified: `src/services/pipeline.service.ts`
- `runPipeline()` → scores 3 candidates, creates `draft` post with `caption: null`, does NOT generate caption
- `createPostFromPhoto()` → creates `draft` with single candidate, `caption: null`
- New `generateCaptionForPost(postId)` → generates caption for the draft's selected photo
- `selectCandidate()` → updates which candidate is selected, clears caption (must regenerate)
- `publishPost()` renamed to `postToMeta()` → uploads to S3 (for Instagram) + publishes to selected platforms, sets status to `posted`
- Remove `updatePostStatus()`, `regeneratePost()` — no longer needed
- `readPosts()` / `writePosts()` calls become async DynamoDB calls
- **Used photo filter**: only `posted` photos excluded from pool (not drafts)

### Modified: `src/services/scoring.service.ts`
- `loadImageBase64()` reads from S3 (`ray-faa-images` bucket) instead of local filesystem via `sharp`

### Modified: `src/services/caption.service.ts`
- `getPromptTemplate()` reads `caption-prompt.md` from S3 resources bucket instead of local filesystem

### Modified: `src/services/photo-selector.service.ts`
- Remove `fs.existsSync` / `photoFileExists()` — photo existence is validated during resource upload
- `loadPhotoCandidates()` calls the new async S3-backed version
- Used photo filter: only `posted` photos excluded

### Modified: `src/services/s3.service.ts`
- `uploadPhotoToS3()` reads source photo from `ray-faa-images` bucket, uploads to same bucket under `published/` prefix

### Modified: `src/data/types.ts`
- `Post.status` type changes: `'draft' | 'posted' | 'discarded'` (replaces `'pending' | 'approved' | 'rejected'`)
- `Post.caption` becomes `string | null` (null until caption generated)
- `Post.postedAt` replaces `Post.reviewedAt`
- Remove `Post.notes`
- Remove `AppConfig.pipelineCron`, `AppConfig.timezone` (no scheduler)

### Kept unchanged:
- `src/services/theme.service.ts` — pure function, no I/O
- `src/services/publish.service.ts` — Meta Graph API calls (already async, no filesystem I/O)
- `src/config.ts` — reads from `process.env` (Lambda environment variables)

## Constraints

- **API Gateway 29-second timeout**: fast routes (reads, caption generation, publishing) fit easily. Pipeline scoring goes through Lambda Function URL instead.
- **Lambda Function URL**: no built-in Cognito authorizer. Auth is handled by routing through CloudFront/API Gateway which validates the token, then proxying to the Function URL.
- **DynamoDB item size limit**: 400 KB. Post items with 3 candidates and full critic scores are ~5-10 KB. No concern.
- **Sharp in Lambda**: requires the `linux-arm64` (or `linux-x64`) binary. Bundled via esbuild with `external: ['sharp']` and the Lambda layer or npm platform-specific install.
- **CloudFront cache**: frontend files cached with short TTL or versioned filenames. `update-frontend.ps1` runs `aws cloudfront create-invalidation` after upload.
- **Cognito token expiry**: ID tokens expire after 1 hour by default. The frontend refreshes tokens using the refresh token (valid for 30 days).
- **At most one draft at a time.** Generating a new batch auto-discards the previous draft.

## What's Left to the Builder

- Exact esbuild configuration for Lambda bundling (especially `sharp` native bindings — may need a Lambda layer)
- CloudFront cache TTL settings for static assets vs. API responses
- Cognito Hosted UI customization (branding, colors) — or leave default
- Error handling UX in the static frontend (currently uses `alert()` — could be improved with inline error messages)
- Whether `Dockerfile` and `docker-compose.yml` should be kept for local development or removed
