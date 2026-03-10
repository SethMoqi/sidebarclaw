# SidebarClaw

SidebarClaw is a ready-to-run Chromium sidebar extension for sending web pages to a local OpenClaw session.

It includes:

- a Chromium extension in `extension/`
- a local adapter gateway in `src/longdoc/gateway.py`
- an optional local long-document fallback when OpenClaw is unavailable

## What It Does

SidebarClaw lets you:

- connect the extension to your own local OpenClaw gateway
- configure your own gateway URL, token, model, and agent
- inject the current tab or multiple open tabs into a session
- continue chatting against the injected page content
- keep API credentials separated from page content and session records
- archive or auto-close sessions with a structured summary
- apply prompt-injection protection to untrusted page content

## Requirements

- Python 3.11 or newer
- Chromium, Chrome, or Edge
- a reachable OpenClaw gateway if you want live OpenClaw responses

## Quick Start

### 1. Start the local adapter

From the project root:

```bash
scripts/start_gateway.sh --port 8787 --data-dir .gateway_data
```

If the command succeeds, the adapter will listen on:

```text
http://127.0.0.1:8787
```

### 2. Load the extension

1. Open `chrome://extensions` or `edge://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select the `extension/` folder from this repository

### 3. Open the settings page

1. Open the extension details page
2. Click `Extension options`
3. Fill in:
   - `Local Adapter URL`
   - `OpenClaw Gateway URL`
   - `Gateway Token` if needed
   - `Model`
   - `Agent` if you want a fixed workflow
4. Click `Test Connection`
5. Save the settings

### 4. Use the sidebar

1. Open any web page
2. Open the SidebarClaw side panel
3. Optionally choose one or more tabs
4. Click `Inject Selected Tabs`
5. Ask follow-up questions in the chat box

If no tab is selected, SidebarClaw automatically falls back to the current active tab.

## Session Behavior

- SidebarClaw dynamically resolves the latest usable session when the sidebar opens
- closed or archived sessions are not reused as the active session
- if a session becomes archived, SidebarClaw switches to a fresh or still-active session automatically
- sessions can auto-close with a structured summary after inactivity or when the sidebar closes

## Security Behavior

- OpenClaw credentials are stored separately from page content and session content
- injected page content is wrapped as untrusted data
- prompt-injection protection can be configured in the settings page
- page content must not override system instructions, plugin policy, or credential handling

## Packaging the Extension

To build a distributable zip:

```bash
scripts/package_extension.sh
```

The packaged extension will be written to:

```text
dist/sidebarclaw-extension.zip
```

## Repository Layout

- `extension/` browser extension
- `src/longdoc/` local adapter gateway and fallback logic
- `scripts/start_gateway.sh` adapter launcher
- `scripts/package_extension.sh` extension packager

## Troubleshooting

### The extension cannot connect

- make sure the local adapter is running on `http://127.0.0.1:8787`
- reload the extension after code changes
- open the extension options page and run `Test Connection`

### The sidebar opens an archived session

Reload the extension once. SidebarClaw will resolve the latest active session dynamically and stop reusing archived sessions.

### Service worker registration failed

Reload the unpacked extension after pulling the latest files.

## License

This project is released under the MIT License. See [LICENSE](/Volumes/ACSIS/openclaw/.codex/worktrees/bb38/codex-workspace/LICENSE).
