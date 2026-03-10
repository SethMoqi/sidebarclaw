const prompts = [
  { title: "快速总结", body: "总结这页的核心观点、结论和最值得保留的 3 个信息点。" },
  { title: "证据提取", body: "只基于当前页面证据回答，并列出最相关的原文片段。" },
  { title: "结构化输出", body: "请将这页整理成适合知识库归档的结构化摘要。" },
];

const connectionStatus = document.getElementById("connectionStatus");
const connectionSummary = document.getElementById("connectionSummary");
const sessionLabel = document.getElementById("sessionLabel");
const sessionMeta = document.getElementById("sessionMeta");
const promptList = document.getElementById("promptList");
const instruction = document.getElementById("instruction");
const question = document.getElementById("question");
const messages = document.getElementById("messages");

document.getElementById("newSessionBtn").addEventListener("click", createSession);
document.getElementById("openSettingsBtn").addEventListener("click", openSettingsPage);
document.getElementById("openSettingsSecondaryBtn").addEventListener("click", openSettingsPage);
document.getElementById("refreshStatusBtn").addEventListener("click", bootstrap);
document.getElementById("injectPage").addEventListener("click", injectPage);
document.getElementById("sendQuestion").addEventListener("click", sendQuestion);

bootstrap();
renderPromptList();

async function bootstrap() {
  await renderConnectionSummary();

  const gateway = await sendRuntimeMessage("getGatewaySettings");
  if (gateway.sessionId) {
    try {
      const loaded = await sendRuntimeMessage("loadSession", { sessionId: gateway.sessionId });
      renderSession(loaded.session);
      restoreMessages(loaded.session.turns || []);
      return;
    } catch (_error) {
      // Fall through to create a new session.
    }
  }

  await createSession();
}

async function renderConnectionSummary() {
  const [gateway, openclaw] = await Promise.all([
    sendRuntimeMessage("getGatewaySettings"),
    sendRuntimeMessage("getOpenClawSettings"),
  ]);
  const settings = openclaw.settings || {};
  const cards = [
    { label: "Gateway", value: gateway.gatewayBase ? "已配置" : "未配置" },
    { label: "Model", value: settings.model || "openclaw:main" },
    { label: "Agent", value: settings.agent || "未指定" },
    { label: "Auth", value: settings.hasBearerToken ? "Token 已保存" : "未保存 Token" },
  ];

  connectionSummary.innerHTML = "";
  for (const item of cards) {
    const node = document.createElement("div");
    node.className = "status-item";
    node.innerHTML = `<strong>${item.label}</strong><span>${item.value}</span>`;
    connectionSummary.appendChild(node);
  }

  connectionStatus.textContent = settings.baseUrl ? "已配置 OpenClaw" : "仅本地 fallback";
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
  const created = await sendRuntimeMessage("createSession");
  renderSession(created.session);
  messages.innerHTML = "";
  appendMessage("assistant", "已创建新会话。现在可以注入当前页面。");
}

async function injectPage() {
  const result = await sendRuntimeMessage("injectCurrentPage", {
    instruction: instruction.value.trim(),
  });
  if (result.sessionId) {
    const loaded = await sendRuntimeMessage("loadSession", { sessionId: result.sessionId });
    renderSession(loaded.session);
  }
  appendMessage("assistant", result.output?.text || "注入完成。");
}

async function sendQuestion() {
  const text = question.value.trim();
  if (!text) {
    return;
  }
  appendMessage("user", text);
  question.value = "";
  const result = await sendRuntimeMessage("askCurrentSession", {
    question: text,
  });
  appendMessage("assistant", buildAnswer(result));
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

function renderSession(session) {
  sessionLabel.textContent = session.id;
  const count = session.turns?.length || 0;
  const openclaw = session.openclaw || {};
  sessionMeta.textContent = `turns: ${count} | model: ${openclaw.model || "openclaw:main"}${openclaw.agent ? ` | agent: ${openclaw.agent}` : ""}`;
}

function restoreMessages(turns) {
  messages.innerHTML = "";
  if (!turns.length) {
    appendMessage("assistant", "会话已恢复。先注入当前页面，或直接提问。");
    return;
  }
  for (const turn of turns) {
    appendMessage(turn.role === "system" ? "assistant" : turn.role, turn.text);
  }
}

function appendMessage(role, text) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.textContent = text;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
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
