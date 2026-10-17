# AWS Serverless Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Ray Matthews Marketing Pipeline from Docker/Express/JSON-files to a serverless AWS architecture (Lambda + API Gateway + DynamoDB + S3 + CloudFront + Cognito) with a simplified draft → post workflow.

**Architecture:** Static SPA frontend on S3/CloudFront calls two Lambda functions: an API handler behind API Gateway for fast operations, and a pipeline handler via Lambda Function URL for long-running AI scoring. DynamoDB stores posts and config. Photos are served from the existing `ray-faa-images` S3 bucket. Cognito protects everything behind login. A single CloudFront distribution routes all traffic under `marketing.raymatthews.com`.

**Tech Stack:** TypeScript, Node.js 22, AWS SDK v3, DynamoDB, S3, Lambda, API Gateway, CloudFront, Cognito, esbuild, CloudFormation, PowerShell

**Spec:** `docs/superpowers/specs/2026-10-16-aws-deployment-design.md`

## Global Constraints

- TypeScript strict mode, no `any` types
- camelCase functions/variables, PascalCase types/interfaces, UPPER_CASE constants
- American English spelling everywhere
- Node.js 22.x Lambda runtime
- AWS SDK v3 (modular imports: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`)
- No CDK, SAM, or Terraform — plain CloudFormation YAML deployed via AWS CLI
- esbuild for Lambda bundling (CommonJS output, external `sharp`)
- On-demand DynamoDB capacity (pay-per-request)
- Existing `ray-faa-images` S3 bucket is reused — never deleted by teardown
- Post statuses: `draft`, `posted`, `discarded` (no `pending`/`approved`/`rejected`)
- At most one `draft` post at a time
- Only `posted` photos excluded from the candidate pool

## Review Focus

1. **Cognito token refresh race condition:** If the ID token expires mid-request (e.g., during a 60s scoring run), the frontend must detect the 401 and refresh the token before retrying. Test that a request started with a valid token that expires during execution is retried after refresh.
2. **Draft replacement atomicity:** If two "Generate New Post" clicks fire before the first completes, both try to discard the existing draft and create a new one. The second pipeline run should not create a second draft. Test with a rapid double-click.
3. **Empty `candidates` on picked photos:** When a photo is manually picked (not scored), `candidates` is a list with one entry that has no `criticScores`. The frontend candidate tab rendering must not crash on null scores.
4. **Large DynamoDB items from scoring:** A post with 3 candidates, each carrying 3 critic scores and a curator ranking, must stay under 400 KB. Validate a worst-case item size during seeding.
5. **S3 photo key mismatch:** Photo filenames contain special characters (spaces, parentheses). The S3 key used to fetch a photo must match the key in `ray-faa-images` exactly. Test with a filename like `photo_BICreekFrost.jpg` and one with spaces if any exist.

---

## File Structure

```
src/
├── config.ts                          (modify: remove local-only fields, add S3/DynamoDB env vars)
├── data/
│   ├── types.ts                       (modify: new Post status, nullable caption, remove notes)
│   ├── dynamodb.ts                    (create: DynamoDB CRUD for posts and config)
│   └── s3-resources.ts                (create: S3 read helpers for resources + photos)
├── services/
│   ├── theme.service.ts               (keep unchanged)
│   ├── photo-selector.service.ts      (modify: async, S3-backed, only posted = used)
│   ├── scoring.service.ts             (modify: loadImageBase64 from S3)
│   ├── caption.service.ts             (modify: prompt template from S3)
│   ├── publish.service.ts             (keep unchanged)
│   ├── s3.service.ts                  (modify: upload reads source from S3)
│   └── pipeline.service.ts            (modify: new workflow, async DynamoDB calls)
└── lambda/
    ├── api-handler.ts                 (create: API Gateway Lambda entry point)
    └── pipeline-handler.ts            (create: Function URL Lambda entry point)

frontend/
├── index.html                         (create: SPA shell)
└── app.js                             (create: auth + routing + rendering + interactions)

infrastructure/
├── template.yaml                      (create: CloudFormation stack)
├── deploy.ps1                         (create: full deploy script)
├── update-frontend.ps1                (create: frontend-only redeploy)
├── update-lambda.ps1                  (create: Lambda-only redeploy)
├── seed-dynamodb.ps1                  (create: one-time data migration)
├── upload-resources.ps1               (create: S3 resource upload)
├── teardown.ps1                       (create: stack deletion)
└── build-lambda.ps1                   (create: esbuild bundling)

esbuild.config.mjs                     (create: esbuild config for Lambda bundles)
```

---

### Task 1: Update Types and Config

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/config.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Post` interface with `status: 'draft' | 'posted' | 'discarded'`, `caption: string | null`, `postedAt: string | null`, no `notes`, no `reviewedAt`
  - `PostView` extends `Post` with photo metadata (unchanged shape)
  - `AppConfig` with only `themeLookback: number`
  - `config` object with `photosBucket: string`, `resourcesBucket: string`, `dynamoTablePosts: string`, `dynamoTableConfig: string`, and all existing AI/Meta keys; without `port`, `pipelineCron`, `timezone`, `resourcesPath`, `dataPath`, `photosPath`, `ollamaBaseUrl`, `ollamaModel`

- [ ] **Step 1: Update `Post` interface in `src/data/types.ts`**

Change `status` to `'draft' | 'posted' | 'discarded'`. Change `caption` to `string | null`. Replace `reviewedAt` with `postedAt: string | null`. Remove `notes`. Keep all other fields.

- [ ] **Step 2: Update `AppConfig` in `src/data/types.ts`**

Remove `pipelineCron` and `timezone`. Keep only `themeLookback: number`.

- [ ] **Step 3: Update `src/config.ts`**

Remove `port`, `pipelineCron`, `timezone`, `resourcesPath`, `dataPath`, `photosPath`, `ollamaBaseUrl`, `ollamaModel`. Add `photosBucket: process.env.PHOTOS_BUCKET || 'ray-faa-images'`, `resourcesBucket: process.env.RESOURCES_BUCKET || ''`, `dynamoTablePosts: process.env.DYNAMODB_TABLE_POSTS || 'ray-marketing-posts'`, `dynamoTableConfig: process.env.DYNAMODB_TABLE_CONFIG || 'ray-marketing-config'`. Remove the `dotenv` import (Lambda uses native env vars). Keep all AI API keys and Meta config.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: Errors in files that import from `store.ts` or use old `Post` fields — that's expected, those files are modified in later tasks. No errors in `types.ts` or `config.ts` themselves.

- [ ] **Step 5: Commit**

```bash
git add src/data/types.ts src/config.ts
git commit -m "refactor: update types and config for serverless migration

- Post status: draft/posted/discarded (was pending/approved/rejected)
- Caption is nullable (generated separately from scoring)
- Config adds DynamoDB table names and S3 bucket names
- Remove local-only config (port, paths, cron, Ollama)"
```

---

### Task 2: S3 Resource Helpers

**Files:**
- Create: `src/data/s3-resources.ts`
- Add dependency: `@aws-sdk/client-s3`

**Interfaces:**
- Consumes: `config.photosBucket`, `config.resourcesBucket`, `config.awsRegion` from Task 1
- Produces:
  - `getResourceJson<T>(key: string): Promise<T>` — reads and parses a JSON file from the resources bucket
  - `getResourceText(key: string): Promise<string>` — reads a text file from the resources bucket
  - `getPhotoBuffer(filename: string): Promise<Buffer>` — reads a photo JPEG from the photos bucket
  - `loadPhotoCandidates(classifyFn: (tags: string[]) => ThemeCategory): Promise<PhotoCandidate[]>` — reads descriptions.json + upload-progress.json from S3, intersects, classifies, returns candidates. Caches result in module scope.
  - `clearCandidatesCache(): void`

- [ ] **Step 1: Install AWS SDK S3 client**

Run: `npm install @aws-sdk/client-s3`

- [ ] **Step 2: Create `src/data/s3-resources.ts`**

Lazy-init an `S3Client` using `config.awsRegion`. Implement `getResourceJson<T>(key)`: calls `GetObjectCommand` on `config.resourcesBucket` with the given key, reads the stream to string via `Body.transformToString()`, parses as JSON. Implement `getResourceText(key)`: same but returns raw string. Implement `getPhotoBuffer(filename)`: calls `GetObjectCommand` on `config.photosBucket` with key equal to `filename`, returns `Buffer.from(await Body.transformToByteArray())`. Implement `loadPhotoCandidates(classifyFn)`: if module-level `candidatesCache` is set, return it. Otherwise read `descriptions.json` and `upload-progress.json` via `getResourceJson`, intersect keys where `uploads[key]?.faaUrl` exists, build `PhotoCandidate[]`, set cache, return. Implement `clearCandidatesCache()`.

- [ ] **Step 3: Verify TypeScript compiles for this file**

Run: `npx tsc --noEmit src/data/s3-resources.ts 2>&1 | head -5`
Expected: No errors in this file (other files may still have errors from Task 1 changes).

- [ ] **Step 4: Commit**

```bash
git add src/data/s3-resources.ts package.json package-lock.json
git commit -m "feat: add S3 resource helpers for photos and metadata

Reads descriptions.json, upload-progress.json, caption-prompt.md
from resources bucket. Reads photo JPEGs from ray-faa-images bucket.
Caches photo candidates in module scope for Lambda warm starts."
```

---

### Task 3: DynamoDB Data Layer

**Files:**
- Create: `src/data/dynamodb.ts`
- Add dependencies: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`

**Interfaces:**
- Consumes: `config.dynamoTablePosts`, `config.dynamoTableConfig`, `config.awsRegion`, `Post`, `AppConfig` from Task 1
- Produces:
  - `readPosts(status?: Post['status']): Promise<Post[]>` — if status given, queries GSI `status-createdAt-index` with `ScanIndexForward: false`; if no status, scans table
  - `readPost(id: string): Promise<Post | null>` — GetItem by partition key
  - `getCurrentDraft(): Promise<Post | null>` — queries GSI with `status = 'draft'`, limit 1
  - `writePost(post: Post): Promise<void>` — PutItem (full item)
  - `updatePost(id: string, updates: Partial<Post>): Promise<void>` — builds UpdateExpression from the `updates` keys, runs UpdateItem
  - `readAppConfig(): Promise<AppConfig>` — GetItem `key = "app"`, returns `value` field, or default `{ themeLookback: 2 }` if missing
  - `writeAppConfig(appConfig: AppConfig): Promise<void>` — PutItem `{ key: "app", value: appConfig }`

- [ ] **Step 1: Install AWS SDK DynamoDB clients**

Run: `npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb`

- [ ] **Step 2: Create `src/data/dynamodb.ts`**

Lazy-init a `DynamoDBDocumentClient` from `DynamoDBClient` using `config.awsRegion`. Use `@aws-sdk/lib-dynamodb` for `GetCommand`, `PutCommand`, `QueryCommand`, `ScanCommand`, `UpdateCommand`. Implement each function per the interface above. For `updatePost`, dynamically build `UpdateExpression`, `ExpressionAttributeNames`, and `ExpressionAttributeValues` from the keys of `updates`, skipping `id`. For `readPosts` with a status, use `QueryCommand` on index `status-createdAt-index` with `KeyConditionExpression: '#s = :status'` and `ScanIndexForward: false`. For `getCurrentDraft`, same query with `Limit: 1`.

- [ ] **Step 3: Verify TypeScript compiles for this file**

Run: `npx tsc --noEmit src/data/dynamodb.ts 2>&1 | head -5`
Expected: No errors in this file.

- [ ] **Step 4: Commit**

```bash
git add src/data/dynamodb.ts package.json package-lock.json
git commit -m "feat: add DynamoDB data layer for posts and config

CRUD operations for posts table with GSI queries by status.
Config stored as single item with key 'app'.
Uses AWS SDK v3 DynamoDB Document Client."
```

---

### Task 4: Refactor Services for S3 + DynamoDB

**Files:**
- Modify: `src/services/photo-selector.service.ts`
- Modify: `src/services/scoring.service.ts`
- Modify: `src/services/caption.service.ts`
- Modify: `src/services/s3.service.ts`
- Modify: `src/services/pipeline.service.ts`
- Delete: `src/data/store.ts`
- Delete: `src/scheduler/cron.ts`
- Delete: `src/index.ts`

**Interfaces:**
- Consumes:
  - `loadPhotoCandidates`, `getPhotoBuffer`, `getResourceText` from Task 2
  - `readPosts`, `readPost`, `getCurrentDraft`, `writePost`, `updatePost`, `readAppConfig` from Task 3
  - `classifyTheme` from `theme.service.ts` (unchanged)
  - `publishToFacebook`, `publishToInstagram` from `publish.service.ts` (unchanged)
  - `generateCaption` from `caption.service.ts` (signature unchanged, internals change)
  - Updated `Post`, `PostView`, `ScoringCandidate`, `AppConfig` from Task 1
- Produces:
  - `selectCandidatePhotos(count: number, searchTerms?: string): Promise<PhotoCandidate[]>` — async version, only `posted` photos excluded
  - `scorePhotos(photos: PhotoCandidate[]): Promise<ScoringCandidate[]>` — unchanged signature but `loadImageBase64` reads from S3
  - `generateCaption(title: string, description: string, faaUrl: string): Promise<string>` — unchanged signature but reads prompt from S3
  - `uploadPhotoToS3(photoFilename: string): Promise<string>` — reads from photos bucket, uploads to `published/` prefix in same bucket
  - `runPipeline(searchTerms?: string): Promise<PostView | null>` — scores 3 candidates, creates draft with `caption: null`, auto-discards previous draft
  - `createPostFromPhoto(filename: string): Promise<PostView | null>` — creates draft with single candidate, `caption: null`
  - `generateCaptionForPost(postId: string): Promise<Post | null>` — generates caption for the draft's selected photo, saves to DynamoDB
  - `selectCandidate(postId: string, filename: string): Promise<PostView | null>` — switches selected candidate, clears caption
  - `postToMeta(postId: string, platforms: Array<'facebook' | 'instagram'>): Promise<Post | null>` — uploads to S3, publishes to Meta, sets status to `posted`
  - `getPostView(postId: string): Promise<PostView | null>` — async
  - `getPostViews(status?: Post['status']): Promise<PostView[]>` — async
  - `updatePostCaption(postId: string, caption: string): Promise<Post | null>` — saves edited caption

- [ ] **Step 1: Refactor `src/services/photo-selector.service.ts`**

Remove `fs` import and `photoFileExists` function. Import `loadPhotoCandidates` from `../data/s3-resources` and `readPosts` from `../data/dynamodb`. Make `selectCandidatePhotos` and `selectNextPhoto` async. Change the used-photo filter from `p.status === 'pending' || p.status === 'approved'` to `p.status === 'posted'`. Remove the `photoFileExists` check from the candidate loop — assume all candidates exist in S3.

- [ ] **Step 2: Refactor `src/services/scoring.service.ts`**

Import `getPhotoBuffer` from `../data/s3-resources`. Replace `loadImageBase64`: instead of `sharp(filePath)`, do `const buffer = await getPhotoBuffer(filename); const resized = await sharp(buffer).resize(...)...`. Remove the `fs` and `path` imports.

- [ ] **Step 3: Refactor `src/services/caption.service.ts`**

Import `getResourceText` from `../data/s3-resources`. Replace `getPromptTemplate`: instead of `fs.readFileSync(path.join(config.resourcesPath, 'caption-prompt.md'))`, do `promptTemplate = await getResourceText('caption-prompt.md')`. Make it async. Remove `fs` and `path` imports.

- [ ] **Step 4: Refactor `src/services/s3.service.ts`**

Replace `fs.readFileSync(localPath)` with `await getPhotoBuffer(photoFilename)` from `../data/s3-resources`. The upload destination stays the same bucket (`config.photosBucket`) but under a `published/` key prefix so the URL is publicly accessible via CloudFront. Remove `fs` and `path` imports.

- [ ] **Step 5: Rewrite `src/services/pipeline.service.ts`**

Import from `../data/dynamodb` instead of `../data/store`. All data operations become async. Implement:

- `runPipeline(searchTerms?)`: call `getCurrentDraft()`, if exists call `updatePost(draft.id, { status: 'discarded' })`. Then `selectCandidatePhotos(3, searchTerms)`, `scorePhotos(candidates)`, build a `Post` with `status: 'draft'`, `caption: null`, `postedAt: null`, `publishedTo: []`. Call `writePost(post)`. Return `PostView`.
- `createPostFromPhoto(filename)`: same draft-discard logic. Build single `ScoringCandidate` with empty `criticScores` and `curatorRanking: null`, `selected: true`. Caption is `null`.
- `generateCaptionForPost(postId)`: `readPost(postId)`, find selected candidate, load photo metadata from candidates cache, call `generateCaption(title, description, faaUrl)`, `updatePost(postId, { caption })`, return updated post.
- `selectCandidate(postId, filename)`: `readPost`, update `candidates[].selected` flags, `updatePost(postId, { candidates, photoFilename: filename, primaryTheme, caption: null })`. Return `PostView`.
- `postToMeta(postId, platforms)`: `readPost`, verify status is `draft` and caption is not null. Call `uploadPhotoToS3` for Instagram if needed. Loop over platforms calling `publishToFacebook`/`publishToInstagram`. Update post: `status: 'posted'`, `postedAt: new Date().toISOString()`, `publishedTo`, `imageUrl`. Return post.
- `updatePostCaption(postId, caption)`: `readPost`, verify draft, `updatePost(postId, { caption })`.
- `getPostView(postId)`: `readPost` + look up photo metadata from candidates cache.
- `getPostViews(status?)`: `readPosts(status)` + enrich each with photo metadata.

Remove `updatePostStatus`, `regeneratePost`.

- [ ] **Step 6: Delete old files**

Delete `src/data/store.ts`, `src/scheduler/cron.ts`, `src/index.ts`.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Errors only in files that don't exist yet (`lambda/*.ts`) or test files. No errors in the modified service files.

- [ ] **Step 8: Commit**

```bash
git add -A src/services/ src/data/store.ts src/scheduler/ src/index.ts
git commit -m "refactor: migrate services to S3 + DynamoDB backend

- photo-selector: async, reads from S3, only posted = used
- scoring: loads images from S3 bucket via sharp
- caption: reads prompt template from S3
- s3.service: reads source photo from S3 for upload
- pipeline: new workflow (draft/posted/discarded), no caption on run
- Remove store.ts, cron.ts, index.ts"
```

---

### Task 5: Lambda Handlers

**Files:**
- Create: `src/lambda/api-handler.ts`
- Create: `src/lambda/pipeline-handler.ts`

**Interfaces:**
- Consumes: all pipeline service functions from Task 4, `readAppConfig`/`writeAppConfig` from Task 3, `loadPhotoCandidates` from Task 2
- Produces:
  - `handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>` in `api-handler.ts`
  - `handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2>` in `pipeline-handler.ts`

- [ ] **Step 1: Create `src/lambda/api-handler.ts`**

Import `APIGatewayProxyEvent`, `APIGatewayProxyResult` from `aws-lambda` (install `@types/aws-lambda` as devDependency). Export `handler` function. Parse `event.httpMethod`, `event.resource`, `event.pathParameters`, `event.body`, `event.queryStringParameters`. Build a simple route table:

| httpMethod + resource pattern | Handler call |
|------|------|
| `GET /api/posts` | `getPostViews(queryParams.status)` |
| `GET /api/posts/current` | `getCurrentDraft()` then enrich to PostView |
| `GET /api/posts/{id}` | `getPostView(pathParams.id)` |
| `GET /api/photos` | `loadPhotoCandidates(classifyTheme)` + enrich with `used` flag from `readPosts('posted')` |
| `GET /api/config` | `readAppConfig()` |
| `POST /api/posts/{id}/select-photo` | `selectCandidate(id, body.filename)` |
| `POST /api/posts/{id}/generate-caption` | `generateCaptionForPost(id)` |
| `PUT /api/posts/{id}/caption` | `updatePostCaption(id, body.caption)` |
| `POST /api/posts/{id}/post` | `postToMeta(id, body.platforms)` |
| `DELETE /api/posts/{id}` | `updatePost(id, { status: 'discarded' })` |

Return `{ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) }`. Wrap in try/catch returning 500 on error. Return 404 for null results, 400 for missing required body fields.

- [ ] **Step 2: Create `src/lambda/pipeline-handler.ts`**

Export `handler` for Lambda Function URL events (`APIGatewayProxyEventV2`). Parse the path from `event.rawPath`. Route:

| Path | Handler |
|------|---------|
| `/api/pipeline/run` | `runPipeline(body?.searchTerms)` |
| `/api/pipeline/pick` | `createPostFromPhoto(body.filename)` |

Same response format. Return 404 if no unused photos, 400 if filename missing for pick.

- [ ] **Step 3: Install `@types/aws-lambda`**

Run: `npm install -D @types/aws-lambda`

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: Clean compile (or only warnings, no errors).

- [ ] **Step 5: Commit**

```bash
git add src/lambda/ package.json package-lock.json
git commit -m "feat: add Lambda handlers for API Gateway and Function URL

api-handler: 10 routes for posts CRUD, photos, config, caption, publish
pipeline-handler: 2 routes for scoring runs and manual picks"
```

---

### Task 6: esbuild Configuration and Lambda Bundling

**Files:**
- Create: `esbuild.config.mjs`
- Modify: `package.json` (add build scripts)

**Interfaces:**
- Consumes: `src/lambda/api-handler.ts`, `src/lambda/pipeline-handler.ts` from Task 5
- Produces:
  - `dist/api-handler.js` — bundled API Lambda
  - `dist/pipeline-handler.js` — bundled pipeline Lambda
  - `npm run build:lambda` script

- [ ] **Step 1: Create `esbuild.config.mjs`**

Use esbuild to bundle two entry points: `src/lambda/api-handler.ts` and `src/lambda/pipeline-handler.ts`. Output to `dist/`. Settings: `platform: 'node'`, `target: 'node22'`, `format: 'cjs'`, `bundle: true`, `minify: true`, `sourcemap: true`, `external: ['sharp', '@aws-sdk/*']` (AWS SDK is available in Lambda runtime; sharp will be a layer). `outdir: 'dist'`, `entryNames: '[name]'`.

- [ ] **Step 2: Install esbuild**

Run: `npm install -D esbuild`

- [ ] **Step 3: Add build scripts to `package.json`**

Add `"build:lambda": "node esbuild.config.mjs"`. Update `"build"` to `"node esbuild.config.mjs"` (remove old tsc + copy-views build).

- [ ] **Step 4: Test the build**

Run: `npm run build:lambda`
Expected: `dist/api-handler.js` and `dist/pipeline-handler.js` are created without errors.

- [ ] **Step 5: Commit**

```bash
git add esbuild.config.mjs package.json
git commit -m "feat: add esbuild config for Lambda bundling

Two entry points: api-handler and pipeline-handler.
Externals: sharp (Lambda layer), @aws-sdk/* (Lambda runtime).
Outputs minified CommonJS bundles to dist/."
```

---

### Task 7: CloudFormation Template

**Files:**
- Create: `infrastructure/template.yaml`

**Interfaces:**
- Consumes: nothing (standalone infrastructure definition)
- Produces: CloudFormation stack creating all AWS resources. Parameters read from deploy script.

- [ ] **Step 1: Create `infrastructure/template.yaml`**

CloudFormation template with these parameters: `DomainName`, `HostedZoneId`, `PhotosBucket`, `CognitoUserEmail`, `ResourcesBucketName` (default: auto-generated).

Resources to define:

**Cognito:**
- `CognitoUserPool` (Type: `AWS::Cognito::UserPool`): name `ray-marketing-users`, auto-verified email, password policy (min 8, no strict requirements for single user)
- `CognitoUserPoolClient` (Type: `AWS::Cognito::UserPoolClient`): no secret (SPA), explicit auth flows `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`, callback URL `https://{DomainName}/`, logout URL `https://{DomainName}/`, OAuth scopes `openid email profile`, `AllowedOAuthFlowsUserPoolClient: true`, `AllowedOAuthFlows: [code]`, `SupportedIdentityProviders: [COGNITO]`
- `CognitoUserPoolDomain` (Type: `AWS::Cognito::UserPoolDomain`): domain prefix `ray-marketing`

**DynamoDB:**
- `PostsTable`: table name `ray-marketing-posts`, partition key `id` (S), billing mode `PAY_PER_REQUEST`, GSI `status-createdAt-index` with partition key `status` (S) and sort key `createdAt` (S), projection ALL
- `ConfigTable`: table name `ray-marketing-config`, partition key `key` (S), billing mode `PAY_PER_REQUEST`

**S3:**
- `FrontendBucket`: private bucket, `WebsiteConfiguration` not needed (CloudFront OAC handles it)
- `ResourcesBucket`: private bucket for descriptions.json, upload-progress.json, caption-prompt.md

**Lambda:**
- `ApiLambdaRole` (IAM Role): assume role for `lambda.amazonaws.com`, policies for DynamoDB (read/write both tables), S3 (read photos bucket, read resources bucket, write `published/*` to photos bucket), CloudWatch Logs
- `ApiLambda`: runtime `nodejs22.x`, handler `api-handler.handler`, memory 256, timeout 29, role `ApiLambdaRole`, environment variables (all API keys + bucket names + table names, passed as CloudFormation parameters or hardcoded references), `Code` from S3 (uploaded by deploy script) or inline zip
- `PipelineLambdaRole`: same permissions as `ApiLambdaRole`
- `PipelineLambda`: runtime `nodejs22.x`, handler `pipeline-handler.handler`, memory 512, timeout 120, role `PipelineLambdaRole`, same environment variables, Lambda Function URL with `AuthType: NONE` (CloudFront + API GW handle auth)
- `PipelineLambdaUrl` (Type: `AWS::Lambda::Url`): `AuthType: NONE`, `Cors` allowing the domain
- `PipelineLambdaUrlPermission` (Type: `AWS::Lambda::Permission`): allow `lambda:InvokeFunctionUrl` for `*` principal (public, since CloudFront fronts it)
- Sharp Lambda Layer: reference a public sharp layer ARN or define one (builder's choice — a public layer like `arn:aws:lambda:us-east-1:*:layer:sharp-*` or bundled with the function)

**API Gateway:**
- `ApiGateway` (Type: `AWS::ApiGateway::RestApi`)
- Resources and methods for each route in the API handler table. Use `{proxy+}` with `ANY` method for simplicity, or define each resource explicitly. Proxy integration to `ApiLambda`.
- `CognitoAuthorizer` (Type: `AWS::ApiGateway::Authorizer`): type `COGNITO_USER_POOLS`, provider ARN from `CognitoUserPool`
- `ApiDeployment` and `ApiStage` (stage name `prod`)
- `ApiLambdaPermission`: allow API Gateway to invoke the Lambda

**CloudFront:**
- `Certificate` (Type: `AWS::CertificateManager::Certificate`): `DomainName` parameter, `ValidationMethod: DNS`, `DomainValidationOptions` with hosted zone ID
- `CloudFrontOAC` for S3 access
- `CloudFrontDistribution`:
  - Origin 1: `FrontendBucket` (S3 OAC origin), default behavior, viewer protocol `redirect-to-https`, cache policy for static assets
  - Origin 2: API Gateway (custom origin, `execute-api` domain), behavior path `/api/*` (exclude `/api/pipeline/*`), forward `Authorization` header, no caching
  - Origin 3: Pipeline Lambda Function URL (custom origin), behavior path `/api/pipeline/*`, forward `Authorization` header, no caching, origin request policy to forward all headers
  - Origin 4: `ray-faa-images` S3 bucket (OAC), behavior path `/photos/*`, cache with long TTL
  - Custom error responses: 403 → `/index.html` 200, 404 → `/index.html` 200
  - Aliases: `DomainName` parameter
  - `ViewerCertificate`: ACM certificate ARN
- `FrontendBucketPolicy`: allow CloudFront OAC to `s3:GetObject`
- `PhotosBucketPolicy`: allow CloudFront OAC to `s3:GetObject` on existing `ray-faa-images` (if not already public)

**Route 53:**
- `DnsRecord` (Type: `AWS::Route53::RecordSet`): A record alias to CloudFront distribution

Outputs: `CloudFrontDomainName`, `ApiGatewayUrl`, `CognitoUserPoolId`, `CognitoClientId`, `CognitoDomain`, `FrontendBucketName`, `ResourcesBucketName`, `PipelineFunctionUrl`.

- [ ] **Step 2: Validate template syntax**

Run: `aws cloudformation validate-template --template-body file://infrastructure/template.yaml`
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/template.yaml
git commit -m "feat: add CloudFormation template for full serverless stack

Cognito, DynamoDB, S3, Lambda (API + pipeline), API Gateway,
CloudFront, ACM certificate, Route 53. Single-domain setup with
four CloudFront origins."
```

---

### Task 8: Static Frontend (SPA)

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/app.js`

**Interfaces:**
- Consumes: API endpoints from Tasks 5 (via `fetch()`), Cognito config from CloudFormation outputs (injected as `window.__CONFIG__` or read from a `config.js` file generated during deploy)
- Produces: complete SPA that reproduces all current dashboard functionality with the new workflow

- [ ] **Step 1: Create `frontend/index.html`**

SPA shell. `<head>`: charset, viewport, title "Ray Matthews Marketing Pipeline", Tailwind CDN script with the existing brand color config (brand-50 through brand-900 from the current `header.ejs`), `<style>` with `.caption-text { white-space: pre-wrap; }`. `<body class="bg-gray-50 min-h-screen">`: nav bar matching current `header.ejs` (brand-800 background, "Ray Matthews Photography" title, "Marketing Pipeline" subtitle). `<main id="app" class="max-w-6xl mx-auto px-4 py-6">` — SPA mount point. `<script src="config.js">` (deploy-generated, contains Cognito and API settings). `<script src="app.js">`.

- [ ] **Step 2: Create `frontend/app.js` — Auth module**

At the top of `app.js`, implement Cognito auth using the OAuth2 authorization code flow with PKCE:

- Read config from `window.__CONFIG__` (`cognitoClientId`, `cognitoDomain`, `redirectUri`, `apiBase`)
- `generateCodeVerifier()` and `generateCodeChallenge(verifier)` using Web Crypto API
- `login()`: store code verifier in sessionStorage, redirect to `${cognitoDomain}/oauth2/authorize?response_type=code&client_id=...&redirect_uri=...&scope=openid+email+profile&code_challenge=...&code_challenge_method=S256`
- `handleCallback()`: if URL has `?code=`, exchange it at `${cognitoDomain}/oauth2/token` for tokens, store in sessionStorage, clear URL
- `getIdToken()`: return from sessionStorage, or call `login()` if missing/expired
- `refreshTokens()`: use refresh_token to get new id_token
- `apiFetch(path, options)`: wrapper around `fetch` that adds `Authorization: Bearer ${idToken}` header, auto-refreshes on 401, retries once
- On page load: `handleCallback()` if code present, otherwise check for valid token, redirect to login if none

- [ ] **Step 3: Create `frontend/app.js` — Router**

Simple hash-free client-side router using `history.pushState`:
- `navigateTo(path)`: push state and call `render()`
- `render()`: match `window.location.pathname` against routes:
  - `/` or `/current` → `renderDashboard('current')`
  - `/posted` → `renderDashboard('posted')`
  - `/posts/:id` → `renderPostDetail(id)`
- Listen for `popstate` event
- Intercept `<a>` clicks with `data-link` attribute

- [ ] **Step 4: Create `frontend/app.js` — Dashboard rendering**

`renderDashboard(tab)`:

If `tab === 'current'`: call `GET /api/posts/current`. If null response (no draft), render empty state with stats bar + "Generate New Post" button + "Pick Photo" button. If draft exists, render:
- Stats bar (from `GET /api/photos` counting used/available)
- Tab bar: "Current" (active), "Posted"
- The draft's candidate tabs (same tabbed UI as current `post-card.ejs` lines 67-204, converted to JS DOM creation)
- Below candidates: if no caption, show "Generate Caption" button. If caption exists, show caption text (with `**bold**` → `<strong>` rendering) + "Edit" button + platform checkboxes (Facebook checked, Instagram checked) + "Post" button.

If `tab === 'posted'`: call `GET /api/posts?status=posted`. Render list of posted cards showing photo title, theme badge, caption preview, platform badges (FB/IG with checkmarks), posted date.

- [ ] **Step 5: Create `frontend/app.js` — Interactions**

Port all interaction handlers from the current `footer.ejs`:
- `runPipeline(btn)`: disable button, show "Scoring photos...", `POST /api/pipeline/run`, on success navigate to `/`
- `pickPhoto(filename, btn)`: `POST /api/pipeline/pick`, navigate to `/`
- `selectCandidate(postId, filename, btn)`: `POST /api/posts/{id}/select-photo`, re-render
- `generateCaption(postId, btn)`: `POST /api/posts/{id}/generate-caption`, re-render
- `startEditCaption(id)` / `cancelEditCaption(id)` / `saveCaption(id)`: same show/hide toggle as current, `PUT /api/posts/{id}/caption`
- `postToMeta(postId, btn)`: read checked platforms from checkboxes, `POST /api/posts/{id}/post`, navigate to `/posted`
- `switchCandidateTab(postId, idx)`: same tab switching logic as current
- `openPhotoPicker()` / `closePhotoPicker()` / `filterPhotoPicker()` / photo picker modal: port from current `footer.ejs` lines 127-263

- [ ] **Step 6: Create `frontend/app.js` — Photo picker modal**

Render the photo picker modal HTML into the page (same markup as `dashboard.ejs` lines 71-95). The `openPhotoPicker()` function fetches `GET /api/photos`, renders the list with thumbnail images from `/photos/{filename}`, search filter, and click handler that calls `pickPhoto()`.

- [ ] **Step 7: Verify the frontend files are valid**

Open `frontend/index.html` in a browser (it won't work without the API, but verify no syntax errors in the JS by checking the console). Or run: `node -e "require('fs').readFileSync('frontend/app.js','utf8')" && echo "JS is valid UTF-8"`

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: add static SPA frontend with Cognito auth

Single-page app with client-side routing. Cognito OAuth2 PKCE flow.
Current tab shows active draft with scoring, caption gen, and publish.
Posted tab shows history. Photo picker modal for manual selection."
```

---

### Task 9: PowerShell Deploy Scripts

**Files:**
- Create: `infrastructure/deploy.ps1`
- Create: `infrastructure/update-frontend.ps1`
- Create: `infrastructure/update-lambda.ps1`
- Create: `infrastructure/seed-dynamodb.ps1`
- Create: `infrastructure/upload-resources.ps1`
- Create: `infrastructure/build-lambda.ps1`
- Create: `infrastructure/teardown.ps1`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `.env` file, CloudFormation template from Task 7, built Lambda bundles from Task 6, frontend files from Task 8
- Produces: working deployment pipeline via PowerShell

- [ ] **Step 1: Create shared `.env` loader helper**

All scripts start with reading `.env` from the project root. Create a reusable pattern at the top of each script: `Get-Content (Join-Path $PSScriptRoot '..' '.env') | ForEach-Object { if ($_ -match '^\s*([^#][^=]+)=(.*)$') { [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process') } }`.

- [ ] **Step 2: Create `infrastructure/build-lambda.ps1`**

Runs `npm run build:lambda`. Then creates two zip files: `dist/api-handler.zip` (containing `api-handler.js` and `api-handler.js.map`) and `dist/pipeline-handler.zip` (same pattern). Uses `Compress-Archive`.

- [ ] **Step 3: Create `infrastructure/deploy.ps1`**

Full deploy script. Reads `.env`. Steps:
1. Run `build-lambda.ps1`
2. Upload Lambda zips to S3 (create a deploy bucket `ray-marketing-deploy-{region}` if needed, or use the resources bucket)
3. Run `aws cloudformation deploy` with `template.yaml`, passing parameters from `.env` (`DomainName`, `HostedZoneId`, `PhotosBucket`, `CognitoUserEmail`)
4. Wait for stack to complete
5. Read stack outputs (bucket names, Cognito config, CloudFront domain, etc.)
6. Generate `frontend/config.js` from stack outputs: `window.__CONFIG__ = { cognitoClientId: '...', cognitoDomain: '...', redirectUri: 'https://{domain}/', apiBase: '' }`
7. Upload frontend files to the frontend S3 bucket: `aws s3 sync frontend/ s3://{bucket}/ --delete`
8. Update Lambda function code: `aws lambda update-function-code --function-name {name} --s3-bucket {bucket} --s3-key {key}`
9. Create Cognito user if not exists: `aws cognito-idp admin-create-user --user-pool-id {id} --username {email} --user-attributes Name=email,Value={email} Name=email_verified,Value=true --temporary-password {random}`
10. Run CloudFront invalidation: `aws cloudfront create-invalidation --distribution-id {id} --paths '/*'`
11. Print summary with URL

- [ ] **Step 4: Create `infrastructure/update-frontend.ps1`**

Reads `.env`, gets stack outputs, generates `frontend/config.js`, syncs frontend to S3, runs CloudFront invalidation.

- [ ] **Step 5: Create `infrastructure/update-lambda.ps1`**

Reads `.env`, runs `build-lambda.ps1`, uploads zips, updates Lambda function code for both functions.

- [ ] **Step 6: Create `infrastructure/seed-dynamodb.ps1`**

Reads `.env` and `data/posts.json`. For each post: maps old status to new (`publishedTo.length > 0` → `posted`, else → `discarded`), renames `reviewedAt` → `postedAt` for posted items, removes `notes`, sets `caption` to existing value or null. Uses `aws dynamodb batch-write-item` in groups of 25. Also writes the config item `{ key: "app", value: { themeLookback: 2 } }`.

- [ ] **Step 7: Create `infrastructure/upload-resources.ps1`**

Reads `.env`, gets resources bucket name from stack outputs. Uploads `resources/descriptions.json`, `resources/upload-progress.json`, `resources/caption-prompt.md` via `aws s3 cp`.

- [ ] **Step 8: Create `infrastructure/teardown.ps1`**

Reads `.env`. Empties the frontend bucket and resources bucket (`aws s3 rm --recursive`). Deletes the CloudFormation stack. Prints warning that `ray-faa-images` is preserved.

- [ ] **Step 9: Update `.env.example`**

Add the new deployment variables: `AWS_REGION`, `STACK_NAME`, `DOMAIN_NAME`, `HOSTED_ZONE_ID`, `COGNITO_USER_EMAIL`, `PHOTOS_BUCKET`, `RESOURCES_BUCKET`. Remove `PORT`, `PIPELINE_CRON`, `TIMEZONE`, `RESOURCES_PATH`, `DATA_PATH`, `PHOTOS_PATH`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`.

- [ ] **Step 10: Commit**

```bash
git add infrastructure/ .env.example
git commit -m "feat: add PowerShell deploy scripts and CloudFormation deployment

deploy.ps1: full stack deploy from .env
update-frontend.ps1 / update-lambda.ps1: quick partial deploys
seed-dynamodb.ps1: one-time data migration from posts.json
upload-resources.ps1: push resource files to S3
teardown.ps1: clean stack deletion
build-lambda.ps1: esbuild + zip for Lambda"
```

---

### Task 10: Cleanup and Final Integration

**Files:**
- Delete: `src/server/` (entire directory)
- Delete: `Dockerfile`
- Delete: `docker-compose.yml`
- Modify: `package.json` (remove unused dependencies)
- Modify: `tsconfig.json` (adjust if needed for Lambda output)

**Interfaces:**
- Consumes: everything from Tasks 1-9
- Produces: clean, deployable project

- [ ] **Step 1: Delete old server code**

Remove `src/server/` directory (app.ts, routes/, views/), `src/scheduler/cron.ts` (if not already deleted in Task 4), `src/index.ts` (if not already deleted).

- [ ] **Step 2: Remove unused dependencies**

Run: `npm uninstall express ejs node-cron @types/express @types/ejs @types/node-cron`

Also remove `dotenv` (Lambda uses native env vars): `npm uninstall dotenv`

- [ ] **Step 3: Delete Docker files**

Remove `Dockerfile` and `docker-compose.yml`.

- [ ] **Step 4: Update `package.json` scripts**

Remove `"start"`, `"dev"`, `"copy-views"`. Keep `"build"` pointing to `"node esbuild.config.mjs"`. Add `"build:lambda"` if not already present.

- [ ] **Step 5: Verify full build**

Run: `npm run build`
Expected: `dist/api-handler.js` and `dist/pipeline-handler.js` created with no errors.

- [ ] **Step 6: Verify TypeScript compiles clean**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove Express server, Docker, and unused dependencies

Project is now fully serverless. Entry points are Lambda handlers.
Frontend is static SPA in frontend/ directory.
Deploy via infrastructure/ PowerShell scripts."
```

---

## Execution Notes

- **Task ordering matters for 1-6**: each task builds on the previous task's interfaces. Tasks 7, 8, and 9 can be done in parallel since they consume only the interfaces defined in Tasks 1-5.
- **The ACM certificate** in Task 7 requires DNS validation. The CloudFormation stack will wait for the certificate to validate. If the hosted zone is correct, CloudFormation handles adding the validation CNAME records automatically (with `DomainValidationOptions`). This can take 5-30 minutes.
- **Sharp Lambda layer**: the simplest approach is to install `sharp` with the `--platform=linux --arch=arm64` flag during the build step, include it in the zip, and set the Lambda architecture to `arm64`. Alternative: use a public sharp layer. The build script should handle this.
- **First deploy**: after `deploy.ps1` completes, run `seed-dynamodb.ps1` and `upload-resources.ps1` once. The Cognito user will receive a temporary password via email and must change it on first login.
