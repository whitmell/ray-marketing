# Pick a Specific Photo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Pick Photo…" button to the dashboard that opens a searchable modal of all photos and creates a pending post from the user's pick, bypassing random selection and AI scoring.

**Architecture:** A new pipeline service function (`createPostFromPhoto`) handles the manual flow — same caption-generation step as the random pipeline, no scoring. Two new HTTP routes expose it: `GET /api/photos` returns the picker's list with `used` flags, `POST /api/pipeline/pick` creates the post. The dashboard gets a modal driven by vanilla `fetch()` in `footer.ejs`, matching the existing inline-script pattern.

**Tech Stack:** TypeScript (strict mode), Express, EJS, Tailwind via CDN, vanilla JS. No new dependencies. No test framework — verification is manual via the browser and `npm run build` for type-checking.

**Reference spec:** [docs/superpowers/specs/2026-05-12-pick-specific-photo-design.md](../specs/2026-05-12-pick-specific-photo-design.md)

---

## Task 1: `createPostFromPhoto` service function

**Files:**
- Modify: `src/services/pipeline.service.ts` (append a new exported function after `regeneratePost`)

- [ ] **Step 1: Add `createPostFromPhoto` to `pipeline.service.ts`**

Append this function at the end of the file (after `regeneratePost`):

```ts
export async function createPostFromPhoto(filename: string): Promise<PostView | null> {
  const candidates = loadPhotoCandidates(classifyTheme);
  const photo = candidates.find(c => c.filename === filename);
  if (!photo) {
    console.log(`[Pipeline] Manual pick rejected — unknown filename: ${filename}`);
    return null;
  }

  const caption = await generateCaption(photo.title, photo.description, photo.faaUrl);

  const post: Post = {
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
    candidates: [],
  };

  const posts = readPosts();
  posts.push(post);
  writePosts(posts);

  console.log(`[Pipeline] Created post ${post.id} from manual pick "${photo.title}"`);

  return {
    ...post,
    photoTitle: photo.title,
    photoDescription: photo.description,
    photoTags: photo.tags,
    faaUrl: photo.faaUrl,
  };
}
```

- [ ] **Step 2: Type-check the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (All identifiers used — `loadPhotoCandidates`, `classifyTheme`, `generateCaption`, `Post`, `PostView`, `uuidv4`, `readPosts`, `writePosts` — are already imported at the top of this file.)

- [ ] **Step 3: Commit**

```bash
git add src/services/pipeline.service.ts
git commit -m "feat: add createPostFromPhoto service function"
```

---

## Task 2: `POST /api/pipeline/pick` route

**Files:**
- Modify: `src/server/routes/api.pipeline.ts`

- [ ] **Step 1: Add the `/pick` route**

Update `src/server/routes/api.pipeline.ts` so it reads:

```ts
import { Router } from 'express';
import { runPipeline, createPostFromPhoto } from '../../services/pipeline.service';

export function apiPipelineRouter(): Router {
  const router = Router();

  router.post('/run', async (req, res) => {
    try {
      const searchTerms = req.body?.searchTerms as string | undefined;
      const post = await runPipeline(searchTerms);
      if (!post) {
        return res.status(404).json({ error: 'No unused photos available' });
      }
      res.json({ success: true, post });
    } catch (error) {
      console.error('[API] Pipeline run failed:', error);
      res.status(500).json({ error: 'Pipeline execution failed' });
    }
  });

  router.post('/pick', async (req, res) => {
    try {
      const filename = req.body?.filename;
      if (typeof filename !== 'string' || filename.trim().length === 0) {
        return res.status(400).json({ error: 'filename required' });
      }
      const post = await createPostFromPhoto(filename);
      if (!post) {
        return res.status(400).json({ error: 'Photo not found' });
      }
      res.json({ success: true, post });
    } catch (error) {
      console.error('[API] Pipeline pick failed:', error);
      res.status(500).json({ error: 'Pipeline execution failed' });
    }
  });

  return router;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manually verify the route**

In one terminal: `npm run dev`
In another terminal, hit the route with a known-bad filename (PowerShell):

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/pipeline/pick -Method Post `
  -ContentType 'application/json' -Body '{"filename":"does-not-exist.jpg"}'
```

Expected: HTTP 400 with body `{"error":"Photo not found"}`.

Then test with no body:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/pipeline/pick -Method Post `
  -ContentType 'application/json' -Body '{}'
```

Expected: HTTP 400 with body `{"error":"filename required"}`.

(Skip the success-path test for now — `GET /api/photos` in Task 3 will give us a real filename to use.)

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/api.pipeline.ts
git commit -m "feat: add POST /api/pipeline/pick route"
```

---

## Task 3: `GET /api/photos` route

**Files:**
- Create: `src/server/routes/api.photos.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Create the new router file**

Create `src/server/routes/api.photos.ts`:

```ts
import { Router } from 'express';
import { loadPhotoCandidates, readPosts } from '../../data/store';
import { classifyTheme } from '../../services/theme.service';

export function apiPhotosRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    try {
      const candidates = loadPhotoCandidates(classifyTheme);
      const posts = readPosts();
      const usedFilenames = new Set(
        posts
          .filter(p => p.status === 'pending' || p.status === 'approved')
          .map(p => p.photoFilename)
      );

      const list = candidates
        .map(c => ({
          filename: c.filename,
          title: c.title,
          tags: c.tags,
          primaryTheme: c.primaryTheme,
          faaUrl: c.faaUrl,
          used: usedFilenames.has(c.filename),
        }))
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));

      res.json(list);
    } catch (error) {
      console.error('[API] Photos list failed:', error);
      res.status(500).json({ error: 'Failed to load photos' });
    }
  });

  return router;
}
```

- [ ] **Step 2: Mount the router in `app.ts`**

Edit `src/server/app.ts`. Add the import alongside the others (after the `apiConfigRouter` import):

```ts
import { apiPhotosRouter } from './routes/api.photos';
```

And add the mount line (after the `/api/config` line):

```ts
  app.use('/api/photos', apiPhotosRouter());
```

The final routing block should look like:

```ts
  app.use('/', postsRouter());
  app.use('/api/posts', apiPostsRouter());
  app.use('/api/pipeline', apiPipelineRouter());
  app.use('/api/config', apiConfigRouter());
  app.use('/api/photos', apiPhotosRouter());
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manually verify the route**

Restart `npm run dev` (or rely on tsx watch to pick up the change), then in PowerShell:

```powershell
$photos = Invoke-RestMethod -Uri http://localhost:3000/api/photos -Method Get
$photos.Count
$photos | Select-Object -First 3
```

Expected: a non-zero count, and each entry has `filename`, `title`, `tags`, `primaryTheme`, `faaUrl`, and `used` properties. Titles should appear in alphabetical order.

- [ ] **Step 5: Verify the pick route end-to-end using a real filename**

```powershell
$first = $photos[0]
$body = @{ filename = $first.filename } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:3000/api/pipeline/pick -Method Post `
  -ContentType 'application/json' -Body $body
```

Expected: HTTP 200 with `success: true` and a post object. Then visit `http://localhost:3000/?status=pending` in a browser and confirm the new post appears at the top with a generated caption. **Reject that test post afterward** so it doesn't clutter the queue.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/api.photos.ts src/server/app.ts
git commit -m "feat: add GET /api/photos route for photo picker"
```

---

## Task 4: Dashboard button and modal markup

**Files:**
- Modify: `src/server/views/dashboard.ejs`

- [ ] **Step 1: Add the "Pick Photo…" button to the actions row**

In `src/server/views/dashboard.ejs`, the right-side actions block currently reads:

```html
  <div class="flex items-center gap-2">
    <input id="search-terms-input" type="text" placeholder="Filter: sunset, lighthouse..."
           class="px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 w-48 min-w-0" />
    <button onclick="runPipeline(this)"
            class="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-md transition-colors whitespace-nowrap">
      Generate New Post
    </button>
  </div>
```

Replace it with:

```html
  <div class="flex items-center gap-2">
    <input id="search-terms-input" type="text" placeholder="Filter: sunset, lighthouse..."
           class="px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 w-48 min-w-0" />
    <button onclick="runPipeline(this)"
            class="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-md transition-colors whitespace-nowrap">
      Generate New Post
    </button>
    <button onclick="openPhotoPicker()"
            class="px-4 py-2 text-sm font-medium text-brand-700 bg-white hover:bg-brand-50 border border-brand-600 rounded-md transition-colors whitespace-nowrap">
      Pick Photo…
    </button>
  </div>
```

- [ ] **Step 2: Add the modal markup at the bottom of the template**

At the bottom of `src/server/views/dashboard.ejs`, just before the final `<%- include('partials/footer') %>` line, add:

```html
<!-- Photo Picker Modal -->
<div id="photo-picker-modal" class="hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
     onclick="if (event.target === this) closePhotoPicker()">
  <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 p-4">
      <h2 class="text-lg font-semibold text-gray-900">Pick a Photo</h2>
      <button onclick="closePhotoPicker()" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
    </div>

    <!-- Search -->
    <div class="border-b border-gray-200 p-4">
      <input id="photo-picker-search" type="text" placeholder="Search by title or tag..."
             oninput="filterPhotoPicker(this.value)"
             class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
    </div>

    <!-- Error banner -->
    <div id="photo-picker-error" class="hidden bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700"></div>

    <!-- List -->
    <div id="photo-picker-list" class="flex-1 overflow-y-auto p-2">
      <div class="text-center text-gray-500 py-12">Loading…</div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Build (copies updated EJS to dist/)**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Visually verify the button and modal shell**

Reload the dashboard in your browser. Confirm:
- "Pick Photo…" button appears beside "Generate New Post" with an outlined (non-filled) style.
- Clicking it does nothing yet (the JS in Task 5 is not wired up). Open the browser console — you should see `ReferenceError: openPhotoPicker is not defined`. That's expected.

- [ ] **Step 5: Commit**

```bash
git add src/server/views/dashboard.ejs
git commit -m "feat: add Pick Photo button and modal markup"
```

---

## Task 5: Modal JavaScript

**Files:**
- Modify: `src/server/views/partials/footer.ejs`

- [ ] **Step 1: Append the picker JS inside the existing `<script>` block**

In `src/server/views/partials/footer.ejs`, the `<script>` block ends with the `switchCandidateTab` function (around line 125). Add these functions inside the same `<script>` block, right after `switchCandidateTab`:

```js
    let photoPickerAllPhotos = [];
    let photoPickerBusy = false;

    async function openPhotoPicker() {
      const modal = document.getElementById('photo-picker-modal');
      const list = document.getElementById('photo-picker-list');
      const search = document.getElementById('photo-picker-search');
      const errBox = document.getElementById('photo-picker-error');
      errBox.classList.add('hidden');
      errBox.textContent = '';
      search.value = '';
      list.innerHTML = '<div class="text-center text-gray-500 py-12">Loading…</div>';
      modal.classList.remove('hidden');
      photoPickerBusy = false;

      try {
        const res = await fetch('/api/photos');
        if (!res.ok) throw new Error('Failed to load photos');
        photoPickerAllPhotos = await res.json();
        renderPhotoPickerList(photoPickerAllPhotos);
        search.focus();
      } catch (err) {
        list.innerHTML = '';
        errBox.textContent = 'Error loading photos: ' + err.message;
        errBox.classList.remove('hidden');
      }
    }

    function closePhotoPicker() {
      if (photoPickerBusy) return;
      document.getElementById('photo-picker-modal').classList.add('hidden');
    }

    function renderPhotoPickerList(photos) {
      const list = document.getElementById('photo-picker-list');
      if (photos.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 py-12">No photos available.</div>';
        return;
      }
      const rows = photos.map(p => {
        const usedPill = p.used
          ? '<span class="ml-2 px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-800">in use</span>'
          : '';
        const tagsAttr = (p.tags || []).join(' ').toLowerCase().replace(/"/g, '&quot;');
        const titleAttr = p.title.toLowerCase().replace(/"/g, '&quot;');
        return `
          <button type="button"
                  class="photo-picker-row w-full flex items-center gap-3 p-2 hover:bg-gray-50 rounded-md text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-filename="${p.filename}"
                  data-title="${titleAttr}"
                  data-tags="${tagsAttr}"
                  onclick="pickPhoto('${p.filename}', this)">
            <img src="/photos/${p.filename}" alt="" class="w-16 h-16 object-cover rounded flex-shrink-0 bg-gray-100" loading="lazy" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-gray-900 truncate">
                ${escapeHtml(p.title)}${usedPill}
              </div>
              <div class="text-xs text-gray-500 mt-0.5">
                <span class="inline-block px-1.5 py-0.5 bg-gray-100 rounded">${escapeHtml(p.primaryTheme)}</span>
              </div>
            </div>
          </button>
        `;
      }).join('');
      list.innerHTML = rows;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    function filterPhotoPicker(query) {
      const q = query.trim().toLowerCase();
      const list = document.getElementById('photo-picker-list');
      const rows = list.querySelectorAll('.photo-picker-row');
      let visibleCount = 0;
      rows.forEach(row => {
        const title = row.dataset.title || '';
        const tags = row.dataset.tags || '';
        const match = q === '' || title.includes(q) || tags.includes(q);
        row.style.display = match ? '' : 'none';
        if (match) visibleCount++;
      });
      // Remove any prior "no matches" placeholder
      const placeholder = list.querySelector('.photo-picker-no-matches');
      if (placeholder) placeholder.remove();
      if (visibleCount === 0 && rows.length > 0) {
        const div = document.createElement('div');
        div.className = 'photo-picker-no-matches text-center text-gray-500 py-12';
        div.textContent = 'No matches.';
        list.appendChild(div);
      }
    }

    async function pickPhoto(filename, btn) {
      if (photoPickerBusy) return;
      photoPickerBusy = true;
      const errBox = document.getElementById('photo-picker-error');
      errBox.classList.add('hidden');
      errBox.textContent = '';

      // Disable all rows and show inline loading state on the picked one
      const allRows = document.querySelectorAll('.photo-picker-row');
      allRows.forEach(r => { r.disabled = true; });
      const labelEl = btn.querySelector('.text-sm');
      const originalLabel = labelEl ? labelEl.innerHTML : '';
      if (labelEl) labelEl.innerHTML = 'Generating caption…';

      try {
        const res = await fetch('/api/pipeline/pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        window.location.href = '/?status=pending';
      } catch (err) {
        if (labelEl) labelEl.innerHTML = originalLabel;
        allRows.forEach(r => { r.disabled = false; });
        errBox.textContent = 'Error: ' + err.message;
        errBox.classList.remove('hidden');
        photoPickerBusy = false;
      }
    }

    // ESC closes the modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('photo-picker-modal');
        if (modal && !modal.classList.contains('hidden')) closePhotoPicker();
      }
    });
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds (EJS files are copied as-is, so this only validates the TypeScript side).

- [ ] **Step 3: Commit**

```bash
git add src/server/views/partials/footer.ejs
git commit -m "feat: wire photo picker modal JS"
```

---

## Task 6: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Open `http://localhost:3000` in a browser.

- [ ] **Step 2: Happy path — pick an unused photo**

1. Click "Pick Photo…" → modal opens, list loads alphabetically.
2. Type a partial title or tag (e.g. "lighthouse") → list filters live.
3. Click a row that is **not** marked "in use" → row shows "Generating caption…", other rows go disabled.
4. After a few seconds, page reloads to `/?status=pending` and the new post is at the top.
5. Confirm the caption was generated and `Image Candidates` panel does **not** appear (because `candidates: []`).

- [ ] **Step 3: Used-photo path**

1. Click "Pick Photo…" → modal opens.
2. Find a row marked with the yellow "in use" pill (the photo you picked in Step 2 should now have one).
3. Click it → a second pending post for the same photo is created. Confirm both appear in the pending list.

- [ ] **Step 4: Error path — server stopped mid-request**

1. Click "Pick Photo…" → wait for list to load.
2. Stop the dev server (Ctrl+C in its terminal).
3. Click a row → after the fetch times out / fails, modal shows an error banner and rows re-enable. Modal stays open.
4. Restart `npm run dev`.

- [ ] **Step 5: Empty-search and close paths**

1. Click "Pick Photo…" → modal opens.
2. Type "xyznotarealtermxyz" in the search box → list shows "No matches."
3. Clear the search → all rows return.
4. Press ESC → modal closes.
5. Click "Pick Photo…" again → click outside the modal panel → modal closes.

- [ ] **Step 6: Clean up test posts**

In the dashboard's Pending tab, reject the test posts you created during verification. (Random pipeline behavior is unaffected — verify by clicking "Generate New Post" once to confirm the existing flow still works.)

- [ ] **Step 7: Final commit (if any leftover changes)**

```bash
git status
```

If nothing is modified, no commit needed. Otherwise:

```bash
git add -A
git commit -m "chore: minor adjustments from manual verification"
```

---

## Out of scope (do not implement)

- Keyboard navigation (arrow keys, Enter) within the picker list.
- Persisting filter/sort preferences.
- Thumbnail size/lazy-load optimizations beyond the `loading="lazy"` attribute.
- New unit tests / test infrastructure — this project has none today.
