const DEFAULT_GATEWAY_BASE = "http://127.0.0.1:8787";
const DEFAULT_PROMPT_SETTINGS = {
  sessionInjectPrompt: "总结后支持后续检索，并保留最关键的证据段落。",
  askPrefix: "请基于当前会话里已注入的网页内容回答。",
  defaultCaptureMode: "full-content",
};
const DEFAULT_THEME_SETTINGS = {
  theme: "system",
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["gatewayBase", "promptSettings", "themeSettings"]);
  if (!current.gatewayBase) {
    await chrome.storage.local.set({ gatewayBase: DEFAULT_GATEWAY_BASE });
  }
  if (!current.promptSettings) {
    await chrome.storage.local.set({ promptSettings: DEFAULT_PROMPT_SETTINGS });
  }
  if (!current.themeSettings) {
    await chrome.storage.local.set({ themeSettings: DEFAULT_THEME_SETTINGS });
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
    case "getPromptSettings":
      return getPromptSettings();
    case "savePromptSettings":
      return savePromptSettings(message.payload);
    case "getThemeSettings":
      return getThemeSettings();
    case "saveThemeSettings":
      return saveThemeSettings(message.payload);
    case "listTabs":
      return listTabs();
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

async function getPromptSettings() {
  const stored = await chrome.storage.local.get(["promptSettings"]);
  return {
    promptSettings: {
      ...DEFAULT_PROMPT_SETTINGS,
      ...(stored.promptSettings || {}),
    },
  };
}

async function savePromptSettings(payload) {
  const next = {
    ...DEFAULT_PROMPT_SETTINGS,
    ...(payload || {}),
  };
  await chrome.storage.local.set({ promptSettings: next });
  return { promptSettings: next };
}

async function getThemeSettings() {
  const stored = await chrome.storage.local.get(["themeSettings"]);
  return {
    themeSettings: {
      ...DEFAULT_THEME_SETTINGS,
      ...(stored.themeSettings || {}),
    },
  };
}

async function saveThemeSettings(payload) {
  const next = {
    ...DEFAULT_THEME_SETTINGS,
    ...(payload || {}),
  };
  await chrome.storage.local.set({ themeSettings: next });
  return { themeSettings: next };
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

async function listTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return {
    tabs: tabs
      .filter((tab) => typeof tab.id === "number" && isInjectableUrl(tab.url))
      .map((tab) => ({
        id: tab.id,
        title: tab.title || tab.url || `Tab ${tab.id}`,
        url: tab.url || "",
        active: Boolean(tab.active),
      })),
  };
}

async function injectCurrentPage(payload) {
  const { gatewayBase, sessionId } = await getGatewaySettings();
  const pages = await extractSelectedPages(payload);
  const openclaw = normalizeOpenClawPayload(payload.openclaw);
  const response = await postJson(`${gatewayBase}/inputs/inject`, {
    sessionId: payload.sessionId || sessionId || undefined,
    source: "browser_sidebar_extension",
    page: buildCombinedPage(pages, payload.captureMode || "full-content"),
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

async function extractSelectedPages(payload) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const activeTab = tabs.find((tab) => tab.active && typeof tab.id === "number");
  const requestedIds = Array.isArray(payload.tabIds) && payload.tabIds.length
    ? payload.tabIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : activeTab?.id
      ? [activeTab.id]
      : [];
  if (!requestedIds.length) {
    throw new Error("No selectable tab found for injection.");
  }

  const selectedTabs = tabs.filter((tab) => requestedIds.includes(tab.id));
  const captureMode = payload.captureMode || "full-content";
  const pages = [];
  for (const tab of selectedTabs) {
    if (!tab.id || !isInjectableUrl(tab.url)) {
      continue;
    }
    if (captureMode === "url-reference") {
      pages.push({
        title: tab.title || tab.url || `Tab ${tab.id}`,
        url: tab.url || "",
        selectedText: "",
        headings: [],
        paragraphs: [],
        content: "",
        capturedAt: new Date().toISOString(),
        extractionMode: "url-reference",
      });
      continue;
    }
    pages.push(await extractTabPageContext(tab.id));
  }
  if (!pages.length) {
    throw new Error("No supported tab content could be extracted.");
  }
  return pages;
}

function buildCombinedPage(pages, captureMode) {
  const combinedTitle = pages.length === 1 ? pages[0].title : `Workspace (${pages.length} tabs)`;
  const combinedUrl = pages.length === 1 ? pages[0].url : "multi://browser-tabs";
  const sections = pages.map((page, index) => {
    const header = [
      `Tab ${index + 1}: ${page.title}`,
      `URL: ${page.url}`,
    ];
    if (captureMode === "url-reference") {
      header.push("Mode: url-reference");
      return header.join("\n");
    }
    const body = page.content || page.paragraphs?.join("\n\n") || "";
    return [...header, body].filter(Boolean).join("\n");
  });
  return {
    title: combinedTitle,
    url: combinedUrl,
    content: sections.join("\n\n---\n\n").slice(0, 120000),
    headings: pages.flatMap((page) => page.headings || []).slice(0, 60),
    capturedAt: new Date().toISOString(),
    extractionMode: captureMode === "url-reference" ? "url-reference" : "paragraphs",
    tabs: pages.map((page) => ({ title: page.title, url: page.url })),
  };
}

async function extractTabPageContext(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
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
    throw new Error(`Failed to extract tab page context: ${tabId}`);
  }

  return result;
}

function isInjectableUrl(url) {
  return typeof url === "string" && /^(https?:\/\/)/i.test(url);
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch (error) {
    throw new Error(buildFetchFailureMessage("GET", url, error));
  }
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return await response.json();
}

async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(buildFetchFailureMessage("POST", url, error));
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} failed with ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function buildFetchFailureMessage(method, url, error) {
  const target = new URL(url);
  return [
    `${method} ${url} failed: ${String(error?.message || error)}`,
    "",
    `本地 adapter gateway 不可达：${target.origin}`,
    "请先启动 longdoc gateway，例如：",
    "scripts/start_gateway.sh --port 8787 --data-dir .gateway_data",
  ].join("\n");
}
