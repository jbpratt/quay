# Netlify PR Preview Setup Guide

This document explains how to set up and secure the automated Netlify PR preview deployments for the Quay web UI.

## Overview

The GitHub Actions workflow in `.github/workflows/netlify-preview.yaml` deploys PR previews to Netlify using slash commands. Maintainers can comment `/netlify` or `/preview` on any PR (including fork PRs) to trigger a deployment with a fully functional mocked backend.

## Security Features

Our workflow implements multiple layers of security to prevent abuse:

### 1. Permission-Based Access Control ✅
```yaml
if: |
  github.event.comment.author_association == 'OWNER' ||
  github.event.comment.author_association == 'MEMBER' ||
  github.event.comment.author_association == 'COLLABORATOR'
```
**What it does:** Only allows repository owners, members, and collaborators to trigger deployments.

**Why:** Protects `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` secrets from unauthorized access. Untrusted users cannot trigger deployments.

**Impact:** Fork PR authors cannot self-deploy. Maintainers review code first, then trigger deployment.

### 2. Slash Command Trigger ✅
```yaml
if: |
  contains(github.event.comment.body, '/netlify') ||
  contains(github.event.comment.body, '/preview')
```
**What it does:** Only runs when maintainers explicitly comment `/netlify` or `/preview`.

**Why:** Gives maintainers full control over when previews are created. No automatic deployments.

**Impact:** Saves build minutes. Deployments only happen when requested.

### 3. Fork PR Support ✅
**What it does:** Works with fork PRs because `issue_comment` events run in the main repository context.

**Why:** Maintainers can review fork PR code, then trigger a safe deployment using secrets from the main repo.

**Impact:** External contributors get previews after maintainer review, improving collaboration.

### 4. Timeout Protection ✅
```yaml
timeout-minutes: 10
```
**What it does:** Kills the deployment job after 10 minutes.

**Why:** Prevents hanging builds from consuming runner time.

## Required Secrets

You need to add two secrets to your GitHub repository:

### 1. NETLIFY_AUTH_TOKEN

**How to get it:**
1. Log in to [Netlify](https://app.netlify.com)
2. Go to **User Settings** → **Applications** → **Personal access tokens**
3. Click **New access token**
4. Give it a descriptive name (e.g., "GitHub Actions - Quay PR Previews")
5. Copy the token (you won't see it again!)

**How to add it:**
1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `NETLIFY_AUTH_TOKEN`
4. Value: Paste the token from Netlify
5. Click **Add secret**

### 2. NETLIFY_SITE_ID

**How to get it:**
1. Log in to [Netlify](https://app.netlify.com)
2. Go to your site (or create a new one)
3. Go to **Site settings** → **General** → **Site details**
4. Copy the **API ID** (also called Site ID)

**How to add it:**
1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `NETLIFY_SITE_ID`
4. Value: Paste the site ID from Netlify
5. Click **Add secret**

## Netlify Site Setup

### Initial Setup

Netlify's web UI makes it difficult to create a site without connecting to Git. Use one of these methods:

#### Method 1: Manual Deploy (Easiest)

1. Log in to [Netlify](https://app.netlify.com)
2. Go to **Sites** tab
3. Drag and drop **any folder** into the deploy dropzone (can be an empty folder or folder with a single `index.html`)
4. Netlify creates a site immediately
5. Go to **Site settings** → **General** → **Site details**
6. Copy the **API ID** (this is your `NETLIFY_SITE_ID`)
7. Optionally rename the site under **Site details** → **Site information** → **Change site name**

#### Method 2: Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify sites:create --name quay-ui-preview
# Copy the API ID from the output
```

#### Method 3: Import then Disconnect

1. Create site connected to any GitHub repo
2. Go to **Site settings** → **Build & deploy** → **Build settings**
3. Click **Link to a different repository** → **Stop builds**
4. Get the API ID from **Site settings** → **General** → **Site details**

**Important:** Once created, the site can remain empty. GitHub Actions will handle all deployments.

### Configuration Files

**`web/netlify.toml`**: Contains minimal Netlify-side configuration (SPA redirect only). GitHub Actions handles all builds and deployments, so no build commands are configured in this file.

**`.github/workflows/netlify-preview.yaml`**: Contains the slash command-triggered deployment workflow. Listens for `/netlify` or `/preview` comments on PRs, builds with `MOCK_API=true`, and deploys pre-built assets to Netlify.

### Recommended Settings

In your Netlify site settings:

- **Build settings**: Leave empty (GitHub Actions handles builds)
- **Deploy notifications**: Enable GitHub commit statuses
- **Deploy contexts**: Not needed (GitHub Actions manages this)
- **Environment variables**: Not needed (mocks are self-contained)

## How It Works

### Triggering a Deployment:

1. **Maintainer comments on PR**: Any repository owner, member, or collaborator comments `/netlify` or `/preview` on a PR
2. **Workflow validates**: Checks that it's a PR comment and the commenter has permission
3. **Fetches PR details**: Gets the PR branch, commit SHA, and source repository (works for forks!)
4. **Checks out code**: Clones the code from the PR's head branch
5. **Builds with mocks**: Installs dependencies and builds with `MOCK_API=true`
6. **Deploys to Netlify**: Deploys to a unique URL with alias `pr-{number}`
7. **Posts result**: actions-netlify automatically comments on the PR with deployment status and preview URL

### Example Workflow:

**Maintainer comments:**
```
/netlify
```

**actions-netlify posts result:**
```
✅ Deploy Preview for quay-ui ready!

🔍 Inspect: https://app.netlify.com/sites/quay-ui/deploys/...
😎 Preview: https://pr-123--quay-ui.netlify.app
```

### Cleanup:

Netlify automatically cleans up old previews after 30 days of inactivity.

## Fork PR Workflow

Fork PRs are **fully supported** with the slash command approach! Here's how it works:

### For Maintainers:

1. **Review the fork PR code carefully** - Always review code before deploying
2. **Comment `/netlify` or `/preview`** - This triggers deployment directly from the fork PR
3. **Wait for deployment** - Workflow checks out fork code, builds, and deploys
4. **Review preview** - Test changes on the live preview URL
5. **Merge if approved** - Standard review process

### For Contributors:

1. **Open PR from your fork** as usual
2. **Request a preview** - Ask maintainers politely: "Could you please trigger a `/netlify` preview?"
3. **Wait for maintainer review** - Maintainers will review code first
4. **Address feedback** - Make any requested changes
5. **Maintainer triggers preview** - After reviewing code, maintainers can safely deploy

### Security Model:

The workflow is secure for fork PRs because:
- ✅ Runs in the **main repository context** (not fork context)
- ✅ **Secrets are protected** (fork authors cannot access them)
- ✅ **Permission check** blocks unauthorized users
- ✅ **Manual trigger** allows maintainers to review code first
- ✅ Works with **any fork** - checks out code from fork repository

## Troubleshooting

### Preview not deploying?

**Check:**
- Is the PR from a fork? (Won't deploy for security)
- Did you modify `web/` files? (Path filter requirement)
- Are secrets set up correctly? (Check GitHub secrets)
- Is the workflow enabled? (Check Actions tab)

### Secrets not working?

**Verify:**
- Secret names are exactly: `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`
- Tokens haven't expired (Netlify tokens don't expire by default)
- Token has correct permissions (should have deploy access)

### Build failing?

**Common causes:**
- Node modules installation failed (check npm version compatibility)
- Build errors with `MOCK_API=true` (test locally first)
- Timeout after 10 minutes (check build performance)

## Cost Considerations

### Netlify Free Tier Limits:
- **Bandwidth**: 100GB/month
- **Build minutes**: 300 minutes/month
- **Concurrent builds**: 1

### Typical Usage:
- Each build: ~2-3 minutes
- Each preview: ~5MB (after compression)
- 100 PRs/month would use ~300 build minutes and ~500MB bandwidth

**Free tier is usually sufficient for most projects.**

### Monitoring Usage:
1. Check Netlify dashboard → **Team settings** → **Usage**
2. Set up email alerts for 80% usage
3. Upgrade to Pro ($19/month) if needed

## Security Best Practices

### ✅ Do:
- Regularly rotate Netlify tokens (every 6-12 months)
- Monitor deployment logs for suspicious activity
- Keep secrets access limited to maintainers only
- Review fork PRs carefully before manual deployment

### ❌ Don't:
- Remove the fork protection check
- Add secrets to fork PRs
- Deploy untrusted code without review
- Share tokens in commit messages or PR comments

## Additional Resources

- [Netlify Deploy Action](https://github.com/nwtgck/actions-netlify)
- [GitHub Actions Security](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [Netlify Build Plugins](https://docs.netlify.com/configure-builds/build-plugins/)

## Support

For issues with:
- **Workflow**: Open an issue in the Quay repository
- **Netlify service**: Contact [Netlify Support](https://www.netlify.com/support/)
- **Security concerns**: Email the maintainers privately
