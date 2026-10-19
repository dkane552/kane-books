#!/usr/bin/env bash
# Build the static app and publish it to the `deploy` branch.
# Cloudflare Pages watches that branch and serves the files as-is (no build step there).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .output
npx vite build
test -f .output/public/index.html

# Cloudflare answers a missing file with index.html (SPA fallback). With "immutable" on /assets/*,
# a browser that asked for a file a moment before it went live keeps that HTML for a year and the
# app hangs on "Loading". Revalidate instead: unchanged files cost a quick 304.
# Security headers on every page: no framing by other sites (clickjacking), no MIME sniffing,
# HTTPS only, no full URLs sent to other sites, no location or microphone access.
cat > .output/public/_headers <<'HEADERS'
/*
  X-Frame-Options: DENY
  Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: geolocation=(), microphone=(), payment=(), usb=()
/assets/*
  cache-control: public, max-age=0, must-revalidate
HEADERS

SRC_SHA=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
git worktree add --force "$TMP" deploy 2>/dev/null || git worktree add --force -b deploy "$TMP"
find "$TMP" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R .output/public/. "$TMP"/
git -C "$TMP" add -A
if git -C "$TMP" diff --cached --quiet; then
  echo "No changes to deploy."
else
  git -C "$TMP" commit -q -m "Deploy ${SRC_SHA}"
  git -C "$TMP" push -q origin deploy
  echo "Deployed ${SRC_SHA}. Cloudflare Pages publishes it in about a minute."
fi
git worktree remove --force "$TMP"
