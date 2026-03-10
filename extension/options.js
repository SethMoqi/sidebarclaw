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

document.getElementById("saveGateway").addEventListener("click", saveGatewaySettings);
document.getElementById("saveOpenClaw").addEventListener("click", saveOpenClawSettings);
document.getElementById("testConnection").addEventListener("click", testOpenClawSettings);

bootstrap();

async function bootstrap() {
  const gateway = await sendRuntimeMessage("getGatewaySettings");
  gatewayBase.value = gateway.gatewayBase;
  gatewaySaved.textContent = gateway.gatewayBase ? "已保存" : "未保存";
  gatewaySaved.className = `badge ${gateway.gatewayBase ? "ok" : "muted"}`;

  const settings = await sendRuntimeMessage("getOpenClawSettings");
  hydrateOpenClawSettings(settings.settings);
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
  const saved = await sendRuntimeMessage("saveGatewaySettings", {
    gatewayBase: gatewayBase.value.trim(),
  });
  gatewayBase.value = saved.gatewayBase;
  gatewaySaved.textContent = "已保存";
  gatewaySaved.className = "badge ok";
}

async function saveOpenClawSettings() {
  const saved = await sendRuntimeMessage("saveOpenClawSettings", collectOpenClawSettings());
  hydrateOpenClawSettings(saved.settings);
  await testOpenClawSettings();
}

async function testOpenClawSettings() {
  const result = await sendRuntimeMessage("validateOpenClawSettings", collectOpenClawSettings());
  validationStatus.className = `validation ${result.status || "warn"}`;
  validationStatus.textContent = result.message || "未返回校验结果";
  mitigationList.innerHTML = "";
  for (const item of result.mitigations || []) {
    const li = document.createElement("li");
    li.textContent = item;
    mitigationList.appendChild(li);
  }
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
