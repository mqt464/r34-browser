# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - ' + $date + '

### Added
- RealBooru provider via scraping (list + post pages) with per-card lazy enrichment of actual mp4/webm media when visible.
- Provider toggle button next to the search box (session-only) that switches Search provider without changing the default.
- Per‑group provider selection; Home feed fetches each group from its own provider.
- CORS proxy support improvements with automatic format detection and a proxy auto‑test in Settings.
- "Use proxy for media" toggle (off by default) to route images/videos through the proxy when needed.
- Media skeletons on each card while image/video loads, eliminating empty placeholders.

### Changed
- Settings: Source controls moved into API Access; added subheadings (Default Provider, CORS Proxy).
- Provider dropdowns use icons and polished dropdowns; searchbar button matches input height.
- Autocomplete updates immediately when provider is toggled; uses the active provider for both suggestions and metadata enrichment.
- RealBooru list-page detection for videos (blue border/title) and direct original URL candidates from thumbnail MD5.

### Fixed
- Search pagination now consistently respects the active provider.
- Tag metadata (type and counts) now loads correctly for Rule34 after toggling from RealBooru.
- Prevented settings render crashes after removing the Test API button.

### Notes
- RealBooru API is offline; scraping requires a proxy for HTML endpoints. Images/videos usually load direct, but enable "Use proxy for media" if your browser blocks hotlinking.


## [0.2.1] - 2025-09-19

### Fixed
- Centered spinners in CORS Proxy, User ID, and API Key fields (no transform conflict).
- Live proxy updates now apply immediately: autocomplete re-fetches and Search reloads using the new proxy.
- Autocomplete metadata enrichment consistently uses the active provider after toggling.

