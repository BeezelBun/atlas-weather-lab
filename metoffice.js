/* Met Office DataHub Map Images standalone test page v0.2.8
   - Saves key/order locally in this browser only.
   - Caches the order file list to avoid re-listing hundreds of files every click.
   - Lets the user choose rainfall/cloud/pressure/temperature and a time step.
*/
(() => {
  const Lab = window.AtlasWeatherLab || { escapeHtml: escapeHtmlFallback };
  const METOFFICE_MAP_IMAGES_BASE = "https://data.hub.api.metoffice.gov.uk/map-images/1.0.0";
  const STORAGE = {
    key: "atlasWeatherLab.metOffice.mapImages.apiKey",
    order: "atlasWeatherLab.metOffice.mapImages.orderId",
    layer: "atlasWeatherLab.metOffice.mapImages.layer",
    timeStep: "atlasWeatherLab.metOffice.mapImages.timeStep",
    cachePrefix: "atlasWeatherLab.metOffice.mapImages.fileCache."
  };

  const LAYER_MATCHERS = {
    rainfall: /(precip|rainfall|rain)/i,
    cloud: /cloud/i,
    pressure: /(pressure|mean[_-]?sea|meansea|mslp|msl)/i,
    temperature: /(temperature|temp)/i,
    all: /./
  };

  const els = {
    key: document.getElementById("metOfficeKey"),
    order: document.getElementById("metOfficeOrder"),
    layer: document.getElementById("metOfficeLayer"),
    timeStep: document.getElementById("metOfficeTimeStep"),
    saveLocalButton: document.getElementById("saveLocalButton"),
    forgetLocalButton: document.getElementById("forgetLocalButton"),
    testButton: document.getElementById("testOrderButton"),
    refreshButton: document.getElementById("refreshOrderButton"),
    previewButton: document.getElementById("previewButton"),
    clearButton: document.getElementById("clearButton"),
    output: document.getElementById("metOfficeOutput"),
    storageNote: document.getElementById("metOfficeStorageNote")
  };

  let fileIds = [];
  let selectedFileId = "";
  let previewObjectUrl = "";

  restoreSavedSettings();
  bindEvents();
  showSavedState();

  function bindEvents() {
    els.saveLocalButton.addEventListener("click", () => {
      saveSettings();
      showSavedState("Saved locally on this device.");
    });

    els.forgetLocalButton.addEventListener("click", () => {
      forgetSettings();
      showSavedState("Saved key/order removed from this browser.");
    });

    els.testButton.addEventListener("click", async () => {
      await listOrder({ forceRefresh: false, previewAfter: true });
    });

    els.refreshButton.addEventListener("click", async () => {
      await listOrder({ forceRefresh: true, previewAfter: false });
    });

    els.previewButton.addEventListener("click", previewSelectedFile);

    els.clearButton.addEventListener("click", () => {
      clearPreviewUrl();
      els.output.textContent = "Output cleared. Saved key/order and cached file list were not removed.";
    });

    els.layer.addEventListener("change", () => {
      localStorage.setItem(STORAGE.layer, els.layer.value);
      rebuildTimeStepOptions();
      renderFileSelectionSummary();
    });

    els.timeStep.addEventListener("change", () => {
      localStorage.setItem(STORAGE.timeStep, els.timeStep.value);
      chooseSelectedFile();
      renderFileSelectionSummary();
    });

    els.key.addEventListener("change", saveSettings);
    els.order.addEventListener("change", saveSettings);
  }

  function restoreSavedSettings() {
    els.key.value = localStorage.getItem(STORAGE.key) || "";
    els.order.value = localStorage.getItem(STORAGE.order) || "maps-uk1";
    els.layer.value = localStorage.getItem(STORAGE.layer) || "rainfall";
  }

  function saveSettings() {
    const apiKey = els.key.value.trim();
    const orderId = normaliseOrderId(els.order.value);
    if (apiKey) localStorage.setItem(STORAGE.key, apiKey);
    if (orderId) localStorage.setItem(STORAGE.order, orderId);
    localStorage.setItem(STORAGE.layer, els.layer.value);
    els.order.value = orderId || els.order.value.trim();
  }

  function forgetSettings() {
    clearPreviewUrl();
    const orderId = normaliseOrderId(els.order.value);
    localStorage.removeItem(STORAGE.key);
    localStorage.removeItem(STORAGE.order);
    localStorage.removeItem(STORAGE.layer);
    localStorage.removeItem(STORAGE.timeStep);
    if (orderId) localStorage.removeItem(cacheKey(orderId));
    els.key.value = "";
    els.output.textContent = "Saved key/order removed. Paste the key again when needed.";
  }

  function showSavedState(message = "") {
    const hasKey = Boolean(localStorage.getItem(STORAGE.key));
    const orderId = localStorage.getItem(STORAGE.order) || "not saved";
    els.storageNote.textContent = message || `Local storage: ${hasKey ? "key saved" : "no key saved"}; order: ${orderId}. Nothing is committed to GitHub.`;
  }

  async function listOrder({ forceRefresh, previewAfter }) {
    const apiKey = els.key.value.trim();
    const orderId = normaliseOrderId(els.order.value);

    if (!apiKey || !orderId) {
      els.output.textContent = "Paste a Map Images API key and API Order ID first.";
      return;
    }

    saveSettings();
    showSavedState();
    els.testButton.disabled = true;
    els.refreshButton.disabled = true;
    els.previewButton.disabled = true;

    try {
      const cached = !forceRefresh ? readCachedFiles(orderId) : null;
      if (cached?.length) {
        fileIds = cached;
        rebuildTimeStepOptions();
        renderFileSelectionSummary(`Using cached file list: ${fileIds.length} file(s). No new order-list request was made.`);
        if (previewAfter) await previewSelectedFile();
        return;
      }

      els.output.textContent = "Listing Met Office latest order filesâ¦";
      const detailUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderId)}/latest?detail=MINIMAL`;
      const response = await fetch(detailUrl, {
        headers: {
          Accept: "application/json",
          apikey: apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Met Office latest-order request returned HTTP ${response.status}. If the browser reports CORS, this provider needs a proxy/native layer.`);
      }

      const json = await response.json();
      const files = findFiles(json);
      fileIds = files.map(getFileId).filter(Boolean);

      if (!fileIds.length) {
        els.output.textContent = `Order request worked, but no files were found.\n\nRaw keys: ${Object.keys(json).join(", ")}`;
        return;
      }

      writeCachedFiles(orderId, fileIds);
      rebuildTimeStepOptions();
      renderFileSelectionSummary(`Order OK. ${fileIds.length} file(s) listed and cached locally. This was one metadata request, not ${fileIds.length} image downloads.`);
      if (previewAfter) await previewSelectedFile();
    } catch (error) {
      els.output.textContent = error.message;
    } finally {
      els.testButton.disabled = false;
      els.refreshButton.disabled = false;
      els.previewButton.disabled = Boolean(!selectedFileId);
    }
  }

  function findFiles(json) {
    if (Array.isArray(json?.orderDetails?.files)) return json.orderDetails.files;
    if (Array.isArray(json?.files)) return json.files;
    if (Array.isArray(json?.items)) return json.items;
    return [];
  }

  function getFileId(file) {
    if (typeof file === "string") return file;
    return file?.fileId || file?.filename || file?.name || file?.id || "";
  }

  function rebuildTimeStepOptions() {
    const layerFiles = getLayerFiles();
    const steps = unique(layerFiles.map(extractTimeStep)).filter(Boolean).sort(sortTimeSteps);
    const savedStep = localStorage.getItem(STORAGE.timeStep);

    els.timeStep.innerHTML = "";
    if (!steps.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = fileIds.length ? "No time steps matched" : "Load order first";
      els.timeStep.appendChild(option);
      els.timeStep.disabled = true;
      selectedFileId = "";
      return;
    }

    for (const step of steps) {
      const option = document.createElement("option");
      option.value = step;
      option.textContent = step;
      els.timeStep.appendChild(option);
    }

    els.timeStep.disabled = false;
    els.timeStep.value = steps.includes(savedStep) ? savedStep : steps[0];
    localStorage.setItem(STORAGE.timeStep, els.timeStep.value);
    chooseSelectedFile();
  }

  function getLayerFiles() {
    const matcher = LAYER_MATCHERS[els.layer.value] || LAYER_MATCHERS.all;
    return fileIds.filter((fileId) => matcher.test(fileId));
  }

  function chooseSelectedFile() {
    const layerFiles = getLayerFiles();
    const step = els.timeStep.value;
    selectedFileId = layerFiles.find((fileId) => extractTimeStep(fileId) === step) || layerFiles[0] || "";
    els.previewButton.disabled = Boolean(!selectedFileId);
  }

  function renderFileSelectionSummary(prefix = "") {
    chooseSelectedFile();
    const layerFiles = getLayerFiles();
    const sample = layerFiles.slice(0, 8).map((name) => `- ${name}`).join("\n");
    const text = [
      prefix,
      `Layer: ${els.layer.options[els.layer.selectedIndex]?.textContent || els.layer.value}`,
      `Matching files: ${layerFiles.length} of ${fileIds.length}`,
      `Selected file: ${selectedFileId || "none"}`,
      sample ? `\nSample matches:\n${sample}` : ""
    ].filter(Boolean).join("\n");
    els.output.textContent = text;
  }

  async function previewSelectedFile() {
    const apiKey = els.key.value.trim();
    const orderId = normaliseOrderId(els.order.value);
    chooseSelectedFile();

    if (!apiKey || !orderId || !selectedFileId) {
      els.output.textContent = "Load the order first, then choose a layer/time step.";
      return;
    }

    els.previewButton.disabled = true;
    renderFileSelectionSummary("Loading selected preview imageâ¦");

    try {
      const pngUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderId)}/latest/${encodeURIComponent(selectedFileId)}/data?includeLand=true`;
      const response = await fetch(pngUrl, {
        headers: {
          Accept: "image/png",
          apikey: apiKey
        }
      });
      if (!response.ok) throw new Error(`Met Office image request returned HTTP ${response.status}`);

      const blob = await response.blob();
      clearPreviewUrl();
      previewObjectUrl = URL.createObjectURL(blob);

      const summary = document.createElement("div");
      summary.textContent = `Preview loaded.\nSelected file: ${selectedFileId}\n\nOne image request was made for this selected file only.`;

      const img = document.createElement("img");
      img.src = previewObjectUrl;
      img.alt = `Met Office Map Images API preview: ${selectedFileId}`;

      els.output.innerHTML = "";
      els.output.appendChild(summary);
      els.output.appendChild(img);
    } catch (error) {
      els.output.textContent = error.message;
    } finally {
      els.previewButton.disabled = false;
    }
  }

  function extractTimeStep(fileId) {
    const match = String(fileId).match(/(?:_|\b)([+]?\d{2,3})(?:\.[a-z0-9]+)?$/i);
    if (!match) return "unknown";
    const raw = match[1].replace(/^\+/, "");
    return `+${raw.padStart(2, "0")}`;
  }

  function sortTimeSteps(a, b) {
    return timeStepNumber(a) - timeStepNumber(b);
  }

  function timeStepNumber(step) {
    const parsed = Number(String(step).replace("+", ""));
    return Number.isFinite(parsed) ? parsed : 9999;
  }

  function normaliseOrderId(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  }

  function cacheKey(orderId) {
    return `${STORAGE.cachePrefix}${orderId}`;
  }

  function readCachedFiles(orderId) {
    try {
      const raw = localStorage.getItem(cacheKey(orderId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.files)) return null;
      return parsed.files;
    } catch {
      return null;
    }
  }

  function writeCachedFiles(orderId, files) {
    try {
      localStorage.setItem(cacheKey(orderId), JSON.stringify({
        orderId,
        savedAt: new Date().toISOString(),
        files
      }));
    } catch (error) {
      console.warn("Could not cache Met Office file list", error);
    }
  }

  function clearPreviewUrl() {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function escapeHtmlFallback(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    })[char]);
  }
})();
