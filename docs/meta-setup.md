# Meta (Facebook & Instagram) Setup Guide

This guide walks through setting up Meta's Graph API so the marketing pipeline can publish posts to your Facebook Page and Instagram Professional account.

## Overview

The pipeline uses three environment variables for Meta publishing:

| Variable | What it is |
|----------|------------|
| `META_PAGE_ACCESS_TOKEN` | A long-lived Page Access Token with posting permissions |
| `FACEBOOK_PAGE_ID` | Your Facebook Page's numeric ID |
| `INSTAGRAM_USER_ID` | Your Instagram Professional account's numeric ID |

You'll create a Meta Developer App, connect it to your Facebook Page and Instagram account, grant the right permissions, and generate a long-lived token.

## Prerequisites

- A **Facebook Page** for your business (not a personal profile)
- An **Instagram Professional account** (Business or Creator) linked to that Facebook Page
- A **Meta Developer account** at [developers.facebook.com](https://developers.facebook.com)

## Step 1: Create a Meta Developer App

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and click **Create App**.
2. Select **Business** as the app type.
3. Enter an app name (e.g., "Ray Marketing Pipeline") and your contact email.
4. If you have a Meta Business Suite account, select it; otherwise skip.
5. Click **Create App**.

## Step 2: Add Required Products

From your app's dashboard:

1. Find **Facebook Login for Business** and click **Set Up**. This enables the permissions flow.
2. Find **Instagram Graph API** and click **Set Up**. This enables Instagram publishing.

## Step 3: Request Permissions

The pipeline needs these permissions:

| Permission | Used for |
|------------|----------|
| `pages_manage_posts` | Publishing posts to your Facebook Page |
| `pages_read_engagement` | Reading Page metadata |
| `instagram_basic` | Reading Instagram account info |
| `instagram_content_publish` | Publishing photos to Instagram |

### For development/testing (your own accounts)

You can use these permissions immediately in **Development Mode** with your own accounts — no app review needed. Your app's admin, developers, and testers can use all permissions right away.

### For production (other people's accounts)

If other people will use this app with their own Pages, you'll need to submit each permission for **App Review**. This isn't needed for a personal marketing tool.

## Step 4: Link Your Facebook Page

1. In your app dashboard, go to **Settings > Advanced**.
2. Under **App Page**, select your Facebook Page.
3. Go to your Facebook Page's **Settings > Page Roles** (or **New Pages Experience > Settings > Page Access**).
4. Confirm the app has access to manage the Page.

## Step 5: Link Your Instagram Professional Account

Your Instagram account must be a **Professional account** (Business or Creator) connected to your Facebook Page:

1. Open the Instagram app on your phone.
2. Go to **Settings > Account > Switch to Professional Account** (if not already Professional).
3. Choose **Business** or **Creator**.
4. When prompted, connect it to your Facebook Page.

To verify the link from Facebook:

1. Go to your Facebook Page.
2. Click **Settings > Linked Accounts** (or **Instagram** in the left menu).
3. Confirm your Instagram account appears as connected.

## Step 6: Generate a Page Access Token

### Option A: Graph API Explorer (quickest for development)

1. Go to the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Select your app from the **Meta App** dropdown.
3. Click **Generate Access Token**.
4. In the permissions dialog, check:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`
5. Click **Generate Access Token** and authorize when prompted.
6. This gives you a **short-lived User Access Token** (expires in about 1 hour).

### Option B: Exchange for a long-lived token

Short-lived tokens expire quickly. Exchange yours for a long-lived one:

1. In the Graph API Explorer, note your short-lived token.
2. Make this API call (replace the placeholders):

```
GET https://graph.facebook.com/v21.0/oauth/access_token?
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
GET https://graph.facebook.com/v21.0/me/accounts?access_token=YOUR_LONG_LIVED_USER_TOKEN
```

2. The response lists your Pages. Find your Page and copy its `access_token`.
3. This **Page Access Token** never expires as long as the User Access Token used to generate it was long-lived.

Verify it won't expire:

```
GET https://graph.facebook.com/v21.0/debug_token?
  input_token=YOUR_PAGE_TOKEN&
  access_token=YOUR_PAGE_TOKEN
```

The response should show `"expires_at": 0` (meaning it never expires).

4. Set this as your `META_PAGE_ACCESS_TOKEN` in `.env`.

## Step 7: Find Your Facebook Page ID

The Page ID was returned in Step 6, Option C (the `id` field next to your Page's access token). You can also find it:

1. Go to your Facebook Page.
2. Click **About** (or **Page Transparency** on newer Pages).
3. Scroll to find the **Page ID** — a numeric string like `123456789012345`.

Or use the API:

```
GET https://graph.facebook.com/v21.0/me/accounts?access_token=YOUR_PAGE_TOKEN
```

The `id` field for your Page is the Page ID.

Set this as your `FACEBOOK_PAGE_ID` in `.env`.

## Step 8: Find Your Instagram User ID

Using the Graph API Explorer or a direct API call:

```
GET https://graph.facebook.com/v21.0/YOUR_PAGE_ID?fields=instagram_business_account&access_token=YOUR_PAGE_TOKEN
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

## Step 9: Update Your Deployment

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
POST https://graph.facebook.com/v21.0/{PAGE_ID}/feed
  message: <caption text>
  link: <Fine Art America URL>
```

### Instagram

Instagram publishing is a two-step process:

1. **Create a media container** — tells Instagram to fetch the photo from its public URL:

```
POST https://graph.facebook.com/v21.0/{INSTAGRAM_USER_ID}/media
  image_url: <CloudFront photo URL>
  caption: <caption text>
```

2. **Publish the container:**

```
POST https://graph.facebook.com/v21.0/{INSTAGRAM_USER_ID}/media_publish
  creation_id: <container ID from step 1>
```

**Important:** Instagram fetches the image from the URL you provide, so the photo must be publicly accessible. The pipeline serves photos through CloudFront (`https://your-domain.com/photos/filename.jpg`), which handles this automatically.

## Troubleshooting

### "Invalid OAuth access token"

Your token has expired. Generate a new one following Step 6. Use Option C for a never-expiring Page Access Token.

### "Unsupported post request" on Instagram

- Verify your Instagram account is a **Professional** account (Business or Creator).
- Verify it's linked to the same Facebook Page your token is for.
- Check that the image URL is publicly accessible (try opening it in an incognito browser window).

### "Application does not have permission"

- Verify you've granted `pages_manage_posts` and `instagram_content_publish`.
- If in Development Mode, make sure you're using an account that's an admin, developer, or tester of the app.

### Instagram container status stuck at "IN_PROGRESS"

Instagram needs to download and process the image. This usually takes a few seconds but can take up to a minute. If it stays stuck:

- Check that the image URL is publicly accessible.
- Check that the image is JPEG or PNG and under 8MB.
- Try a different image to rule out format issues.

### Can't find Instagram Business Account ID

- Make sure the Instagram account is Professional (Business or Creator), not Personal.
- Make sure it's linked to the Facebook Page in Instagram's settings (not just Facebook's).
- The link can take a few minutes to propagate — wait and retry the API call.

## Token Maintenance

| Token type | Lifespan | Action needed |
|------------|----------|---------------|
| Short-lived User Token | ~1 hour | Don't use for deployment |
| Long-lived User Token | ~60 days | Exchange before expiry |
| Page Access Token (from long-lived User Token) | Never expires | None — use this one |

**Recommendation:** Always use a never-expiring Page Access Token (Step 6, Option C) for deployment. Set a calendar reminder to check it every few months in case Meta revokes it due to password changes or security events.
