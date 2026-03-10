# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-10

### Added

- Chromium side panel extension for OpenClaw-backed page chat
- Local adapter gateway for session, injection, and fallback orchestration
- Settings page for gateway URL, token, model, agent, theme, and prompt policy
- Multi-tab injection with current-tab fallback and manual refresh controls
- Session lifecycle handling with archive summaries and dynamic session recovery
- Prompt-injection guardrails for untrusted page content
- Packaging script for a ready-to-load extension zip

### Changed

- Renamed the extension to `SidebarClaw`
- Reworked the UI around a chat-first side panel
- Switched published documentation to English and simplified it for end users

### Security

- Separated gateway credentials from page content and session records
- Added strict prompt-wrapping for injected page content
