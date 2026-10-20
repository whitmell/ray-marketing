# Meta (Facebook & Instagram) Setup Guide

This guide walks through setting up Meta's Graph API so the marketing pipeline can publish posts to your Facebook Page and Instagram Professional account.

> **API Version:** This guide uses Graph API **v26.0** (released July 2026). Meta retires old versions roughly every two years — check the [version changelog](https://developers.facebook.com/docs/graph-api/changelog/versions) if you're setting this up later.

## Overview

The pipeline uses three environment variables for Meta publishing:

| Variable | What it is |
|----------|------------|
| `META_SYSTEM_USER_TOKEN` | A long-lived System User token (the app exchanges it for a page token at runtime) |
| `FACEBOOK_PAGE_ID` | Your Facebook Page's numeric ID |
| `INSTAGRAM_USER_ID` | Your Instagram Professional account's numeric ID |

You'll create a Meta Developer App, select the right use cases, grant permissions, and generate a long-lived token.

## Prerequisites

- A **Facebook Page** for your business (not a personal profile)
- An **Instagram Professional account** (Business or Creator) linked to that Facebook Page
- A **Meta Developer account** at [developers.facebook.com](https://developers.facebook.com)

## Step 1: Create a Meta Developer App

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and click **Create App**.
2. Enter an app name (e.g., "Ray Marketing Pipeline") and your contact email.
3. If you have a Meta Business Portfolio, select it; otherwise skip.
4. Click **Create App**.

## Step 2: Select Use Cases

Meta now uses a **Use Cases** model instead of the old "Add Products" approach. During app creation (or from your app dashboard under **Add use cases**), select these two:

1. **Manage everything on your Page** — enables `pages_manage_posts` and `pages_read_engagement` for publishing to your Facebook Page.
2. **Manage messaging & content on Instagram** — enables `instagram_content_publish` for publishing photos to Instagram.

You do **not** need:
- "Facebook Login" — the pipeline doesn't have users log in via Facebook
- "Marketing API" — only needed for paid ads, not organic posts
- Webhooks or Instagram Business Login — the pipeline only publishes, it doesn't receive events or serve other users

### What happens when you select these use cases

Each use case has its own setup page with multiple steps (permissions, tokens, webhooks, business login, app review). For a personal publishing tool in Development Mode, you only need:

- **Step 1 (Permissions):** Confirm the required permissions are listed. Click **"Go to permissions and features"** to verify.
- **Step 2 (Generate access tokens):** You can skip this — you'll generate tokens via the Graph API Explorer in Step 5 below, which gives you more control.
- **Steps 3–5 (Webhooks, Business Login, App Review):** Skip all of these. They're for production apps serving other users.

## Step 3: Verify Permissions

Go to **App Dashboard > Permissions and Features** and confirm these permissions are available:

| Permission | Used for |
|------------|----------|
| `pages_manage_posts` | Publishing posts to your Facebook Page |
| `pages_read_engagement` | Reading Page metadata |
| `instagram_content_publish` | Publishing photos to Instagram |

> **Note:** The old `instagram_basic` permission no longer exists. You don't need it — your pipeline reads the Instagram User ID through the Page's `instagram_business_account` field, which is covered by your Page permissions.

### For development/testing (your own accounts)

You can use these permissions immediately in **Development Mode** with your own accounts — no app review needed. As the app creator, you're automatically an Administrator and can use all permissions right away.

### For production (other people's accounts)

If other people will use this app with their own Pages, you'll need to submit each permission for **App Review**. This isn't needed for a personal marketing tool.

## Step 4: Link Your Instagram Professional Account

Your Instagram account must be a **Professional account** (Business or Creator) connected to your Facebook Page:

1. Open the Instagram app on your phone.
2. Go to **Settings > Account > Switch to Professional Account** (if not already Professional).
3. Choose **Business** or **Creator**.
4. When prompted, connect it to your Facebook Page.

To verify the link from Facebook:

1. Go to your Facebook Page.
2. Click **Settings > Linked Accounts** (or **Instagram** in the left menu).
3. Confirm your Instagram account appears as connected.

## Step 5: Generate a Page Access Token

### Option A: Get a short-lived User Access Token

1. Go to the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Select your app from the **Meta App** dropdown.
3. Under **User or Page**, select **Get User Access Token**.
4. In the permissions dialog, check:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_content_publish`
5. Click **Generate Access Token** and authorize when prompted.
6. This gives you a **short-lived User Access Token** (expires in about 1 hour).

> **Note:** If a permission doesn't appear in the list, go back to Step 3 and make sure it's enabled in your app's Permissions and Features.

### Option B: Exchange for a long-lived token

Short-lived tokens expire quickly. Exchange yours for a long-lived one:

1. In the Graph API Explorer, note your short-lived token.
2. Make this API call (replace the placeholders):

```
GET https://graph.facebook.com/v26.0/oauth/access_token?
  grant_type=fb_exchange_token&
  client_id=YOUR_APP_ID&
  client_secret=YOUR_APP_SECRET&
  fb_exchange_token=YOUR_SHORT_LIVED_TOKEN
```

You can find your App ID and App Secret in your app's **Settings > Basic**.

3. The response contains a long-lived **User Access Token** (lasts about 60 days).

### Option C: Get a never-expiring Page Access Token

For a token that doesn't expire:

1. Using your long-lived User Access Token from Option B, call:

```
GET https://graph.facebook.com/v26.0/me/accounts?access_token=YOUR_LONG_LIVED_USER_TOKEN
```

2. The response lists your Pages. Find your Page and copy its `access_token`.
3. This **Page Access Token** never expires as long as the User Access Token used to generate it was long-lived.

Verify it won't expire:

```
GET https://graph.facebook.com/v26.0/debug_token?
  input_token=YOUR_PAGE_TOKEN&
  access_token=YOUR_PAGE_TOKEN
```

The response should show `"expires_at": 0` (meaning it never expires).

4. Set this as your `META_SYSTEM_USER_TOKEN` in `.env`. The app automatically exchanges it for a page access token before each publish.

> **Recommended: System User token.** Create an **Admin System User** in [Meta Business Settings](https://business.facebook.com/settings/system-users). Assign your Page and app to the system user, then generate a token. System User tokens never expire and aren't affected by password changes.

## Step 6: Find Your Facebook Page ID

The Page ID was returned in Step 5, Option C (the `id` field next to your Page's access token). You can also find it:

1. Go to your Facebook Page.
2. Click **About** (or **Page Transparency** on newer Pages).
3. Scroll to find the **Page ID** — a numeric string like `123456789012345`.

Or use the API:

```
GET https://graph.facebook.com/v26.0/me/accounts?access_token=YOUR_PAGE_TOKEN
```

The `id` field for your Page is the Page ID.

Set this as your `FACEBOOK_PAGE_ID` in `.env`.

## Step 7: Find Your Instagram User ID

Using the Graph API Explorer or a direct API call:

```
GET https://graph.facebook.com/v26.0/YOUR_PAGE_ID?fields=instagram_business_account&access_token=YOUR_PAGE_TOKEN
```

The response looks like:

```json
{
  "instagram_business_account": {
    "id": "17841400123456789"
  },
  "id": "123456789012345"
}
```

The `instagram_business_account.id` is your Instagram User ID.

Set this as your `INSTAGRAM_USER_ID` in `.env`.

## Step 8: Update Your Deployment

After adding all three values to your `.env` file, redeploy the Lambda functions so they pick up the new environment variables:

```powershell
.\infrastructure\deploy.ps1
```

Or, if the stack is already deployed and you only need to update Lambda environment variables:

```powershell
.\infrastructure\update-lambda.ps1
```

## How the Pipeline Publishes

### Facebook

The pipeline posts to your Facebook Page's feed:

```
POST https://graph.facebook.com/v26.0/{PAGE_ID}/feed
  message: <caption text>
  link: <Fine Art America URL>
```

### Instagram

Instagram publishing is a two-step process:

1. **Create a media container** — tells Instagram to fetch the photo from its public URL:

```
POST https://graph.facebook.com/v26.0/{INSTAGRAM_USER_ID}/media
  image_url: <CloudFront photo URL>
  caption: <caption text>
```

2. **Publish the container:**

```
POST https://graph.facebook.com/v26.0/{INSTAGRAM_USER_ID}/media_publish
  creation_id: <container ID from step 1>
```

**Important:** Instagram fetches the image from the URL you provide, so the photo must be publicly accessible. The pipeline serves photos through CloudFront (`https://your-domain.com/photos/filename.jpg`), which handles this automatically.

## Troubleshooting

### "Invalid OAuth access token"

Your token has expired or been revoked. Generate a new one following Step 5. Use Option C for a never-expiring Page Access Token, or consider a System User token (see the note at the end of Step 5).

Common causes of token revocation:
- You changed your Facebook password
- You removed the app's access to your Page
- Meta revoked it due to a security event

### "Unsupported post request" on Instagram

- Verify your Instagram account is a **Professional** account (Business or Creator).
- Verify it's linked to the same Facebook Page your token is for.
- Check that the image URL is publicly accessible (try opening it in an incognito browser window).

### "Application does not have permission"

- Verify you've granted `pages_manage_posts` and `instagram_content_publish` in your app's **Permissions and Features**.
- If in Development Mode, make sure you're using an account that's an Administrator, Developer, or Tester of the app.

### Instagram container status stuck at "IN_PROGRESS"

Instagram needs to download and process the image. This usually takes a few seconds but can take up to a minute. If it stays stuck:

- Check that the image URL is publicly accessible.
- Check that the image is JPEG or PNG and under 8MB.
- Try a different image to rule out format issues.
- Containers expire if not published within 24 hours.

### Can't find Instagram Business Account ID

- Make sure the Instagram account is Professional (Business or Creator), not Personal.
- Make sure it's linked to the Facebook Page in Instagram's settings (not just Facebook's).
- The link can take a few minutes to propagate — wait and retry the API call.

## Token Maintenance

| Token type | Lifespan | Action needed |
|------------|----------|---------------|
| Short-lived User Token | ~1 hour | Don't use for deployment |
| Long-lived User Token | ~60 days | Exchange before expiry |
| Page Access Token (from long-lived User Token) | Never expires* | Check periodically |
| System User Token | Never expires | None — most durable option |

*A Page Access Token derived from a long-lived User Token technically never expires, but it can be invalidated if you change your Facebook password, remove the app's Page access, or Meta revokes it due to a security event.

**Recommendation:** Use a never-expiring Page Access Token (Step 5, Option C) or a System User token for deployment. Set a calendar reminder to check it every few months in case Meta revokes it due to password changes or security events.
