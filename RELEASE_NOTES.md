# SidebarClaw v0.1.0

SidebarClaw v0.1.0 is the first public release of the project.

## What is included

- A Chromium extension with a chat-first side panel
- A local adapter gateway for connecting the extension to OpenClaw
- Configurable gateway URL, token, model, and agent settings
- Current-tab and multi-tab page injection
- Async session refresh and dynamic session recovery
- Prompt-injection protection for untrusted page content
- Automatic session finalization with structured summaries

## Good fit for

- Local OpenClaw users who want a simple browser workflow
- Page-aware research and follow-up questions
- Multi-tab context collection before sending a prompt

## Before you start

- Install Python 3.11 or newer
- Start the local adapter with `scripts/start_gateway.sh`
- Load the unpacked extension from the `extension/` folder
- Open the extension options page and enter your own OpenClaw gateway settings

## Distribution artifact

The packaged extension zip is produced by:

```bash
scripts/package_extension.sh
```

The output file is:

```text
dist/sidebarclaw-extension.zip
```
