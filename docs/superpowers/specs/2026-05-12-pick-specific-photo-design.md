# Pick a Specific Photo — Design

**Date:** 2026-05-12
**Status:** Approved, ready for implementation plan

## Problem

Today the only way to create a pending post (outside the cron schedule) is to click "Generate New Post," which selects 3 random candidates (filtered by the search box and theme-lookback rules), AI-scores them, and creates a post from the winner. There is no way to tell the system "use *this* photo." That makes it impossible to act on the user's own visual judgment when they already know which image they want to post.

## Goal

Let the user pick a specific photo by browsing/searching a list of every photo in the library, and have the system generate a caption for it and create a pending post — bypassing random selection and the AI scoring step entirely.

## Non-goals

- Replacing the existing random "Generate New Post" flow. It stays.
- Changing how the cron scheduler picks photos. It still uses the random pipeline.
- Thumbnail optimization, caching, lazy-loading. We use the existing `/photos/<filename>` static route as-is.
- Keyboard navigation in the picker list (arrow keys, enter to select). Mouse/touch only for v1.
- Remembering recent picks or "favorites." Not in this scope.

## UX

### Dashboard

Add a second button beside the existing "Generate New Post" button:

```
[Filter box: sunset, lighthouse...]  [Generate New Post]  [Pick Photo…]
```

Both buttons use the existing brand-color styling. "Pick Photo…" opens a modal.

### Picker modal

- **Header:** a search input that filters the list as you type. Matches against the photo's title and any tag (case-insensitive substring on either).
- **List body:** scrollable list of photo rows. Each row shows:
  - Small thumbnail (`<img src="/photos/<filename>">`, ~64px tall).
  - Title (left-aligned, primary text).
  - Primary-theme badge (small pill, matching dashboard styling).
  - "In use" pill (only if the photo currently has a pending or approved post).
- **Row click** triggers selection. While the request is in flight, the row shows a loading state ("Generating caption…") and the rest of the list disables to prevent double-clicks.
- **On success:** modal closes, page reloads to `?status=pending` so the new post appears at the top.
- **On error:** an inline error banner appears at the top of the modal; the list re-enables. Modal stays open so the user can retry or pick a different photo.
- **Close button** (X in the corner) and click-outside-to-close. ESC also closes.

### Empty state

If `GET /api/photos` returns `[]`, the modal shows "No photos available." instead of the list. (Unlikely in practice — the library is large — but cheap to handle.)

## Backend

### New service function

In `src/services/pipeline.service.ts`:

```ts
export async function createPostFromPhoto(filename: string): Promise<PostView | null>
```

Behavior:

1. `const candidates = loadPhotoCandidates(classifyTheme)`.
2. `const photo = candidates.find(c => c.filename === filename)`. If not found, return `null`.
3. `const caption = await generateCaption(photo.title, photo.description, photo.faaUrl)` — propagates errors to the caller.
4. Build a `Post`:
   ```ts
   {
     id: uuidv4(),
     photoFilename: photo.filename,
     caption,
     status: 'pending',
     primaryTheme: photo.primaryTheme,
     createdAt: new Date().toISOString(),
     reviewedAt: null,
     notes: null,
     imageUrl: null,
     publishedTo: [],
     candidates: [],          // no scoring performed
   }
   ```
5. `posts.push(post); writePosts(posts);`
6. Return the `PostView` (post + `photoTitle`, `photoDescription`, `photoTags`, `faaUrl`).
7. Log: `[Pipeline] Created post <id> from manual pick "<title>"`.

No change to `runPipeline`, `regeneratePost`, `selectCandidate`, or any other existing function.

### New API routes

In `src/server/routes/api.pipeline.ts` (keep both new routes in this file to avoid a new router):

```
POST /api/pipeline/pick      body: { filename: string }
GET  /api/photos             returns the picker list
```

`POST /api/pipeline/pick`:

- Validates `filename` is a non-empty string. 400 `{ error: 'filename required' }` if not.
- Calls `createPostFromPhoto(filename)`. If it returns `null`, respond 400 `{ error: 'Photo not found' }`.
- On success, respond `{ success: true, post }`.
- Wraps in `try/catch`. On exception, log and respond 500 `{ error: 'Pipeline execution failed' }` (matches the existing `/run` route).

`GET /api/photos`:

- Returns `Array<PhotoListEntry>` where:
  ```ts
  interface PhotoListEntry {
    filename: string;
    title: string;
    tags: string[];
    primaryTheme: ThemeCategory;
    faaUrl: string;
    used: boolean;     // true if appears in a pending or approved post
  }
  ```
- `used` is computed once per request from `readPosts()`.
- Sort by title (alphabetical, case-insensitive). Stable so the client list stays predictable.

### Note on `app.ts`

Both new routes attach to the existing `apiPipelineRouter()` factory. `GET /api/photos` is the one exception in path shape (it's not under `/api/pipeline/*`), so either:

- Mount the router as `app.use('/api', apiPipelineRouter())` and define routes as `/pipeline/run`, `/pipeline/pick`, `/photos`. (Preferred; one router, two prefixes inside it.)
- Or create a tiny separate `api.photos.ts` router and register it in `app.ts`.

Implementation plan can pick whichever is cleaner given how `app.ts` currently mounts the existing router.

## Frontend

### dashboard.ejs

- Add the "Pick Photo…" button beside "Generate New Post."
- Add the modal markup at the bottom of the template (hidden by default, toggled with a `hidden` Tailwind class).

### footer.ejs

- Add the modal's JS alongside the existing inline scripts:
  - `openPhotoPicker()` — shows modal, fetches `GET /api/photos`, renders rows.
  - `filterPhotoPicker(query)` — runs on `input` event of the search box, hides rows whose title/tags don't match.
  - `pickPhoto(filename)` — shows in-flight UI on the row, `POST /api/pipeline/pick`, on success reloads, on failure surfaces error banner and re-enables list.
  - `closePhotoPicker()` — hides modal; bound to close button, click-outside, and ESC.

Vanilla `fetch()` and DOM manipulation only — matches the existing pattern of no frontend framework.

## Data model

`Post.candidates: ScoringCandidate[]` is unchanged. Manually picked posts simply store `[]`. `post-card.ejs:66` already guards rendering on `post.candidates && post.candidates.length > 0 && post.candidates[0].criticScores`, so the candidate panel is skipped for manual posts with no other changes required.

No new types beyond `PhotoListEntry` (used internally by the picker route — could be inline or in `types.ts`).

## Data flow

```
User clicks "Pick Photo…"
  → openPhotoPicker() shows modal
  → GET /api/photos
    → server reads posts.json, intersects with cached photo candidates, returns sorted list with `used` flags
  → client renders rows
User types in search box
  → filterPhotoPicker(query) hides non-matching rows client-side
User clicks a row
  → pickPhoto(filename) marks row loading, disables list
  → POST /api/pipeline/pick { filename }
    → createPostFromPhoto:
        looks up photo
        generateCaption (Anthropic API)
        writes Post to posts.json
        returns PostView
  → success: modal closes, page reloads to /?status=pending
  → failure: error banner in modal, list re-enabled
```

## Edge cases

| Case | Handling |
|---|---|
| Filename unknown to server (deleted between modal open and pick) | `createPostFromPhoto` returns `null` → 400 → modal shows error, stays open. |
| Caption generation throws | Route's `try/catch` → 500 → modal shows generic error. |
| User picks a photo already in use | Allowed by design. New pending post created alongside existing one. Both visible in dashboard. |
| Empty library | Modal shows "No photos available." |
| Modal closed mid-request | Server-side completes; on next page load the new post appears. No cleanup needed. |
| Concurrent picks (user clicks two rows fast) | Disabling list after first click prevents this client-side. Server has no deduping — if it does happen, two separate posts get created (same as duplicate-pick case). |
| Search query produces zero rows | List body shows "No matches." (purely client-side state). |

## Files touched

- `src/services/pipeline.service.ts` — add `createPostFromPhoto`.
- `src/server/routes/api.pipeline.ts` — add `POST /pick` and `GET /api/photos` (or factor the GET to a separate router; implementation plan decides).
- `src/server/app.ts` — adjust router mount path only if needed for the `GET /api/photos` placement.
- `src/server/views/dashboard.ejs` — add button and modal markup.
- `src/server/views/partials/footer.ejs` — add modal JS.

No new dependencies. No data migration. No changes to `Post` schema.

## Testing

Manual testing flow:

1. Open dashboard. Click "Pick Photo…" — modal opens with list.
2. Type "lighthouse" — list filters live.
3. Click a row — caption generates, modal closes, new pending post appears at top.
4. Try a photo already marked "in use" — second pending post is created (intentional).
5. Pick a photo, kill the dev server mid-request — confirm graceful error in modal.
6. Empty search — modal shows "No matches."
7. ESC closes the modal. Click outside closes the modal.

No new unit tests — the project has no test infrastructure currently, and the new code is straightforward delegation to existing services.
