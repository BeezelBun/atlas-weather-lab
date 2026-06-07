/* Met Office DataHub Map Images full-screen preview v0.3.0
   - Uses locally saved Map Images key/API Order ID.
   - Caches the order file list so the order does not relist hundreds of files every view.
   - Shows one selected PNG at a time with side layer buttons and a frame slider.
   - Repaints rainfall images into an Atlas blue-only overlay palette.
   - Does not commit keys or order data to GitHub.
*/
(() => {
  const METOFFICE_MAP_IMAGES_BASE = "https://data.hub.api.metoffice.gov.uk/map-images/1.0.0";

  const STORAGE = {
    key: "atlasWeatherLab.metOffice.mapImages.apiKey",
    order: "atlasWeatherLab.metOffice.mapImages.orderId",
    layer: "atlasWeatherLab.metOffice.mapImages.layer",
    timeStep: "atlasWeatherLab.metOffice.mapImages.timeStep",
    cachePrefix: "atlasWeatherLab.metOffice.mapImages.fileCache."
  };

  const LAYERS = {
    rainfall: {
      label: "Rainfall",
      title: "Rainfall / precipitation rate",
      matcher: /(precip|rainfall|rain)/i,
      empty: "No rainfall image matched this order.",
      legend: "Met Office precipitation-rate model PNG, recoloured in-browser to Atlas blue rainfall colours."
    },
    cloud: {
      label: "Cloud",
      title: "Total cloud cover",
      matcher: /cloud/i,
      empty: "No cloud image matched this order.",
      legend: "Total cloud cover map image from the selected order."
    },
    pressure: {
      label: "Pressure",
      title: "Mean sea-level pressure",
      matcher: /(pressure|mean[_-]?sea|meansea|mslp|msl)/i,
      empty: "No pressure image matched this order.",
      legend: "Mean sea-level pressure map image from the selected order."
    },
    temperature: {
      label: "Temperature",
      title: "Surface temperature",
      matcher: /(temperature|temp)/i,
      empty: "No temperature image matched this order.",
      legend: "Temperature-at-surface map image from the selected order."
    }
  };

  const els = {
    image: document.getElementById("metOfficeImage"),
    placeholder: document.getElementById("metOfficePlaceholder"),
    status: document.getElementById("metOfficeStatus"),
    legend: document.getElementById("metOfficeLegend"),
    frameTitle: document.getElementById("metOfficeFrameTitle"),
    frameLabel: document.getElementById("metOfficeFrameLabel"),
    frameSlider: document.getElementById("metOfficeFrameSlider"),
    prevFrame: document.getElementById("prevFrameButton"),
    nextFrame: document.getElementById("nextFrameButton"),
    layerButtons: Array.from(document.querySelectorAll(".metoffice-layer-button[data-layer]")),
    refreshButton: document.getElementById("refreshOrderButton"),
    forgetButton: document.getElementById("forgetLocalButton"),
    openSettings: document.getElementById("openMetOfficeSettings"),
    closeSettings: document.getElementById("closeMetOfficeSettings"),
    closeSetup: document.getElementById("closeSetupButton"),
    settingsPanel: document.getElementById("metOfficeSettingsPanel"),
    key: document.getElementById("metOfficeKey"),
    order: document.getElementById("metOfficeOrder"),
    saveButton: document.getElementById("saveLocalButton"),
    storageNote: document.getElementById("metOfficeStorageNote")
  };

  let fileIds = [];
  let layerFiles = [];
  let timeSteps = [];
  let selectedLayer = localStorage.getItem(STORAGE.layer) || "rainfall";
  let selectedStep = localStorage.getItem(STORAGE.timeStep) || "+00";
  let selectedFileId = "";
  let imageObjectUrl = "";
  let loadingImage = false;

  restoreInputs();
  bindEvents();
  setActiveLayer(selectedLayer, { preview: false });
  updateSavedNote();
  bootstrap();

  function restoreInputs() {
    els.key.value = localStorage.getItem(STORAGE.key) || "";
    els.order.value = localStorage.getItem(STORAGE.order) || "maps-uk1";
  }

  function bindEvents() {
    els.layerButtons.forEach((button) => {
      button.addEventListener("click", () => setActiveLayer(button.dataset.layer, { preview: true }));
    });

    els.frameSlider.addEventListener("input", () => {
      const index = Number(els.frameSlider.value || 0);
      selectedStep = timeSteps[index] || selectedStep;
      localStorage.setItem(STORAGE.timeStep, selectedStep);
      chooseSelectedFile();
      updateFrameUi();
    });

    els.frameSlider.addEventListener("change", () => previewSelectedFile());

    els.prevFrame.addEventListener("click", () => bumpFrame(-1));
    els.nextFrame.addEventListener("click", () => bumpFrame(1));

    els.refreshButton.addEventListener("click", () => loadOrder({ forceRefresh: true, previewAfter: true }));

    els.forgetButton.addEventListener("click", () => {
      forgetSavedKey();
      showSettings(true);
    });

    els.openSettings.addEventListener("click", () => showSettings(true));
    els.closeSettings.addEventListener("click", () => showSettings(false));
    els.closeSetup.addEventListener("click", () => showSettings(false));

    els.saveButton.addEventListener("click", () => {
      saveSettings();
      updateSavedNote("Saved locally on this device.");
      showSettings(false);
      loadOrder({ forceRefresh: false, previewAfter: true });
    });

    els.key.addEventListener("change", saveSettings);
    els.order.addEventListener("change", saveSettings);
  }

  async function bootstrap() {
    const apiKey = getApiKey();
    const orderId = getOrderId();

    if (!apiKey || !orderId) {
      setStatus("Setup needed", "Paste the Map Images key and API Order ID once. They will be saved only in this browser.");
      showSettings(true);
      return;
    }

    const cached = readCachedFiles(orderId);
    if (cached?.length) {
      fileIds = cached;
      rebuildLayerFiles();
      setStatus("Using cached order list", `${fileIds.length} file(s) available locally. No metadata request made.`);
      await previewSelectedFile();
      return;
    }

    await loadOrder({ forceRefresh: false, previewAfter: true });
  }

  function saveSettings() {
    const apiKey = getApiKey();
    const orderId = normaliseOrderId(els.order.value);

    if (apiKey) localStorage.setItem(STORAGE.key, apiKey);
    if (orderId) localStorage.setItem(STORAGE.order, orderId);

    els.order.value = orderId || els.order.value.trim();
    localStorage.setItem(STORAGE.layer, selectedLayer);
  }

  function forgetSavedKey() {
    clearImageUrl();
    const orderId = getOrderId();
    localStorage.removeItem(STORAGE.key);
    localStorage.removeItem(STORAGE.order);
    localStorage.removeItem(STORAGE.layer);
    localStorage.removeItem(STORAGE.timeStep);
    if (orderId) localStorage.removeItem(cacheKey(orderId));

    fileIds = [];
    layerFiles = [];
    timeSteps = [];
    selectedFileId = "";
    els.key.value = "";
    els.order.value = "maps-uk1";
    els.image.hidden = true;
    els.placeholder.hidden = false;
    els.frameSlider.disabled = true;
    setStatus("Saved key removed", "Paste the Map Images key again when needed. Cached file list was removed for the current order.");
    updateSavedNote("Saved key/order removed from this browser.");
  }

  async function loadOrder({ forceRefresh, previewAfter }) {
    const apiKey = getApiKey();
    const orderId = getOrderId();

    if (!apiKey || !orderId) {
      setStatus("Setup needed", "Paste a Map Images key and API Order ID first.");
      showSettings(true);
      return;
    }

    saveSettings();
    updateSavedNote();
    disableButtons(true);

    try {
      const cached = !forceRefresh ? readCachedFiles(orderId) : null;
      if (cached?.length) {
        fileIds = cached;
        rebuildLayerFiles();
        setStatus("Using cached order list", `${fileIds.length} file(s) available locally. No new order-list request was made.`);
        if (previewAfter) await previewSelectedFile();
        return;
      }

      setStatus("Listing order", "Fetching the latest order file list once, then caching it locally.");
      const detailUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderId)}/latest?detail=MINIMAL`;
      const response = await fetch(detailUrl, {
        headers: {
          Accept: "application/json",
          apikey: apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Met Office latest-order request returned HTTP ${response.status}.`);
      }

      const json = await response.json();
      const files = findFiles(json);
      fileIds = files.map(getFileId).filter(Boolean);

      if (!fileIds.length) {
        throw new Error(`Order request worked, but no files were found. Raw keys: ${Object.keys(json).join(", ")}`);
      }

      writeCachedFiles(orderId, fileIds);
      rebuildLayerFiles();
      setStatus("Order OK", `${fileIds.length} file(s) listed and cached. This was one metadata request, not ${fileIds.length} image downloads.`);
      if (previewAfter) await previewSelectedFile();
    } catch (error) {
      setStatus("Met Office error", error.message);
      showSettings(true);
    } finally {
      disableButtons(false);
    }
  }

  function setActiveLayer(layer, { preview }) {
    if (!LAYERS[layer]) layer = "rainfall";
    selectedLayer = layer;
    localStorage.setItem(STORAGE.layer, selectedLayer);

    els.layerButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.layer === selectedLayer);
    });

    els.image.classList.remove("is-rainfall", "is-cloud", "is-pressure", "is-temperature");
    els.image.classList.add(`is-${selectedLayer}`);
    els.frameTitle.textContent = LAYERS[selectedLayer].label;
    els.legend.innerHTML = `<strong>${escapeHtml(LAYERS[selectedLayer].title)}</strong><span>${escapeHtml(LAYERS[selectedLayer].legend)}</span>`;

    rebuildLayerFiles();
    if (preview) previewSelectedFile();
  }

  function rebuildLayerFiles() {
    const matcher = LAYERS[selectedLayer].matcher;
    layerFiles = fileIds.filter((fileId) => matcher.test(fileId));
    timeSteps = unique(layerFiles.map(extractTimeStep)).filter(Boolean).sort(sortTimeSteps);

    if (!timeSteps.length) {
      selectedFileId = "";
      els.frameSlider.disabled = true;
      els.frameSlider.min = "0";
      els.frameSlider.max = "0";
      els.frameSlider.value = "0";
      els.frameLabel.textContent = fileIds.length ? "No matching files" : "Load order first";
      if (fileIds.length) setStatus("Layer unavailable", LAYERS[selectedLayer].empty);
      return;
    }

    if (!timeSteps.includes(selectedStep)) {
      selectedStep = timeSteps.includes("+00") ? "+00" : timeSteps[0];
      localStorage.setItem(STORAGE.timeStep, selectedStep);
    }

    chooseSelectedFile();
    updateFrameUi();
  }

  function chooseSelectedFile() {
    selectedFileId = layerFiles.find((fileId) => extractTimeStep(fileId) === selectedStep) || layerFiles[0] || "";
  }

  function updateFrameUi() {
    const index = Math.max(0, timeSteps.indexOf(selectedStep));
    els.frameSlider.disabled = timeSteps.length <= 1;
    els.frameSlider.min = "0";
    els.frameSlider.max = String(Math.max(0, timeSteps.length - 1));
    els.frameSlider.value = String(index);
    els.frameLabel.textContent = selectedFileId ? `Model ${selectedStep} Â· ${selectedFileId}` : "No selected file";
  }

  function bumpFrame(delta) {
    if (!timeSteps.length) return;
    const currentIndex = Math.max(0, timeSteps.indexOf(selectedStep));
    const nextIndex = clamp(currentIndex + delta, 0, timeSteps.length - 1);
    selectedStep = timeSteps[nextIndex];
    localStorage.setItem(STORAGE.timeStep, selectedStep);
    chooseSelectedFile();
    updateFrameUi();
    previewSelectedFile();
  }

  async function previewSelectedFile() {
    const apiKey = getApiKey();
    const orderId = getOrderId();

    if (loadingImage) return;
    if (!apiKey || !orderId) {
      setStatus("Setup needed", "Paste a Map Images key and API Order ID first.");
      showSettings(true);
      return;
    }

    if (!fileIds.length) {
      await loadOrder({ forceRefresh: false, previewAfter: true });
      return;
    }

    rebuildLayerFiles();
    if (!selectedFileId) {
      setStatus("No image selected", LAYERS[selectedLayer].empty);
      return;
    }

    loadingImage = true;
    disableButtons(true);
    setStatus("Loading image", `${LAYERS[selectedLayer].label} Â· ${selectedFileId}`);

    try {
      const pngUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderId)}/latest/${encodeURIComponent(selectedFileId)}/data?includeLand=false`;
      const response = await fetch(pngUrl, {
        headers: {
          Accept: "image/png",
          apikey: apiKey
        }
      });
      if (!response.ok) throw new Error(`Met Office image request returned HTTP ${response.status}`);

      const rawBlob = await response.blob();
      const previewBlob = selectedLayer === "rainfall" ? await repaintRainfallBlob(rawBlob) : rawBlob;
      clearImageUrl();
      imageObjectUrl = URL.createObjectURL(previewBlob);
      els.image.src = imageObjectUrl;
      els.image.alt = `Met Office ${LAYERS[selectedLayer].label} map image: ${selectedFileId}`;
      els.image.hidden = false;
      els.placeholder.hidden = true;
      setStatus(
        "Preview loaded",
        selectedLayer === "rainfall"
          ? `${LAYERS[selectedLayer].label} Â· ${selectedFileId}. Atlas blue-only rainfall colour applied in-browser. One image request made for this selected frame only.`
          : `${LAYERS[selectedLayer].label} Â· ${selectedFileId}. One image request made for this selected frame only.`
      );
    } catch (error) {
      setStatus("Image error", error.message);
    } finally {
      loadingImage = false;
      disableButtons(false);
    }
  }

  async function repaintRainfallBlob(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 8 || isBackground(r, g, b) || isLandMaskGreen(r, g, b)) {
        data[i + 3] = 0;
        continue;
      }

      const intensity = estimateRainIntensity(r, g, b);
      if (intensity < 0.06) {
        data[i + 3] = 0;
        continue;
      }

      const colour = atlasRainColour(intensity);
      data[i] = colour[0];
      data[i + 1] = colour[1];
      data[i + 2] = colour[2];
      data[i + 3] = Math.round(colour[3] * a);
    }

    ctx.putImageData(imageData, 0, 0);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  function isBackground(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max > 238 && min > 226;
  }

  function isLandMaskGreen(r, g, b) {
    return g > 155 && r < 125 && b < 145 && g - r > 55 && g - b > 45;
  }

  function estimateRainIntensity(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = (max - min) / 255;
    const darkness = 1 - ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    const blueSignal = Math.max(0, b - r) / 255;
    const cyanSignal = Math.max(0, Math.min(g, b) - r) / 255;
    const warmSignal = Math.max(0, r - b) / 255;

    return clamp((darkness * 0.58) + (saturation * 0.22) + (blueSignal * 0.18) + (cyanSignal * 0.12) + (warmSignal * 0.08), 0, 1);
  }

  function atlasRainColour(intensity) {
    if (intensity < 0.16) return [181, 246, 255, 0.26];
    if (intensity < 0.31) return [111, 230, 255, 0.42];
    if (intensity < 0.49) return [49, 190, 255, 0.58];
    if (intensity < 0.68) return [0, 132, 255, 0.72];
    if (intensity < 0.84) return [0, 78, 224, 0.84];
    return [226, 250, 255, 0.94];
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

  function getApiKey() {
    return els.key.value.trim();
  }

  function getOrderId() {
    return normaliseOrderId(els.order.value);
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

  function updateSavedNote(message = "") {
    const hasKey = Boolean(localStorage.getItem(STORAGE.key));
    const orderId = localStorage.getItem(STORAGE.order) || "not saved";
    els.storageNote.textContent = message || `Local storage: ${hasKey ? "key saved" : "no key saved"}; order: ${orderId}. Nothing is committed to GitHub.`;
  }

  function setStatus(title, body) {
    els.status.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(body)}`;
  }

  function showSettings(show) {
    els.settingsPanel.hidden = !show;
  }

  function disableButtons(disabled) {
    els.refreshButton.disabled = disabled;
    els.saveButton.disabled = disabled;
    els.prevFrame.disabled = disabled || !timeSteps.length;
    els.nextFrame.disabled = disabled || !timeSteps.length;
    els.layerButtons.forEach((button) => { button.disabled = disabled; });
  }

  function clearImageUrl() {
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = "";
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>\"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    })[char]);
  }
})();
