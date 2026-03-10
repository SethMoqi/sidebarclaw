const gatewayBase = document.getElementById("gatewayBase");
const gatewaySaved = document.getElementById("gatewaySaved");
const openclawBaseUrl = document.getElementById("openclawBaseUrl");
const bearerToken = document.getElementById("bearerToken");
const modelName = document.getElementById("modelName");
const agentId = document.getElementById("agentId");
const fallbackToLocal = document.getElementById("fallbackToLocal");
const validationStatus = document.getElementById("validationStatus");
const mitigationList = document.getElementById("mitigationList");
const openclawSaved = document.getElementById("openclawSaved");
const sessionInjectPrompt = document.getElementById("sessionInjectPrompt");
const askPrefix = document.getElementById("askPrefix");
const defaultCaptureMode = document.getElementById("defaultCaptureMode");
const promptSaved = document.getElementById("promptSaved");
const themeMode = document.getElementById("themeMode");
const themeSaved = document.getElementById("themeSaved");
const feedbackDialog = document.getElementById("feedbackDialog");
const feedbackTitle = document.getElementById("feedbackTitle");
const feedbackBody = document.getElementById("feedbackBody");

document.getElementById("saveGateway").addEventListener("click", saveGatewaySettings);
document.getElementById("saveOpenClaw").addEventListener("click", saveOpenClawSettings);
document.getElementById("testConnection").addEventListener("click", testOpenClawSettings);
document.getElementById("savePrompts").addEventListener("click", savePromptSettings);
document.getElementById("saveTheme").addEventListener("click", saveThemeSettings);

bootstrap();

async function bootstrap() {
  try {
    const [gateway, settings, prompts, theme] = await Promise.all([
      sendRuntimeMessage("getGatewaySettings"),
      sendRuntimeMessage("getOpenClawSettings"),
      sendRuntimeMessage("getPromptSettings"),
      sendRuntimeMessage("getThemeSettings"),
    ]);

    gatewayBase.value = gateway.gatewayBase;
    gatewaySaved.textContent = gateway.gatewayBase ? "已保存" : "未保存";
    gatewaySaved.className = `badge ${gateway.gatewayBase ? "ok" : "muted"}`;

    hydrateOpenClawSettings(settings.settings);
    hydratePromptSettings(prompts.promptSettings);
    hydrateThemeSettings(theme.themeSettings);
  } catch (error) {
    showFeedback("加载失败", `设置页初始化失败：${String(error.message || error)}`);
  }
}

function hydrateThemeSettings(settings = {}) {
  const mode = settings.theme || "system";
  themeMode.value = mode;
  themeSaved.textContent = mode === "system" ? "跟随系统" : "已保存";
  themeSaved.className = "badge ok";
  applyTheme(mode);
}

function hydrateOpenClawSettings(settings = {}) {
  openclawBaseUrl.value = settings.baseUrl || "";
  bearerToken.value = "";
  bearerToken.placeholder = settings.hasBearerToken ? "已保存，留空表示不修改" : "留空时优先使用 OPENCLAW_GATEWAY_TOKEN";
  modelName.value = settings.model || "openclaw:main";
  agentId.value = settings.agent || "";
  fallbackToLocal.checked = Boolean(settings.fallbackToLocal ?? true);
  openclawSaved.textContent = settings.baseUrl ? "已保存" : "未保存";
  openclawSaved.className = `badge ${settings.baseUrl ? "ok" : "muted"}`;
}

function hydratePromptSettings(settings = {}) {
  sessionInjectPrompt.value = settings.sessionInjectPrompt || "";
  askPrefix.value = settings.askPrefix || "";
  defaultCaptureMode.value = settings.defaultCaptureMode || "full-content";
  promptSaved.textContent = settings.sessionInjectPrompt || settings.askPrefix ? "已保存" : "未保存";
  promptSaved.className = `badge ${settings.sessionInjectPrompt || settings.askPrefix ? "ok" : "muted"}`;
}

function collectOpenClawSettings() {
  return {
    baseUrl: openclawBaseUrl.value.trim(),
    bearerToken: bearerToken.value.trim(),
    model: modelName.value.trim() || "openclaw:main",
    agent: agentId.value.trim(),
    fallbackToLocal: fallbackToLocal.checked,
  };
}

function collectPromptSettings() {
  return {
    sessionInjectPrompt: sessionInjectPrompt.value.trim(),
    askPrefix: askPrefix.value.trim(),
    defaultCaptureMode: defaultCaptureMode.value,
  };
}

async function saveGatewaySettings() {
  try {
    const saved = await sendRuntimeMessage("saveGatewaySettings", {
      gatewayBase: gatewayBase.value.trim(),
    });
    gatewayBase.value = saved.gatewayBase;
    gatewaySaved.textContent = "已保存";
    gatewaySaved.className = "badge ok";
    showFeedback("Gateway 已保存", `当前 Gateway Base URL：\n${saved.gatewayBase}`);
  } catch (error) {
    showFeedback("保存失败", `Gateway 配置保存失败：${String(error.message || error)}`);
  }
}

async function saveOpenClawSettings() {
  try {
    const saved = await sendRuntimeMessage("saveOpenClawSettings", collectOpenClawSettings());
    hydrateOpenClawSettings(saved.settings);
    showFeedback(
      "OpenClaw 设置已保存",
      [
        `Model: ${saved.settings.model || "openclaw:main"}`,
        `Agent: ${saved.settings.agent || "未指定"}`,
        `Token: ${saved.settings.hasBearerToken ? "已保存" : "未保存"}`,
        `Fallback: ${saved.settings.fallbackToLocal ? "开启" : "关闭"}`,
      ].join("\n")
    );
    await testOpenClawSettings({ silentSuccess: true });
  } catch (error) {
    showFeedback("保存失败", `OpenClaw 配置保存失败：${String(error.message || error)}`);
  }
}

async function savePromptSettings() {
  try {
    const saved = await sendRuntimeMessage("savePromptSettings", collectPromptSettings());
    hydratePromptSettings(saved.promptSettings);
    showFeedback(
      "提示词配置已保存",
      [
        "这些配置会在 session 打开后直接作用于侧栏。",
        `默认注入模式：${saved.promptSettings.defaultCaptureMode === "url-reference" ? "只注入 URL 引用" : "抓取正文"}`,
      ].join("\n")
    );
  } catch (error) {
    showFeedback("保存失败", `提示词配置保存失败：${String(error.message || error)}`);
  }
}

async function saveThemeSettings() {
  try {
    const saved = await sendRuntimeMessage("saveThemeSettings", { theme: themeMode.value });
    hydrateThemeSettings(saved.themeSettings);
    showFeedback("主题已保存", `当前主题模式：${describeTheme(themeMode.value)}`);
  } catch (error) {
    showFeedback("保存失败", `主题保存失败：${String(error.message || error)}`);
  }
}

async function testOpenClawSettings(options = {}) {
  try {
    const result = await sendRuntimeMessage("validateOpenClawSettings", collectOpenClawSettings());
    renderValidation(result);
    if (!options.silentSuccess) {
      showFeedback(
        "连接测试结果",
        [
          result.message || "未返回校验结果",
          "",
          ...(result.mitigations || []).map((item, index) => `${index + 1}. ${item}`),
        ].join("\n")
      );
    }
  } catch (error) {
    renderValidation({
      status: "error",
      message: `校验失败：${String(error.message || error)}`,
      mitigations: [],
    });
    showFeedback("连接测试失败", `无法完成连接测试：${String(error.message || error)}`);
  }
}

function renderValidation(result) {
  validationStatus.className = `validation ${result.status || "warn"}`;
  validationStatus.textContent = result.message || "未返回校验结果";
  mitigationList.innerHTML = "";
  for (const item of result.mitigations || []) {
    const li = document.createElement("li");
    li.textContent = item;
    mitigationList.appendChild(li);
  }
}

function showFeedback(title, body) {
  feedbackTitle.textContent = title;
  feedbackBody.textContent = body;
  if (typeof feedbackDialog.showModal === "function") {
    feedbackDialog.showModal();
    return;
  }
  window.alert(`${title}\n\n${body}`);
}

function applyTheme(mode) {
  const resolved = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.body.dataset.theme = resolved;
}

function describeTheme(mode) {
  if (mode === "dark") {
    return "暗夜";
  }
  if (mode === "light") {
    return "浅色";
  }
  return "跟随系统";
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
