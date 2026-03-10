const prompts = [
  { title: "快速总结", body: "总结这页的核心观点、结论和最值得保留的 3 个信息点。" },
  { title: "证据提取", body: "只基于当前页面证据回答，并列出最相关的原文片段。" },
  { title: "结构化输出", body: "请将这页整理成适合知识库归档的结构化摘要。" },
];

const state = {
  sessionId: "",
  selectedTabIds: new Set(),
  availableTabs: [],
  promptSettings: {
    sessionOpeningPrompt: "",
    sessionInjectPrompt: "",
    askPrefix: "",
    sessionClosurePrompt: "",
    protectionMode: "strict",
    autoCloseSummary: true,
    idleTimeoutMinutes: 10,
    defaultCaptureMode: "full-content",
  },
  captureMode: "full-content",
  lastTurnCount: 0,
  lastTurnSignature: "",
  pollTimer: null,
  theme: "system",
  isWaitingForResponse: false,
};

const statusPulse = document.getElementById("statusPulse");
const connectionStatus = document.getElementById("connectionStatus");
const sessionLabel = document.getElementById("sessionLabel");
const sessionMeta = document.getElementById("sessionMeta");
const tabSummary = document.getElementById("tabSummary");
const selectedTabsLabel = document.getElementById("selectedTabsLabel");
const promptList = document.getElementById("promptList");
const instruction = document.getElementById("instruction");
const question = document.getElementById("question");
const messages = document.getElementById("messages");
const tabList = document.getElementById("tabList");

document.getElementById("newSessionBtn").addEventListener("click", createSession);
document.getElementById("refreshSessionBtn").addEventListener("click", refreshSessionNow);
document.getElementById("openSettingsBtn").addEventListener("click", openSettingsPage);
document.getElementById("refreshStatusBtn").addEventListener("click", bootstrap);
document.getElementById("refreshTabsBtn").addEventListener("click", loadTabs);
document.getElementById("selectActiveBtn").addEventListener("click", selectActiveTabOnly);
document.getElementById("selectAllBtn").addEventListener("click", selectAllTabs);
document.getElementById("injectPage").addEventListener("click", injectPage);
document.getElementById("sendQuestion").addEventListener("click", sendQuestion);
document.getElementById("modeFullContent").addEventListener("click", () => setCaptureMode("full-content"));
document.getElementById("modeUrlReference").addEventListener("click", () => setCaptureMode("url-reference"));
window.addEventListener("pagehide", handlePageHide);

bootstrap();
renderPromptList();

async function bootstrap() {
  setStatus("idle", "正在同步状态");
  await Promise.all([renderConnectionSummary(), loadTabs(), loadPromptSettings(), loadThemeSettings()]);

  const gateway = await sendRuntimeMessage("getGatewaySettings");
  state.sessionId = gateway.sessionId || "";
  if (state.sessionId) {
    try {
      const loaded = await sendRuntimeMessage("loadSession", { sessionId: state.sessionId });
      applySession(loaded.session);
      startPolling();
      return;
    } catch (_error) {
      stopPolling();
    }
  }

  await createSession();
}

async function loadThemeSettings() {
  const result = await sendRuntimeMessage("getThemeSettings");
  state.theme = result.themeSettings?.theme || "system";
  applyTheme(state.theme);
}

async function renderConnectionSummary() {
  const [gateway, openclaw] = await Promise.all([
    sendRuntimeMessage("getGatewaySettings"),
    sendRuntimeMessage("getOpenClawSettings"),
  ]);
  const settings = openclaw.settings || {};
  const configured = Boolean(settings.baseUrl);
  connectionStatus.textContent = configured ? `已连接 ${settings.agent || settings.model || "OpenClaw"}` : "仅本地 fallback";
  setStatus(configured ? "ok" : "warn", connectionStatus.textContent);
  sessionMeta.textContent = configured
    ? `Gateway 已配置 | model: ${settings.model || "openclaw:main"}${settings.agent ? ` | agent: ${settings.agent}` : ""}`
    : `Gateway 已配置到 ${gateway.gatewayBase}，当前 OpenClaw 未配置`;
}

async function loadPromptSettings() {
  const result = await sendRuntimeMessage("getPromptSettings");
  state.promptSettings = {
    ...state.promptSettings,
    ...(result.promptSettings || {}),
  };
  state.captureMode = state.promptSettings.defaultCaptureMode || "full-content";
  instruction.value = state.promptSettings.sessionInjectPrompt || "";
  setCaptureMode(state.captureMode);
}

async function loadTabs() {
  const result = await sendRuntimeMessage("listTabs");
  state.availableTabs = result.tabs || [];
  tabSummary.textContent = `${state.availableTabs.length} 个标签页`;
  if (!state.selectedTabIds.size) {
    for (const tab of state.availableTabs) {
      if (tab.active) {
        state.selectedTabIds.add(tab.id);
      }
    }
  } else {
    const ids = new Set(state.availableTabs.map((tab) => tab.id));
    state.selectedTabIds = new Set([...state.selectedTabIds].filter((id) => ids.has(id)));
  }
  renderTabs();
}

function renderTabs() {
  tabList.innerHTML = "";
  for (const tab of state.availableTabs) {
    const label = document.createElement("label");
    label.className = `tab-item ${state.selectedTabIds.has(tab.id) ? "active" : ""}`;
    label.innerHTML = `
      <input type="checkbox" ${state.selectedTabIds.has(tab.id) ? "checked" : ""} />
      <div>
        <strong>${escapeHtml(tab.title)}</strong>
        <span>${escapeHtml(tab.url)}</span>
      </div>
    `;
    label.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) {
        state.selectedTabIds.add(tab.id);
      } else {
        state.selectedTabIds.delete(tab.id);
      }
      updateTabSelectionSummary();
      renderTabs();
    });
    tabList.appendChild(label);
  }
  updateTabSelectionSummary();
}

function updateTabSelectionSummary() {
  const count = state.selectedTabIds.size;
  selectedTabsLabel.textContent = count ? `已选 ${count} 个标签页` : "未选择";
}

function renderPromptList() {
  promptList.innerHTML = "";
  for (const prompt of prompts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt ghost";
    button.innerHTML = `<strong>${prompt.title}</strong><span>${prompt.body}</span>`;
    button.addEventListener("click", () => {
      question.value = prompt.body;
    });
    promptList.appendChild(button);
  }
}

async function createSession() {
  if (state.sessionId && state.promptSettings.autoCloseSummary) {
    try {
      await sendRuntimeMessage("finalizeCurrentSession", { reason: "new_session_created" });
    } catch (_error) {
      // Ignore finalize errors during session rollover.
    }
  }
  const created = await sendRuntimeMessage("createSession");
  state.sessionId = created.session.id;
  applySession(created.session);
  messages.innerHTML = "";
  appendMessage("assistant", "已创建新会话。默认注入提示词已就绪，可以直接注入所选标签页。");
  instruction.value = state.promptSettings.sessionInjectPrompt || "";
  startPolling();
}

async function injectPage() {
  if (!state.selectedTabIds.size) {
    appendMessage("assistant", "先选择至少一个标签页。");
    return;
  }
  setStatus("busy", "正在注入标签页");
  const result = await sendRuntimeMessage("injectCurrentPage", {
    instruction: instruction.value.trim(),
    tabIds: [...state.selectedTabIds],
    captureMode: state.captureMode,
  });
  if (result.sessionId) {
    const loaded = await sendRuntimeMessage("loadSession", { sessionId: result.sessionId });
    applySession(loaded.session);
  } else {
    appendMessage("assistant", result.output?.text || "注入完成。");
  }
  setStatus("ok", "注入完成");
}

async function sendQuestion() {
  const text = question.value.trim();
  if (!text) {
    return;
  }
  question.value = "";
  state.isWaitingForResponse = true;
  setStatus("busy", "等待 OpenClaw 响应");
  const finalQuestion = state.promptSettings.askPrefix
    ? `${state.promptSettings.askPrefix}\n\n用户问题：${text}`
    : text;
  try {
    const result = await sendRuntimeMessage("askCurrentSession", {
      question: finalQuestion,
    });
    if (result.sessionId) {
      state.sessionId = result.sessionId;
      const loaded = await sendRuntimeMessage("loadSession", { sessionId: state.sessionId });
      applySession(loaded.session);
    }
    triggerBurstRefresh();
    setStatus("busy", "问题已提交，等待响应");
  } catch (error) {
    state.isWaitingForResponse = false;
    setStatus("error", "响应失败");
    appendMessage("assistant", `请求失败：${error.message}`);
  }
}

function buildAnswer(result) {
  if (result.answerText) {
    return result.answerText;
  }
  if (Array.isArray(result.evidence) && result.evidence.length) {
    return result.evidence.map((item, index) => `${index + 1}. [${item.sectionTitle}] ${item.snippet}`).join("\n\n");
  }
  return JSON.stringify(result, null, 2);
}

function applySession(session) {
  const turns = session.turns || [];
  state.lastTurnCount = turns.length;
  state.lastTurnSignature = getTurnSignature(turns);
  sessionLabel.textContent = session.id;
  const openclaw = session.openclaw || {};
  sessionMeta.textContent = `status: ${session.status || "active"} | turns: ${state.lastTurnCount} | model: ${openclaw.model || "openclaw:main"}${openclaw.agent ? ` | agent: ${openclaw.agent}` : ""}`;
  restoreMessages(turns);
}

function restoreMessages(turns) {
  messages.innerHTML = "";
  if (!turns.length) {
    appendMessage("assistant", "会话已恢复。先注入所选标签页，或直接提问。");
    return;
  }
  for (const turn of turns) {
    const role = turn.role === "system" ? "assistant" : turn.role;
    appendMessage(role, normalizeTurnText(turn), { status: turn.status || "" });
  }
}

function normalizeTurnText(turn) {
  const raw = typeof turn.text === "string" ? turn.text : "";
  try {
    const payload = JSON.parse(raw);
    if (typeof payload.answerText === "string" && payload.answerText.trim()) {
      return payload.answerText.trim();
    }
    if (payload.output?.text) {
      return payload.output.text;
    }
  } catch (_error) {
    // Ignore JSON parse errors.
  }
  return raw;
}

function appendMessage(role, text, options = {}) {
  const node = document.createElement("div");
  node.className = `message ${role}${options.status ? ` ${options.status}` : ""}`;
  node.textContent = text;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(refreshSessionSilently, 1200);
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function refreshSessionSilently() {
  if (!state.sessionId) {
    return;
  }
  try {
    const loaded = state.isWaitingForResponse
      ? await sendRuntimeMessage("refreshSessionRemote", { sessionId: state.sessionId })
      : await sendRuntimeMessage("loadSession", { sessionId: state.sessionId });
    const nextTurns = loaded.session.turns?.length || 0;
    const nextSignature = getTurnSignature(loaded.session.turns || []);
    if (nextTurns !== state.lastTurnCount || nextSignature !== state.lastTurnSignature) {
      applySession(loaded.session);
      const latestRole = loaded.session.turns?.[loaded.session.turns.length - 1]?.role || "";
      const latestStatus = loaded.session.turns?.[loaded.session.turns.length - 1]?.status || "";
      if (state.isWaitingForResponse && latestRole === "assistant" && latestStatus !== "pending") {
        state.isWaitingForResponse = false;
        setStatus("ok", "已收到响应");
      } else if (state.isWaitingForResponse) {
        setStatus("busy", "OpenClaw 正在处理中");
      } else {
        setStatus("ok", "会话已更新");
      }
    }
  } catch (_error) {
    setStatus("warn", "会话刷新失败");
  }
}

async function refreshSessionNow() {
  if (!state.sessionId) {
    setStatus("warn", "当前没有会话可刷新");
    return;
  }
  setStatus("busy", "正在同步远端会话");
  try {
    const refreshed = await sendRuntimeMessage("refreshSessionRemote", { sessionId: state.sessionId });
    if (refreshed.session) {
      applySession(refreshed.session);
    }
    const latestStatus = refreshed.session?.turns?.[refreshed.session.turns.length - 1]?.status || "";
    if (latestStatus === "pending") {
      setStatus("busy", "OpenClaw 仍在处理中");
    } else {
      state.isWaitingForResponse = false;
      setStatus("ok", "会话已手动刷新");
    }
  } catch (error) {
    setStatus("error", `刷新失败：${error.message}`);
  }
}

function triggerBurstRefresh() {
  window.setTimeout(() => refreshSessionSilently(), 300);
  window.setTimeout(() => refreshSessionSilently(), 900);
  window.setTimeout(() => refreshSessionSilently(), 1800);
}

function setCaptureMode(mode) {
  state.captureMode = mode;
  document.getElementById("modeFullContent").classList.toggle("active", mode === "full-content");
  document.getElementById("modeUrlReference").classList.toggle("active", mode === "url-reference");
}

function selectActiveTabOnly() {
  state.selectedTabIds = new Set(state.availableTabs.filter((tab) => tab.active).map((tab) => tab.id));
  renderTabs();
}

function selectAllTabs() {
  state.selectedTabIds = new Set(state.availableTabs.map((tab) => tab.id));
  renderTabs();
}

function setStatus(kind, text) {
  statusPulse.className = `status-pulse ${kind}`;
  connectionStatus.textContent = text;
}

function sendRuntimeMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Unknown extension error"));
        return;
      }
      resolve(response.result);
    });
  });
}

function openSettingsPage() {
  chrome.runtime.openOptionsPage();
}

function handlePageHide() {
  if (!state.sessionId || !state.promptSettings.autoCloseSummary) {
    return;
  }
  chrome.runtime.sendMessage({
    type: "finalizeCurrentSession",
    payload: { reason: "sidepanel_pagehide" },
  });
}

function applyTheme(mode) {
  const resolved = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.body.dataset.theme = resolved;
}

function getTurnSignature(turns) {
  if (!turns.length) {
    return "";
  }
  const lastTurn = turns[turns.length - 1];
  return `${turns.length}:${lastTurn.role || ""}:${lastTurn.status || ""}:${normalizeTurnText(lastTurn)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
