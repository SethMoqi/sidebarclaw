const promptTemplates = [
  {
    title: "快速总结",
    body: "总结这页的核心观点、主要结论和最值得保留的 3 个信息点。",
  },
  {
    title: "证据问答",
    body: "只基于当前页面证据回答，并列出最相关的原文片段位置。",
  },
  {
    title: "研究提取",
    body: "提取页面中的关键实体、关系、实验结论和潜在应用场景。",
  },
  {
    title: "归档摘要",
    body: "整理成适合知识库归档的摘要，包含标题、摘要、关键点和标签建议。",
  },
  {
    title: "对比线索",
    body: "这页有哪些适合后续横向对比的字段或线索？请按字段列出。",
  },
];

const state = {
  activeDoc: null,
  sessionId: null,
  openclaw: {
    baseUrl: "",
    bearerToken: "",
    model: "openclaw:main",
    agent: "",
    fallbackToLocal: true,
  },
};

const promptList = document.getElementById("promptList");
const activeDoc = document.getElementById("activeDoc");
const messages = document.getElementById("messages");
const evidence = document.getElementById("evidence");
const healthStatus = document.getElementById("healthStatus");
const questionInput = document.getElementById("question");
const injectForm = document.getElementById("injectForm");
const chatForm = document.getElementById("chatForm");
const clearChat = document.getElementById("clearChat");
const healthBtn = document.getElementById("healthBtn");
const loadDemo = document.getElementById("loadDemo");
const newSessionBtn = document.getElementById("newSessionBtn");
const sessionLabel = document.getElementById("sessionLabel");
const sessionMeta = document.getElementById("sessionMeta");
const saveConnection = document.getElementById("saveConnection");
const testConnection = document.getElementById("testConnection");
const openclawBaseUrl = document.getElementById("openclawBaseUrl");
const bearerToken = document.getElementById("bearerToken");
const modelName = document.getElementById("modelName");
const agentId = document.getElementById("agentId");
const fallbackToLocal = document.getElementById("fallbackToLocal");
const validationStatus = document.getElementById("validationStatus");
const mitigationList = document.getElementById("mitigationList");

renderPromptList();
loadSettingsSchema();
loadConnectionSettings();
bootstrapSession();

healthBtn.addEventListener("click", checkHealth);
loadDemo.addEventListener("click", loadDemoContent);
injectForm.addEventListener("submit", injectContent);
chatForm.addEventListener("submit", askQuestion);
newSessionBtn.addEventListener("click", createSession);
saveConnection.addEventListener("click", persistConnectionSettings);
testConnection.addEventListener("click", validateConnectionSettings);
clearChat.addEventListener("click", () => {
  messages.innerHTML = "";
  evidence.textContent = "等待提问结果...";
});

async function bootstrapSession() {
  const saved = window.localStorage.getItem("openclaw.sessionId");
  if (saved) {
    state.sessionId = saved;
    await loadSession(saved);
    return;
  }
  await createSession();
}

async function checkHealth() {
  healthStatus.textContent = "检查中...";
  try {
    const res = await fetch("/health");
    const data = await res.json();
    healthStatus.textContent = data.status === "ok" ? "服务正常" : "服务异常";
  } catch (error) {
    healthStatus.textContent = "连接失败";
  }
}

function renderPromptList() {
  promptList.innerHTML = "";
  for (const prompt of promptTemplates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-item ghost";
    button.innerHTML = `<strong>${prompt.title}</strong><span>${prompt.body}</span>`;
    button.addEventListener("click", () => {
      questionInput.value = prompt.body;
      questionInput.focus();
    });
    promptList.appendChild(button);
  }
}

function loadDemoContent() {
  document.getElementById("title").value = "胆固醇合成中环状 RNA/miRNA 轴的潜在作用和机制 - PMC";
  document.getElementById("url").value = "https://pmc.ncbi.nlm.nih.gov/articles/PMC10266072/";
  document.getElementById("instruction").value = "总结后支持后续检索";
  document.getElementById("content").value = [
    "Abstract",
    "CircRNAs may have longer half-lives and lower immunogenicity than linear RNA agents.",
    "",
    "Mechanism",
    "Many studies show that circRNAs regulate cholesterol synthesis by regulating HMGCR, SQLE, HMGCS1, PTEN, DHCR24, SREBP-2, and PMK expression.",
    "",
    "Therapeutic Targets",
    "Suppressing HMGCR, SQLE, and miR-122 with circRNA_ABCA1, circ-PRKCH, circEZH2, circRNA-SCAP, and circFOXO3 is described as a promising direction for drug development.",
  ].join("\n");
}

function loadConnectionSettings() {
  try {
    fetch("/settings/openclaw")
      .then((res) => res.json())
      .then((data) => {
        state.openclaw = { ...state.openclaw, ...data.settings };
        syncConnectionForm();
      })
      .catch(() => {
        syncConnectionForm();
      });
  } catch (_error) {
    syncConnectionForm();
  }
}

async function loadSettingsSchema() {
  try {
    const res = await fetch("/settings/schema");
    const data = await res.json();
    if (data.defaults?.model && !state.openclaw.model) {
      state.openclaw.model = data.defaults.model;
    }
    syncConnectionForm();
  } catch (_error) {
    // Keep local defaults if schema endpoint is unavailable.
  }
}

function syncConnectionForm() {
  openclawBaseUrl.value = state.openclaw.baseUrl || "";
  bearerToken.value = "";
  bearerToken.placeholder = state.openclaw.hasBearerToken ? "已保存，留空表示不修改" : "oc_...";
  modelName.value = state.openclaw.model || "openclaw:main";
  agentId.value = state.openclaw.agent || "";
  fallbackToLocal.checked = Boolean(state.openclaw.fallbackToLocal);
}

async function persistConnectionSettings() {
  const payload = {
    baseUrl: openclawBaseUrl.value.trim(),
    bearerToken: bearerToken.value.trim(),
    model: modelName.value.trim() || "openclaw:main",
    agent: agentId.value.trim(),
    fallbackToLocal: fallbackToLocal.checked,
  };
  const res = await fetch("/settings/openclaw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  state.openclaw = { ...state.openclaw, ...data.settings };
  syncConnectionForm();
  appendMessage(
    "assistant",
    state.openclaw.baseUrl
      ? `已保存 OpenClaw 连接：${state.openclaw.baseUrl}${state.openclaw.model ? ` | model: ${state.openclaw.model}` : ""}${state.openclaw.agent ? ` | agent: ${state.openclaw.agent}` : ""}`
      : "已切换为仅本地 longdoc 模式。"
  );
  validateConnectionSettings();
}

async function validateConnectionSettings() {
  const payload = {
    baseUrl: openclawBaseUrl.value.trim(),
    bearerToken: bearerToken.value.trim(),
    model: modelName.value.trim() || "openclaw:main",
    agent: agentId.value.trim(),
    fallbackToLocal: fallbackToLocal.checked,
  };

  state.openclaw = payload;
  validationStatus.className = "validation-status";
  validationStatus.textContent = "校验中...";
  mitigationList.innerHTML = "";

  try {
    const res = await fetch("/openclaw/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    renderValidation(data);
  } catch (error) {
    renderValidation({
      valid: false,
      status: "error",
      message: `校验失败: ${error.message}`,
      mitigations: ["确认本地网关仍在运行，然后重试。"],
    });
  }
}

function renderValidation(result) {
  validationStatus.className = `validation-status ${result.status || "warn"}`;
  validationStatus.textContent = result.message || "未返回校验结果";
  mitigationList.innerHTML = "";
  for (const item of result.mitigations || []) {
    const li = document.createElement("li");
    li.textContent = item;
    mitigationList.appendChild(li);
  }
  if (!mitigationList.children.length) {
    const li = document.createElement("li");
    li.textContent = "当前配置无额外缓解建议。";
    mitigationList.appendChild(li);
  }
}

async function injectContent(event) {
  event.preventDefault();
  const payload = {
    source: "browser_sidebar",
    page: {
      title: document.getElementById("title").value.trim(),
      url: document.getElementById("url").value.trim(),
      content: document.getElementById("content").value.trim(),
      headings: [],
      capturedAt: new Date().toISOString(),
      extractionMode: "main-content",
    },
    input: {
      instruction: document.getElementById("instruction").value.trim(),
    },
  };

  if (!payload.page.content) {
    appendMessage("assistant", "需要先提供正文内容。");
    return;
  }

  appendMessage("user", `注入文档：${payload.page.title || "未命名内容"}`);
  try {
    const res = await fetch("/inputs/inject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        sessionId: state.sessionId,
        openclaw: {
          model: state.openclaw.model,
          agent: state.openclaw.agent,
          fallbackToLocal: state.openclaw.fallbackToLocal,
        },
      }),
    });
    const data = await res.json();
    state.activeDoc = data;
    renderActiveDoc();
    appendMessage("assistant", data.output.text);
    evidence.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    appendMessage("assistant", `注入失败: ${error.message}`);
  }
}

async function askQuestion(event) {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) {
    return;
  }
  if (!state.activeDoc?.indexRef) {
    appendMessage("assistant", "请先注入内容，再发起提问。");
    return;
  }

  appendMessage("user", question);
  questionInput.value = "";

  try {
    const res = await fetch("/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        indexRef: state.activeDoc.indexRef,
        sessionId: state.sessionId,
        openclaw: {
          model: state.openclaw.model,
          agent: state.openclaw.agent,
          fallbackToLocal: state.openclaw.fallbackToLocal,
        },
      }),
    });
    const data = await res.json();
    const answer = buildAnswerText(data);
    appendMessage("assistant", answer);
    evidence.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    appendMessage("assistant", `提问失败: ${error.message}`);
  }
}

async function createSession() {
  const res = await fetch("/sessions/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  state.sessionId = data.sessionId;
  state.activeDoc = null;
  window.localStorage.setItem("openclaw.sessionId", state.sessionId);
  messages.innerHTML = "";
  evidence.textContent = "等待提问结果...";
  renderActiveDoc();
  renderSession(data.session);
  appendMessage("assistant", "已创建新会话。先注入内容，再继续提问。");
}

async function loadSession(sessionId) {
  try {
    const res = await fetch(`/sessions/${sessionId}`);
    if (!res.ok) {
      throw new Error("session not found");
    }
    const data = await res.json();
    renderSession(data.session);
    restoreMessages(data.session.turns || []);
    if (data.session.activeIndexRef) {
      state.activeDoc = { indexRef: data.session.activeIndexRef };
      if (data.session.documentSummary) {
        state.activeDoc.output = { summary: data.session.documentSummary };
        state.activeDoc.contentStats = data.session.documentStats || {};
      }
      renderActiveDoc();
    }
  } catch (_error) {
    window.localStorage.removeItem("openclaw.sessionId");
    await createSession();
  }
}

function renderSession(session) {
  sessionLabel.textContent = session.id;
  const turnCount = session.turns?.length || 0;
  if (session.openclaw) {
    state.openclaw = {
      baseUrl: session.openclaw.baseUrl || state.openclaw.baseUrl,
      bearerToken: session.openclaw.bearerToken || state.openclaw.bearerToken,
      model: session.openclaw.model || state.openclaw.model,
      agent: session.openclaw.agent || state.openclaw.agent,
      fallbackToLocal: session.openclaw.fallbackToLocal ?? state.openclaw.fallbackToLocal,
    };
    syncConnectionForm();
  }
  const mode = state.openclaw.baseUrl ? `OpenClaw -> ${state.openclaw.baseUrl}` : "local fallback";
  sessionMeta.textContent = `turns: ${turnCount} | ${mode} | updated: ${new Date(session.updatedAt).toLocaleString()}`;
}

function restoreMessages(turns) {
  messages.innerHTML = "";
  if (!turns.length) {
    appendMessage("assistant", "会话已恢复。先注入内容或继续提问。");
    return;
  }
  for (const turn of turns) {
    if (turn.role === "system") {
      appendMessage("assistant", turn.text);
    } else {
      appendMessage(turn.role, turn.text);
    }
  }
}

function buildAnswerText(data) {
  if (data?.answerText) {
    return `问题: ${data.question}\n\n${data.answerText}`;
  }
  if (!data?.evidence?.length) {
    return "未找到相关证据。";
  }
  const lead = data.evidence
    .map((item, index) => {
      return `${index + 1}. [${item.sectionTitle}] ${item.snippet}`;
    })
    .join("\n\n");
  return `问题: ${data.question}\n\n可用证据:\n${lead}`;
}

function appendMessage(role, text) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `
    <div class="message-meta">${role}</div>
    <div class="bubble"></div>
  `;
  article.querySelector(".bubble").textContent = text;
  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
}

function renderActiveDoc() {
  if (!state.activeDoc) {
    activeDoc.classList.add("empty");
    activeDoc.textContent = "尚未注入文档";
    return;
  }
  const summary = state.activeDoc.output?.summary || {};
  activeDoc.classList.remove("empty");
  activeDoc.innerHTML = `
    <strong>${summary.title || "未命名文档"}</strong>
    <div>${summary.url || ""}</div>
    <div>长度: ${state.activeDoc.contentStats?.length || 0} 字符</div>
    <div>段落: ${state.activeDoc.contentStats?.paragraphCount || 0}</div>
    <div>inputId: ${state.activeDoc.inputId}</div>
  `;
}
