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
const sessionOpeningPrompt = document.getElementById("sessionOpeningPrompt");
const sessionInjectPrompt = document.getElementById("sessionInjectPrompt");
const askPrefix = document.getElementById("askPrefix");
const sessionClosurePrompt = document.getElementById("sessionClosurePrompt");
const protectionMode = document.getElementById("protectionMode");
const autoCloseSummary = document.getElementById("autoCloseSummary");
const idleTimeoutMinutes = document.getElementById("idleTimeoutMinutes");
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
    gatewaySaved.textContent = gateway.gatewayBase ? "Saved" : "Not saved";
    gatewaySaved.className = `badge ${gateway.gatewayBase ? "ok" : "muted"}`;

    hydrateOpenClawSettings(settings.settings);
    hydratePromptSettings(prompts.promptSettings);
    hydrateThemeSettings(theme.themeSettings);
  } catch (error) {
    showFeedback("Load Failed", `Could not initialize the settings page: ${String(error.message || error)}`);
  }
}

function hydrateThemeSettings(settings = {}) {
  const mode = settings.theme || "system";
  themeMode.value = mode;
  themeSaved.textContent = mode === "system" ? "System" : "Saved";
  themeSaved.className = "badge ok";
  applyTheme(mode);
}

function hydrateOpenClawSettings(settings = {}) {
  openclawBaseUrl.value = settings.baseUrl || "";
  bearerToken.value = "";
  bearerToken.placeholder = settings.hasBearerToken ? "Saved. Leave blank to keep the current token." : "Leave blank to use OPENCLAW_GATEWAY_TOKEN";
  modelName.value = settings.model || "openclaw:main";
  agentId.value = settings.agent || "";
  fallbackToLocal.checked = Boolean(settings.fallbackToLocal ?? true);
  openclawSaved.textContent = settings.baseUrl ? "Saved" : "Not saved";
  openclawSaved.className = `badge ${settings.baseUrl ? "ok" : "muted"}`;
}

function hydratePromptSettings(settings = {}) {
  sessionOpeningPrompt.value = settings.sessionOpeningPrompt || "";
  sessionInjectPrompt.value = settings.sessionInjectPrompt || "";
  askPrefix.value = settings.askPrefix || "";
  sessionClosurePrompt.value = settings.sessionClosurePrompt || "";
  protectionMode.value = settings.protectionMode || "strict";
  autoCloseSummary.checked = Boolean(settings.autoCloseSummary ?? true);
  idleTimeoutMinutes.value = String(settings.idleTimeoutMinutes || 10);
  defaultCaptureMode.value = settings.defaultCaptureMode || "full-content";
  promptSaved.textContent = settings.sessionInjectPrompt || settings.askPrefix || settings.sessionOpeningPrompt ? "Saved" : "Not saved";
  promptSaved.className = `badge ${settings.sessionInjectPrompt || settings.askPrefix || settings.sessionOpeningPrompt ? "ok" : "muted"}`;
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
    sessionOpeningPrompt: sessionOpeningPrompt.value.trim(),
    sessionInjectPrompt: sessionInjectPrompt.value.trim(),
    askPrefix: askPrefix.value.trim(),
    sessionClosurePrompt: sessionClosurePrompt.value.trim(),
    protectionMode: protectionMode.value,
    autoCloseSummary: autoCloseSummary.checked,
    idleTimeoutMinutes: Number(idleTimeoutMinutes.value || 10),
    defaultCaptureMode: defaultCaptureMode.value,
  };
}

async function saveGatewaySettings() {
  try {
    const saved = await sendRuntimeMessage("saveGatewaySettings", {
      gatewayBase: gatewayBase.value.trim(),
    });
    gatewayBase.value = saved.gatewayBase;
    gatewaySaved.textContent = "Saved";
    gatewaySaved.className = "badge ok";
    showFeedback("Adapter Saved", `Current adapter URL:\n${saved.gatewayBase}`);
  } catch (error) {
    showFeedback("Save Failed", `Could not save the adapter URL: ${String(error.message || error)}`);
  }
}

async function saveOpenClawSettings() {
  try {
    const saved = await sendRuntimeMessage("saveOpenClawSettings", collectOpenClawSettings());
    hydrateOpenClawSettings(saved.settings);
    showFeedback(
      "OpenClaw Settings Saved",
      [
        `Model: ${saved.settings.model || "openclaw:main"}`,
        `Agent: ${saved.settings.agent || "Not set"}`,
        `Token: ${saved.settings.hasBearerToken ? "Stored" : "Not stored"}`,
        `Fallback: ${saved.settings.fallbackToLocal ? "Enabled" : "Disabled"}`,
      ].join("\n")
    );
    await testOpenClawSettings({ silentSuccess: true });
  } catch (error) {
    showFeedback("Save Failed", `Could not save OpenClaw settings: ${String(error.message || error)}`);
  }
}

async function savePromptSettings() {
  try {
    const saved = await sendRuntimeMessage("savePromptSettings", collectPromptSettings());
    hydratePromptSettings(saved.promptSettings);
    showFeedback(
      "Prompt Policy Saved",
      [
        "These values are applied when a new session is opened.",
        `Prompt-injection protection: ${describeProtection(protectionMode.value)}`,
        `Auto-close summary: ${autoCloseSummary.checked ? "Enabled" : "Disabled"}`,
        `Default injection mode: ${saved.promptSettings.defaultCaptureMode === "url-reference" ? "URLs Only" : "Capture Text"}`,
      ].join("\n")
    );
  } catch (error) {
    showFeedback("Save Failed", `Could not save prompt policy: ${String(error.message || error)}`);
  }
}

async function saveThemeSettings() {
  try {
    const saved = await sendRuntimeMessage("saveThemeSettings", { theme: themeMode.value });
    hydrateThemeSettings(saved.themeSettings);
    showFeedback("Theme Saved", `Current theme: ${describeTheme(themeMode.value)}`);
  } catch (error) {
    showFeedback("Save Failed", `Could not save the theme: ${String(error.message || error)}`);
  }
}

async function testOpenClawSettings(options = {}) {
  try {
    const result = await sendRuntimeMessage("validateOpenClawSettings", collectOpenClawSettings());
    renderValidation(result);
    if (!options.silentSuccess) {
      showFeedback(
        "Connection Test Result",
        [
          result.message || "No validation result returned.",
          "",
          ...(result.mitigations || []).map((item, index) => `${index + 1}. ${item}`),
        ].join("\n")
      );
    }
  } catch (error) {
    renderValidation({
      status: "error",
      message: `Validation failed: ${String(error.message || error)}`,
      mitigations: [],
    });
    showFeedback("Connection Test Failed", `Could not complete the connection test: ${String(error.message || error)}`);
  }
}

function renderValidation(result) {
  validationStatus.className = `validation ${result.status || "warn"}`;
  validationStatus.textContent = result.message || "No validation result returned.";
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
    return "Dark";
  }
  if (mode === "light") {
    return "Light";
  }
  return "System";
}

function describeProtection(mode) {
  if (mode === "off") {
    return "Off";
  }
  if (mode === "balanced") {
    return "Balanced";
  }
  return "Strict";
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
