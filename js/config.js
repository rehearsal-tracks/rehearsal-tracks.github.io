// js/config.js — single source of truth for the R2 base URL.
// Served via a Cloudflare custom domain (HTTP/2 + HTTP/3), NOT the pub-*.r2.dev dev URL, which is
// HTTP/1.1-only and rate-limited — the custom domain lifts the ~6-connection-per-host cap that made
// full offline downloads crawl. See ~/.claude/plans/2026-07-07-r2-custom-domain-http2-runbook.md.
export const R2_BASE = "https://media.andrewbray.us";
