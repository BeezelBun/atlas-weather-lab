/* Met Office DataHub Map Images full-screen preview v0.3.7
   - Restores provider navigation on the full-screen page.
   - Uses locally saved Map Images key/API Order ID.
   - Caches the order file list so the order does not relist hundreds of files every view.
   - Shows one selected PNG at a time with layer buttons and the full available model time extent.
   - Parses Met Office filenames using ts0/ts1/ts168 style time steps.
   - Repaints rainfall images by Met Office mm/hour palette bands into an exact Met Office mm/hour legend colours with exact rainfall-band filters and a separate #B3D0AE land fill.
   - Does not commit keys or order data to GitHub.
*/
(() => {
  const METOFFICE_MAP_IMAGES_BASE = "https://data.hub.api.metoffice.gov.uk/map-images/1.0.0";

  const STORAGE = {
    key: "atlasWeatherLab.metOffice.mapImages.apiKey",
    order: "atlasWeatherLab.metOffice.mapImages.orderId",
    layer: "atlasWeatherLab.metOffice.mapImages.layer",
    timeStep: "atlasWeatherLab.metOffice.mapImages.timeStep",
    viewMode: "atlasWeatherLab.metOffice.mapImages.viewMode",
    visibleBands: "atlasWeatherLab.metOffice.mapImages.visibleBands",
    showLand: "atlasWeatherLab.metOffice.mapImages.showLand",
    cachePrefix: "atlasWeatherLab.metOffice.mapImages.fileCache.v037."
  };

  const LAYERS = {
    rainfall: {
      label: "Rainfall",
      title: "Rainfall / precipitation rate",
      matcher: /(precip|rainfall|rain)/i,
      empty: "No rainfall image matched this order.",
      legend: "Met Office precipitation-rate model PNG, cleaned into exact mm/hour legend colours with transparent background."
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

  const LAND_FILL = { label: "Land", hex: "#B3D0AE", rgb: [179, 208, 174], alpha: 1 };

  const RAIN_BANDS = [
    { id: "lt05", label: "<0.5", detail: "very light", mmh: "<0.5 mm/h", hex: "#0100FB", atlas: [1, 0, 251, 0.92], rawSamples: [[1, 0, 251], [2, 28, 225], [0, 0, 190], [18, 42, 210]] },
    { id: "05-1", label: "0.5-1", detail: "light", mmh: "0.5-1 mm/h", hex: "#3A63F7", atlas: [58, 99, 247, 0.92], rawSamples: [[58, 99, 247], [45, 95, 245], [42, 116, 255], [0, 105, 230]] },
    { id: "1-2", label: "1-2", detail: "showery", mmh: "1-2 mm/h", hex: "#0FBCFF", atlas: [15, 188, 255, 0.92], rawSamples: [[15, 188, 255], [70, 190, 240], [67, 210, 255], [0, 188, 230]] },
    { id: "2-4", label: "2-4", detail: "moderate", mmh: "2-4 mm/h", hex: "#0FA200", atlas: [15, 162, 0, 0.94], rawSamples: [[15, 162, 0], [40, 170, 65], [70, 190, 60], [0, 165, 90]] },
    { id: "4-8", label: "4-8", detail: "heavy", mmh: "4-8 mm/h", hex: "#FCCA15", atlas: [252, 202, 21, 0.96], rawSamples: [[252, 202, 21], [245, 225, 45], [255, 238, 65], [230, 214, 30]] },
    { id: "8-16", label: "8-16", detail: "very heavy", mmh: "8-16 mm/h", hex: "#FD9619", atlas: [253, 150, 25, 0.97], rawSamples: [[253, 150, 25], [255, 172, 48], [255, 146, 35], [242, 126, 22]] },
    { id: "16-32", label: "16-32", detail: "intense", mmh: "16-32 mm/h", hex: "#FC0600", atlas: [252, 6, 0, 0.98], rawSamples: [[252, 6, 0], [245, 50, 45], [235, 38, 35], [255, 71, 52]] },
    { id: "gt32", label: "32+", detail: "extreme", mmh: "32+ mm/h", hex: "#B30500", atlas: [179, 5, 0, 0.98], rawSamples: [[179, 5, 0], [150, 0, 0], [190, 0, 0], [120, 0, 0]] }
  ];
  const RAW_RAIN_SAMPLE_POINTS = RAIN_BANDS.flatMap((band, bandIndex) =>
    band.rawSamples.map((rgb) => ({ bandIndex, rgb }))
  );

  const els = {
    image: document.getElementById("metOfficeImage"),
    placeholder: document.getElementById("metOfficePlaceholder"),
    status: document.getElementById("metOfficeStatus"),
    legend: document.getElementById("metOfficeLegend"),
    bandFilters: document.getElementById("metOfficeBandFilters"),
    frameTitle: document.getElementById("metOfficeFrameTitle"),
    frameLabel: document.getElementById("metOfficeFrameLabel"),
    frameMeta: document.getElementById("metOfficeFrameMeta"),
    validLabel: document.getElementById("metOfficeValidLabel"),
    rangeLabel: document.getElementById("metOfficeRangeLabel"),
    atlasColourButton: document.getElementById("atlasColourButton"),
    rawColourButton: document.getElementById("rawColourButton"),
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
  let frames = [];
  let selectedLayer = localStorage.getItem(STORAGE.layer) || "rainfall";
  let selectedFrameKey = localStorage.getItem(STORAGE.timeStep) || "000";
  let selectedFileId = "";
  let selectedViewMode = localStorage.getItem(STORAGE.viewMode) || "atlas";
  let visibleRainBands = readVisibleRainBands();
  let showLandFill = localStorage.getItem(STORAGE.showLand) !== "false";
  let lastRawBlob = null;
  let lastRainBandCounts = new Array(RAIN_BANDS.length).fill(0);
  let lastLandPixelCount = 0;
  let rawImageObjectUrl = "";
  let atlasImageObjectUrl = "";
  let loadingImage = false;

  restoreInputs();
  bindEvents();
  setActiveLayer(selectedLayer, { preview: false });
  updateViewToggle();
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

    els.bandFilters.addEventListener("change", (event) => {
      const target = event.target;
      if (!target?.matches?.("input[data-band-id], input[data-land-fill]")) return;
      if (target.matches("input[data-land-fill]")) {
        showLandFill = target.checked;
        localStorage.setItem(STORAGE.showLand, showLandFill ? "true" : "false");
      } else {
        const bandId = target.dataset.bandId;
        if (target.checked) visibleRainBands.add(bandId);
        else visibleRainBands.delete(bandId);
        localStorage.setItem(STORAGE.visibleBands, JSON.stringify([...visibleRainBands]));
      }
      renderLegend();
      repaintCurrentRainfallImage();
    });

    els.frameSlider.addEventListener("input", () => {
      const index = Number(els.frameSlider.value || 0);
      selectedFrameKey = frames[index]?.key || selectedFrameKey;
      localStorage.setItem(STORAGE.timeStep, selectedFrameKey);
      chooseSelectedFile();
      updateFrameUi();
    });

    els.frameSlider.addEventListener("change", () => previewSelectedFile());
    els.atlasColourButton.addEventListener("click", () => setViewMode("atlas"));
    els.rawColourButton.addEventListener("click", () => setViewMode("raw"));
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
    localStorage.setItem(STORAGE.timeStep, selectedFrameKey);
    localStorage.setItem(STORAGE.viewMode, selectedViewMode);
    localStorage.setItem(STORAGE.visibleBands, JSON.stringify([...visibleRainBands]));
    localStorage.setItem(STORAGE.showLand, showLandFill ? "true" : "false");
  }

  function forgetSavedKey() {
    clearImageUrl();
    const orderId = getOrderId();
    localStorage.removeItem(STORAGE.key);
    localStorage.removeItem(STORAGE.order);
    localStorage.removeItem(STORAGE.layer);
    localStorage.removeItem(STORAGE.timeStep);
    localStorage.removeItem(STORAGE.viewMode);
    localStorage.removeItem(STORAGE.visibleBands);
    localStorage.removeItem(STORAGE.showLand);
    if (orderId) localStorage.removeItem(cacheKey(orderId));

    fileIds = [];
    layerFiles = [];
    frames = [];
    selectedFileId = "";
    selectedFrameKey = "000";
    selectedViewMode = "atlas";
    visibleRainBands = readVisibleRainBands();
    showLandFill = true;
    lastRawBlob = null;
    lastRainBandCounts = new Array(RAIN_BANDS.length).fill(0);
    lastLandPixelCount = 0;
    updateViewToggle();
    els.key.value = "";
    els.order.value = "maps-uk1";
    els.image.hidden = true;
    els.placeholder.hidden = false;
    els.frameSlider.disabled = true;
    els.frameMeta.textContent = "Full model extent will appear after the order list loads.";
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
    updateViewToggle();
    els.frameTitle.textContent = LAYERS[selectedLayer].label;
    renderLegend();

    rebuildLayerFiles();
    if (preview) previewSelectedFile();
  }

  function renderLegend() {
    if (selectedLayer !== "rainfall") {
      els.bandFilters.hidden = true;
      els.bandFilters.innerHTML = "";
      els.legend.innerHTML = `<strong>${escapeHtml(LAYERS[selectedLayer].title)}</strong><span>${escapeHtml(LAYERS[selectedLayer].legend)}</span>`;
      return;
    }

    els.bandFilters.hidden = false;
    const bandControls = RAIN_BANDS.map((band, index) => {
      const checked = visibleRainBands.has(band.id) ? "checked" : "";
      const count = lastRainBandCounts[index] || 0;
      return `
        <label class="metoffice-band-toggle" style="--band-colour:${band.hex}">
          <input type="checkbox" data-band-id="${escapeHtml(band.id)}" ${checked} />
          <i aria-hidden="true"></i>
          <span><b>${escapeHtml(band.label)}</b><em>${escapeHtml(band.mmh)}</em></span>
          <small>${formatPixelCount(count)}</small>
        </label>`;
    }).join("");

    els.bandFilters.innerHTML = `
      <div class="metoffice-filter-title">
        <strong>Rainfall bands</strong>
        <span>Tick bands on/off to find what the PNG actually contains.</span>
      </div>
      <div class="metoffice-band-grid">${bandControls}</div>
      <label class="metoffice-band-toggle metoffice-land-toggle" style="--band-colour:${LAND_FILL.hex}">
        <input type="checkbox" data-land-fill="true" ${showLandFill ? "checked" : ""} />
        <i aria-hidden="true"></i>
        <span><b>Land</b><em>${LAND_FILL.hex}</em></span>
        <small>${formatPixelCount(lastLandPixelCount)}</small>
      </label>`;

    const activeBands = RAIN_BANDS.filter((band) => visibleRainBands.has(band.id)).map((band) => band.label).join(", ") || "none";
    els.legend.innerHTML = `
      <strong>Rainfall band mapper</strong>
      <span>Clean mm/h maps visible Met Office rainfall colours into the exact legend colours. Active bands: ${escapeHtml(activeBands)}. Land is repainted as ${LAND_FILL.hex}.</span>`;
  }

  function rebuildLayerFiles() {
    const matcher = LAYERS[selectedLayer].matcher;
    layerFiles = fileIds.filter((fileId) => matcher.test(fileId));
    frames = buildFrameList(layerFiles);

    if (!frames.length) {
      selectedFileId = "";
      els.frameSlider.disabled = true;
      els.frameSlider.min = "0";
      els.frameSlider.max = "0";
      els.frameSlider.value = "0";
      els.frameLabel.textContent = fileIds.length ? "No matching files" : "Load order first";
      els.frameMeta.textContent = fileIds.length ? LAYERS[selectedLayer].empty : "Full model extent will appear after the order list loads.";
      els.validLabel.textContent = "No valid time selected.";
      els.rangeLabel.textContent = fileIds.length ? "No matching frames for this layer." : "Load the order to see model frames.";
      if (fileIds.length) setStatus("Layer unavailable", LAYERS[selectedLayer].empty);
      return;
    }

    const savedKey = localStorage.getItem(STORAGE.timeStep);
    if (savedKey && frames.some((frame) => frame.key === savedKey)) {
      selectedFrameKey = savedKey;
    } else if (!frames.some((frame) => frame.key === selectedFrameKey)) {
      selectedFrameKey = frames.some((frame) => frame.key === "000") ? "000" : frames[0].key;
    }

    localStorage.setItem(STORAGE.timeStep, selectedFrameKey);
    chooseSelectedFile();
    updateFrameUi();
  }

  function buildFrameList(files) {
    const byKey = new Map();
    for (const fileId of files) {
      const info = extractFrameInfo(fileId);
      if (!byKey.has(info.key)) byKey.set(info.key, info);
    }
    return [...byKey.values()].sort((a, b) => a.hours - b.hours);
  }

  function chooseSelectedFile() {
    const currentFrame = frames.find((frame) => frame.key === selectedFrameKey) || frames[0];
    selectedFileId = currentFrame?.fileId || layerFiles[0] || "";
  }

  function updateFrameUi() {
    const index = Math.max(0, frames.findIndex((frame) => frame.key === selectedFrameKey));
    const frame = frames[index] || frames[0];
    els.frameSlider.disabled = frames.length <= 1;
    els.frameSlider.min = "0";
    els.frameSlider.max = String(Math.max(0, frames.length - 1));
    els.frameSlider.value = String(index);

    if (!frame) {
      els.frameLabel.textContent = "No selected file";
      els.validLabel.textContent = "No valid time selected.";
      els.rangeLabel.textContent = "No model frames matched this layer.";
      els.frameMeta.textContent = "No model frames matched this layer.";
      return;
    }

    const first = frames[0];
    const last = frames[frames.length - 1];
    const runText = frame.runLabel || "model run";
    const validText = frame.validLabel || `${frame.label} from ${runText}`;

    els.frameLabel.textContent = `${frame.label} - ${index + 1}/${frames.length}`;
    els.validLabel.textContent = `Valid: ${validText}`;
    els.rangeLabel.textContent = `Available: ${first.label} to ${last.label} - ${frames.length} frames`;
    els.frameMeta.textContent = `${runText} - selected file: ${selectedFileId}`;
  }

  function bumpFrame(delta) {
    if (!frames.length) return;
    const currentIndex = Math.max(0, frames.findIndex((frame) => frame.key === selectedFrameKey));
    const nextIndex = clamp(currentIndex + delta, 0, frames.length - 1);
    selectedFrameKey = frames[nextIndex].key;
    localStorage.setItem(STORAGE.timeStep, selectedFrameKey);
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
    setStatus("Loading image", `${LAYERS[selectedLayer].label} - ${selectedFileId}`);

    try {
      const includeLand = "true";
      const pngUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderId)}/latest/${encodeURIComponent(selectedFileId)}/data?includeLand=${includeLand}`;
      const response = await fetch(pngUrl, {
        headers: {
          Accept: "image/png",
          apikey: apiKey
        }
      });
      if (!response.ok) throw new Error(`Met Office image request returned HTTP ${response.status}`);

      const rawBlob = await response.blob();
      lastRawBlob = selectedLayer === "rainfall" ? rawBlob : null;
      clearImageUrl();
      rawImageObjectUrl = URL.createObjectURL(rawBlob);
      if (selectedLayer === "rainfall") {
        const atlasBlob = await repaintRainfallBlob(rawBlob);
        atlasImageObjectUrl = URL.createObjectURL(atlasBlob);
      } else {
        atlasImageObjectUrl = rawImageObjectUrl;
      }
      applySelectedImageUrl();
      els.image.alt = `Met Office ${LAYERS[selectedLayer].label} map image: ${selectedFileId}`;
      els.image.hidden = false;
      els.placeholder.hidden = true;
      setStatus(
        "Preview loaded",
        selectedLayer === "rainfall"
          ? `${LAYERS[selectedLayer].label} - ${selectedFileId}. Clean mm/h band filters and raw Met Office views are both ready from this one rainfall image request.`
          : `${LAYERS[selectedLayer].label} - ${selectedFileId}. One image request made for this selected frame only.`
      );
    } catch (error) {
      setStatus("Image error", error.message);
    } finally {
      loadingImage = false;
      disableButtons(false);
    }
  }

  async function repaintCurrentRainfallImage() {
    if (selectedLayer !== "rainfall" || !lastRawBlob || loadingImage) return;
    loadingImage = true;
    updateViewToggle();
    try {
      if (atlasImageObjectUrl && atlasImageObjectUrl !== rawImageObjectUrl) URL.revokeObjectURL(atlasImageObjectUrl);
      const atlasBlob = await repaintRainfallBlob(lastRawBlob);
      atlasImageObjectUrl = URL.createObjectURL(atlasBlob);
      applySelectedImageUrl();
      setStatus("Repainted locally", "No Met Office request was made. The selected rainfall bands were reapplied from the cached PNG in this browser.");
    } catch (error) {
      setStatus("Repaint error", error.message);
    } finally {
      loadingImage = false;
      updateViewToggle();
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
    const counts = new Array(RAIN_BANDS.length).fill(0);
    let landCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 8) {
        data[i + 3] = 0;
        continue;
      }

      if (isMetOfficeLand(r, g, b)) {
        landCount += 1;
        if (showLandFill) {
          paintPixel(data, i, LAND_FILL.rgb, LAND_FILL.alpha);
        } else {
          data[i + 3] = 0;
        }
        continue;
      }

      const bandIndex = classifyMetOfficeRainBand(r, g, b, a);
      if (bandIndex < 0) {
        data[i + 3] = 0;
        continue;
      }

      counts[bandIndex] += 1;
      const band = RAIN_BANDS[bandIndex];
      if (!visibleRainBands.has(band.id)) {
        data[i + 3] = 0;
        continue;
      }

      paintPixel(data, i, band.atlas, band.atlas[3]);
    }

    lastRainBandCounts = counts;
    lastLandPixelCount = landCount;
    ctx.putImageData(imageData, 0, 0);
    renderLegend();
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  function paintPixel(data, index, colour, alpha = 1) {
    data[index] = colour[0];
    data[index + 1] = colour[1];
    data[index + 2] = colour[2];
    data[index + 3] = Math.round(alpha * 255);
  }

  function classifyMetOfficeRainBand(r, g, b, a) {
    if (a < 8 || isBackground(r, g, b) || isGreyMapInk(r, g, b)) return -1;

    const nearest = nearestRainBand(r, g, b);
    if (!nearest) return -1;

    // The PNG is rendered and lightly antialiased, so exact hex matching is too strict.
    // This threshold catches the Met Office legend colours and their immediate blended edges,
    // but avoids classifying the B3D0AE land fill as 2-4 mm/h green rain.
    if (nearest.distance <= 9800) return nearest.bandIndex;

    return -1;
  }

  function isMetOfficeLand(r, g, b) {
    return weightedColourDistance(r, g, b, LAND_FILL.rgb[0], LAND_FILL.rgb[1], LAND_FILL.rgb[2]) <= 5600;
  }

  function nearestRainBand(r, g, b) {
    let best = null;
    for (const sample of RAW_RAIN_SAMPLE_POINTS) {
      const [sr, sg, sb] = sample.rgb;
      const distance = weightedColourDistance(r, g, b, sr, sg, sb);
      if (!best || distance < best.distance) {
        best = { bandIndex: sample.bandIndex, distance };
      }
    }
    return best;
  }

  function weightedColourDistance(r, g, b, sr, sg, sb) {
    const dr = r - sr;
    const dg = g - sg;
    const db = b - sb;
    const hueA = rgbToHue(r, g, b);
    const hueB = rgbToHue(sr, sg, sb);
    const hueDiff = Math.min(Math.abs(hueA - hueB), 360 - Math.abs(hueA - hueB));
    return (dr * dr * 0.9) + (dg * dg * 1.1) + (db * db * 1.0) + (hueDiff * hueDiff * 2.1);
  }

  function isBackground(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max > 238 && min > 226;
  }

  function isLandMaskGreen(r, g, b) {
    const hue = rgbToHue(r, g, b);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    return hue >= 95 && hue <= 145 && saturation > 0.38 && g > 135 && r < 130 && b < 150;
  }

  function isGreyMapInk(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min < 22 && max < 185;
  }

  function rgbToHue(r, g, b) {
    const nr = r / 255;
    const ng = g / 255;
    const nb = b / 255;
    const max = Math.max(nr, ng, nb);
    const min = Math.min(nr, ng, nb);
    const delta = max - min;
    if (!delta) return 0;
    let hue;
    if (max === nr) hue = ((ng - nb) / delta) % 6;
    else if (max === ng) hue = ((nb - nr) / delta) + 2;
    else hue = ((nr - ng) / delta) + 4;
    return (hue * 60 + 360) % 360;
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

  function extractFrameInfo(fileId) {
    const text = String(fileId || "");
    const tsMatch = text.match(/(?:^|[_-])ts(\d{1,3})(?=[_-]|$)/i);
    const plusRunMatch = text.match(/(?:^|[_-])\+(\d{1,2})(?=$|[_-]|\.)/);
    const datedRunMatch = text.match(/(?:^|[_-])(20\d{6})(\d{2})(?=$|[_-]|\.)/);
    const fallbackHourMatch = text.match(/(?:^|[_-])(\d{1,3})(?=$|\.)/);

    const hours = Number(tsMatch?.[1] ?? fallbackHourMatch?.[1] ?? 0);
    const safeHours = Number.isFinite(hours) ? hours : 0;
    const runHour = datedRunMatch ? Number(datedRunMatch[2]) : plusRunMatch ? Number(plusRunMatch[1]) : null;
    const runDate = datedRunMatch ? datedRunMatch[1] : "";
    const validHour = Number.isFinite(runHour) ? (runHour + safeHours) % 24 : null;
    const dayOffset = Number.isFinite(runHour) ? Math.floor((runHour + safeHours) / 24) : null;

    return {
      key: String(safeHours).padStart(3, "0"),
      hours: safeHours,
      label: `T+${safeHours}h`,
      runLabel: buildRunLabel(runDate, runHour),
      validLabel: buildValidLabel(runDate, runHour, safeHours, validHour, dayOffset),
      fileId: text
    };
  }

  function buildRunLabel(runDate, runHour) {
    if (runDate && Number.isFinite(runHour)) {
      return `${formatRunDate(runDate)} ${pad2(runHour)}Z run`;
    }
    if (Number.isFinite(runHour)) return `${pad2(runHour)}Z run`;
    return "model run";
  }

  function buildValidLabel(runDate, runHour, hours, validHour, dayOffset) {
    if (runDate && Number.isFinite(runHour)) {
      const year = Number(runDate.slice(0, 4));
      const month = Number(runDate.slice(4, 6)) - 1;
      const day = Number(runDate.slice(6, 8));
      const valid = new Date(Date.UTC(year, month, day, runHour + hours, 0, 0));
      return `${formatValidDate(valid)} UTC (${hours}h after ${pad2(runHour)}Z run)`;
    }
    if (Number.isFinite(validHour)) {
      const dayText = dayOffset ? `, day +${dayOffset}` : ", same day";
      return `${pad2(validHour)}:00 from ${pad2(runHour)}Z run${dayText}`;
    }
    return `T+${hours}h from selected run`;
  }

  function formatRunDate(value) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  function formatValidDate(date) {
    return date.toLocaleString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC"
    }).replace(",", "");
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatModelRun(value) {
    const text = String(value || "");
    if (!/^20\d{8}$/.test(text)) return text;
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}Z`;
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
    els.layerButtons.forEach((button) => { button.disabled = disabled; });
    els.refreshButton.disabled = disabled;
    els.forgetButton.disabled = disabled;
    els.prevFrame.disabled = disabled || frames.length <= 1;
    els.nextFrame.disabled = disabled || frames.length <= 1;
    els.frameSlider.disabled = disabled || frames.length <= 1;
    updateViewToggle();
  }

  function clearImageUrl() {
    if (rawImageObjectUrl) URL.revokeObjectURL(rawImageObjectUrl);
    if (atlasImageObjectUrl && atlasImageObjectUrl !== rawImageObjectUrl) URL.revokeObjectURL(atlasImageObjectUrl);
    rawImageObjectUrl = "";
    atlasImageObjectUrl = "";
  }

  function setViewMode(mode) {
    selectedViewMode = mode === "raw" ? "raw" : "atlas";
    localStorage.setItem(STORAGE.viewMode, selectedViewMode);
    updateViewToggle();
    applySelectedImageUrl();
  }

  function updateViewToggle() {
    const rainfallMode = selectedLayer === "rainfall";
    els.atlasColourButton.classList.toggle("is-active", selectedViewMode !== "raw");
    els.rawColourButton.classList.toggle("is-active", selectedViewMode === "raw");
    els.atlasColourButton.disabled = !rainfallMode || loadingImage;
    els.rawColourButton.disabled = !rainfallMode || loadingImage;
  }

  function applySelectedImageUrl() {
    const useRaw = selectedLayer !== "rainfall" || selectedViewMode === "raw";
    const url = useRaw ? rawImageObjectUrl : atlasImageObjectUrl;
    if (url) els.image.src = url;
    els.image.classList.toggle("is-raw-source", useRaw);
    els.image.classList.toggle("is-atlas-source", !useRaw);
  }

  function readVisibleRainBands() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE.visibleBands) || "null");
      if (Array.isArray(parsed)) {
        const allowed = new Set(RAIN_BANDS.map((band) => band.id));
        const visible = parsed.filter((id) => allowed.has(id));
        if (visible.length) return new Set(visible);
      }
    } catch {}
    return new Set(RAIN_BANDS.map((band) => band.id));
  }

  function formatPixelCount(value) {
    const count = Number(value || 0);
    if (!count) return "0";
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${Math.round(count / 100) / 10}k`;
    return String(count);
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    })[char]);
  }
})();
