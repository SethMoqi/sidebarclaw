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
const feedbackDialog = document.getElementById("feedbackDialog");
const feedbackTitle = document.getElementById("feedbackTitle");
const feedbackBody = document.getElementById("feedbackBody");

document.getElementById("saveGateway").addEventListener("click", saveGatewaySettings);
document.getElementById("saveOpenClaw").addEventListener("click", saveOpenClawSettings);
document.getElementById("testConnection").addEventListener("click", testOpenClawSettings);

bootstrap();

async function bootstrap() {
  try {
    const gateway = await sendRuntimeMessage("getGatewaySettings");
    gatewayBase.value = gateway.gatewayBase;
    gatewaySaved.textContent = gateway.gatewayBase ? "已保存" : "未保存";
    gatewaySaved.className = `badge ${gateway.gatewayBase ? "ok" : "muted"}`;

    const settings = await sendRuntimeMessage("getOpenClawSettings");
    hydrateOpenClawSettings(settings.settings);
  } catch (error) {
    showFeedback("加载失败", `设置页初始化失败：${String(error.message || error)}`);
  }
}

function hydrateOpenClawSettings(settings = {}) {
  openclawBaseUrl.value = settings.baseUrl || "";
  bearerToken.value = "";
  bearerToken.placeholder = settings.hasBearerToken ? "已保存，留空表示不修改" : "oc_...";
  modelName.value = settings.model || "openclaw:main";
  agentId.value = settings.agent || "";
  fallbackToLocal.checked = Boolean(settings.fallbackToLocal ?? true);
  openclawSaved.textContent = settings.baseUrl ? "已保存" : "未保存";
  openclawSaved.className = `badge ${settings.baseUrl ? "ok" : "muted"}`;
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
