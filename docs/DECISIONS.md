# Architecture Decisions

## Badge UX
- **Positioning**: 6 presets (corners + mid-edges), drag-free for elder accessibility
- **Scaling**: Uses rem units, scales with browser zoom automatically  
- **Shadow DOM**: Inline styles only to avoid CSP issues in Chrome/Safari

## SPA Detection  
- **Dual triggers**: History API patches + debounced MutationObserver (500-800ms)
- **Content signature**: CRC32 of main content areas, ignore ad/widget nodes
- **Per-origin cooldown**: 30-60 min to avoid API spam on route changes

## Server Architecture
- **URL fetching**: Server-side re-fetch (not client-side content send) for privacy/consistency
- **Staged timeouts**: 2s DNS, 2s TLS, 3s first byte, 3s body (10s total)
- **Redirect handling**: Follow â‰¤3 hops, block private IPs (SSRF guard)

## Caching Strategy
- **Keys**: hash(final_url_sans_tracker_params + title_norm + body_excerpt_norm)  
- **TTL**: 24h-7d with ETag support for bandwidth savings
- **Storage**: Start in-proc LRU, migrate to Redis for horizontal scaling

## Content Scoring
- **Tier-0**: Domain reputation + URL/HTML heuristics (always fast)
- **Tier-1**: LLM summaries for paid users on ambiguous cases only (â‰¤20% of checks)
- **Domain seed**: Curated 100-200 high-impact domains, grow 10-20/week from traffic

## Privacy & Data
- **Extension**: No raw page content stored, only normalized URLs + verdicts
- **Server**: Purge raw URLs after 30-60 days, keep aggregated counts only
- **Caregivers**: Weekly digest shows counts + domain labels, never raw URLs

These decisions optimize for elder accessibility, privacy, performance, and maintainability.
