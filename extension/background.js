const DEFAULT_GATEWAY_BASE = "http://127.0.0.1:8787";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["gatewayBase"]);
  if (!current.gatewayBase) {
    await chrome.storage.local.set({ gatewayBase: DEFAULT_GATEWAY_BASE });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.windowId) {
    return;
  }
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "getGatewaySettings":
      return getGatewaySettings();
    case "saveGatewaySettings":
      return saveGatewaySettings(message.payload);
    case "getOpenClawSettings":
      return getOpenClawSettings();
    case "saveOpenClawSettings":
      return saveOpenClawSettings(message.payload);
    case "validateOpenClawSettings":
      return validateOpenClawSettings(message.payload);
    case "createSession":
      return createSession();
    case "loadSession":
      return loadSession(message.payload?.sessionId);
    case "injectCurrentPage":
      return injectCurrentPage(message.payload || {});
    case "askCurrentSession":
      return askCurrentSession(message.payload || {});
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function getGatewaySettings() {
  const stored = await chrome.storage.local.get(["gatewayBase", "sessionId"]);
  return {
    gatewayBase: stored.gatewayBase || DEFAULT_GATEWAY_BASE,
    sessionId: stored.sessionId || "",
  };
}

async function saveGatewaySettings(payload) {
  const gatewayBase = String(payload?.gatewayBase || "").trim() || DEFAULT_GATEWAY_BASE;
  await chrome.storage.local.set({ gatewayBase });
  return { gatewayBase };
}

async function getOpenClawSettings() {
  const { gatewayBase } = await getGatewaySettings();
  return await getJson(`${gatewayBase}/settings/openclaw`);
}

async function saveOpenClawSettings(payload) {
  const { gatewayBase } = await getGatewaySettings();
  return await postJson(`${gatewayBase}/settings/openclaw`, payload);
}

async function validateOpenClawSettings(payload) {
  const { gatewayBase } = await getGatewaySettings();
  return await postJson(`${gatewayBase}/openclaw/validate`, payload);
}

async function createSession() {
  const { gatewayBase } = await getGatewaySettings();
  const created = await postJson(`${gatewayBase}/sessions/create`, {});
  await chrome.storage.local.set({ sessionId: created.sessionId });
  return created;
}

async function loadSession(sessionId) {
  if (!sessionId) {
    throw new Error("sessionId is required");
  }
  const { gatewayBase } = await getGatewaySettings();
  const loaded = await getJson(`${gatewayBase}/sessions/${sessionId}`);
  await chrome.storage.local.set({ sessionId });
  return loaded;
}

async function injectCurrentPage(payload) {
  const { gatewayBase, sessionId } = await getGatewaySettings();
  const page = await extractActivePageContext();
  const openclaw = normalizeOpenClawPayload(payload.openclaw);
  const response = await postJson(`${gatewayBase}/inputs/inject`, {
    sessionId: payload.sessionId || sessionId || undefined,
    source: "browser_sidebar_extension",
    page: {
      ...page,
      title: payload.title || page.title,
      url: payload.url || page.url,
      content: payload.content || page.content,
    },
    input: {
      instruction: payload.instruction || "",
    },
    ...(openclaw ? { openclaw } : {}),
  });
  if (response.sessionId) {
    await chrome.storage.local.set({ sessionId: response.sessionId });
  }
  return response;
}

async function askCurrentSession(payload) {
  const { gatewayBase, sessionId } = await getGatewaySettings();
  const activeSessionId = payload.sessionId || sessionId;
  if (!activeSessionId) {
    throw new Error("No active session. Inject a page first or create a new session.");
  }
  const response = await postJson(`${gatewayBase}/ask`, {
    sessionId: activeSessionId,
    question: payload.question || "",
    ...(normalizeOpenClawPayload(payload.openclaw) ? { openclaw: normalizeOpenClawPayload(payload.openclaw) } : {}),
  });
  if (response.sessionId) {
    await chrome.storage.local.set({ sessionId: response.sessionId });
  }
  return response;
}

function normalizeOpenClawPayload(openclaw = {}) {
  const hasOverride =
    typeof openclaw.model === "string" ||
    typeof openclaw.agent === "string" ||
    typeof openclaw.fallbackToLocal === "boolean";
  if (!hasOverride) {
    return null;
  }
  return {
    model: String(openclaw.model || "openclaw:main"),
    agent: String(openclaw.agent || ""),
    fallbackToLocal: Boolean(openclaw.fallbackToLocal ?? true),
  };
}

async function extractActivePageContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("Unable to resolve current tab");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const title = document.title || "";
      const url = location.href;
      const selectedText = String(window.getSelection?.() || "").trim();
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .map((node) => normalize(node.textContent || ""))
        .filter(Boolean)
        .slice(0, 20);

      const paragraphs = Array.from(document.querySelectorAll("main p, article p, p"))
        .map((node) => normalize(node.textContent || ""))
        .filter((text) => text.length >= 10)
        .slice(0, 120);

      const content = paragraphs.length
        ? paragraphs.join("\n\n")
        : normalize(document.body?.innerText || "").slice(0, 120000);

      return {
        title,
        url,
        selectedText,
        headings,
        paragraphs,
        content: content.slice(0, 120000),
        capturedAt: new Date().toISOString(),
        extractionMode: paragraphs.length ? "paragraphs" : "body-fallback",
      };

      function normalize(value) {
        return value.replace(/\s+/g, " ").trim();
      }
    },
  });

  if (!result) {
    throw new Error("Failed to extract current page context");
  }

  return result;
}

async function getJson(url) {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return await response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} failed with ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}
