/* Met Office DataHub Map Images clean rewrite v0.3.9
   - Bottom sheet collapses as one whole control pane.
   - Raw Met Office stays available as the reference image.
   - Clean rainfall mode classifies pixels against exact mm/hour legend colours with tolerance.
   - Key/order stay in localStorage only; no key/order data is committed to GitHub. */

(() => {
  "use strict";

  const VERSION = "0.3.9";
  const METOFFICE_MAP_IMAGES_BASE = "https://data.hub.api.metoffice.gov.uk/map-images/1.0.0";
  const UK_TIME_ZONE = "Europe/London";

  const STORAGE = {
    key: "atlasWeatherLab.metOffice.mapImages.apiKey",
    order: "atlasWeatherLab.metOffice.mapImages.orderId",
    layer: "atlasWeatherLab.metOffice.v039.layer",
    frame: "atlasWeatherLab.metOffice.v039.frame",
    view: "atlasWeatherLab.metOffice.v039.view",
    visibleBands: "atlasWeatherLab.metOffice.v039.visibleBands",
    showLand: "atlasWeatherLab.metOffice.v039.showLand",
    panelCollapsed: "atlasWeatherLab.metOffice.v039.panelCollapsed",
    cachePrefix: "atlasWeatherLab.metOffice.mapImages.fileCache.v039."
  };

  const LAND = {
    label: "Land",
    hex: "#B3D0AE",
    rgb: [179, 208, 174]
  };

  const RAIN_BANDS = [
    { id: "lt05", label: "<0.5", mmh: "<0.5 mm/h", hex: "#0100FB", rgb: [1, 0, 251] },
    { id: "05-1", label: "0.5â1", mmh: "0.5â1 mm/h", hex: "#3A63F7", rgb: [58, 99, 247] },
    { id: "1-2", label: "1â2", mmh: "1â2 mm/h", hex: "#0FBCFF", rgb: [15, 188, 255] },
    { id: "2-4", label: "2â4", mmh: "2â4 mm/h", hex: "#0FA200", rgb: [15, 162, 0] },
    { id: "4-8", label: "4â8", mmh: "4â8 mm/h", hex: "#FCCA15", rgb: [252, 202, 21] },
    { id: "8-16", label: "8â16", mmh: "8â16 mm/h", hex: "#FD9619", rgb: [253, 150, 25] },
    { id: "16-32", label: "16â32", mmh: "16â32 mm/h", hex: "#FC0600", rgb: [252, 6, 0] },
    { id: "gt32", label: "32+", mmh: "32+ mm/h", hex: "#B30500", rgb: [179, 5, 0] }
  ];

  const LAYERS = {
    rainfall: {
      label: "Rainfall",
      patterns: [/precip/i, /rainfall/i, /rain/i],
      empty: "No rainfall/precipitation files matched this order."
    },
    cloud: {
      label: "Cloud",
      patterns: [/cloud/i],
      empty: "No cloud files matched this order."
    },
    pressure: {
      label: "Pressure",
      patterns: [/pressure/i, /mean[_-]?sea/i, /meansea/i, /mslp/i, /msl/i],
      empty: "No pressure/MSLP files matched this order."
    },
    temperature: {
      label: "Temp",
      patterns: [/temperature/i, /temp/i],
      empty: "No temperature files matched this order."
    }
  };

  const RAIN_DISTANCE_TOLERANCE = 92;
  const RAIN_CHANNEL_TOLERANCE = 78;
  const LAND_DISTANCE_TOLERANCE = 82;
  const LAND_CHANNEL_TOLERANCE = 70;

  const els = {
    image: byId("moImage"),
    placeholder: byId("moPlaceholder"),
    status: byId("moStatus"),
    panel: byId("moPanel"),
    panelToggle: byId("moPanelToggle"),
    panelToggleText: byId("moPanelToggleText"),
    compactLayer: byId("moCompactLayer"),
    compactStep: byId("moCompactStep"),
    compactUtc: byId("moCompactUtc"),
    compactUk: byId("moCompactUk"),
    openSettings: byId("moOpenSettings"),
    openSettingsInline: byId("moOpenSettingsInline"),
    closeSettings: byId("moCloseSettings"),
    closeSetup: byId("moCloseSetup"),
    settingsPanel: byId("moSettingsPanel"),
    apiKey: byId("moApiKey"),
    orderId: byId("moOrderId"),
    saveSettings: byId("moSaveSettings"),
    forgetSettings: byId("moForgetSettings"),
    refreshOrder: byId("moRefreshOrder"),
    storageNote: byId("moStorageNote"),
    layerButtons: Array.from(document.querySelectorAll(".mo-layer-button[data-layer]")),
    frameCount: byId("moFrameCount"),
    prevFrame: byId("moPrevFrame"),
    nextFrame: byId("moNextFrame"),
    frameSlider: byId("moFrameSlider"),
    runLabel: byId("moRunLabel"),
    stepLabel: byId("moStepLabel"),
    validUtcLabel: byId("moValidUtcLabel"),
    validUkLabel: byId("moValidUkLabel"),
    cleanView: byId("moCleanView"),
    rawView: byId("moRawView"),
    metaLabel: byId("moMetaLabel"),
    bandDebug: byId("moBandDebug"),
    bandList: byId("moBandList"),
    countGrid: byId("moCountGrid"),
    allBands: byId("moAllBands"),
    noBands: byId("moNoBands"),
    showLand: byId("moShowLand")
  };

  const state = {
    fileIds: [],
    layerFiles: [],
    frames: [],
    layer: getStoredLayer(),
    frameKey: localStorage.getItem(STORAGE.frame) || "000",
    selectedFileId: "",
    viewMode: localStorage.getItem(STORAGE.view) || "clean",
    visibleBands: readVisibleBands(),
    showLand: localStorage.getItem(STORAGE.showLand) !== "false",
    panelCollapsed: localStorage.getItem(STORAGE.panelCollapsed) === "true",
    loading: false,
    rawBlob: null,
    rawUrl: "",
    cleanUrl: "",
    counts: emptyCounts()
  };

  init();

  function init() {
    restoreSettingsInputs();
    renderBandControls();
    renderCounts();
    bindEvents();
    applyPanelState();
    applyLayerButtons();
    applyViewButtons();
    applyFrameUi();
    applyBandVisibility();
    bootstrap();
  }

  function bindEvents() {
    els.panelToggle.addEventListener("click", togglePanel);
    els.openSettings.addEventListener("click", () => showSettings(true));
    els.openSettingsInline.addEventListener("click", () => showSettings(true));
    els.closeSettings.addEventListener("click", () => showSettings(false));
    els.closeSetup.addEventListener("click", () => showSettings(false));

    els.saveSettings.addEventListener("click", () => {
      saveSettings();
      showSettings(false);
      loadOrder({ forceRefresh: false, previewAfter: true });
    });

    els.forgetSettings.addEventListener("click", forgetSettings);
    els.refreshOrder.addEventListener("click", () => loadOrder({ forceRefresh: true, previewAfter: true }));

    els.layerButtons.forEach((button) => {
      button.addEventListener("click", () => setLayer(button.dataset.layer));
    });

    els.prevFrame.addEventListener("click", () => bumpFrame(-1));
    els.nextFrame.addEventListener("click", () => bumpFrame(1));

    els.frameSlider.addEventListener("input", () => {
      const index = Number(els.frameSlider.value || 0);
      const frame = state.frames[index];
      if (!frame) return;
      state.frameKey = frame.key;
      localStorage.setItem(STORAGE.frame, state.frameKey);
      chooseSelectedFrame();
      applyFrameUi();
    });

    els.frameSlider.addEventListener("change", () => loadSelectedImage());

    els.cleanView.addEventListener("click", () => setViewMode("clean"));
    els.rawView.addEventListener("click", () => setViewMode("raw"));

    els.bandList.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.dataset.bandId) return;
      if (input.checked) state.visibleBands.add(input.dataset.bandId);
      else state.visibleBands.delete(input.dataset.bandId);
      localStorage.setItem(STORAGE.visibleBands, JSON.stringify([...state.visibleBands]));
      repaintFromRaw("Rainfall bands changed locally. No API request was made.");
    });

    els.allBands.addEventListener("click", () => {
      state.visibleBands = new Set(RAIN_BANDS.map((band) => band.id));
      localStorage.setItem(STORAGE.visibleBands, JSON.stringify([...state.visibleBands]));
      renderBandControls();
      repaintFromRaw("All rainfall bands shown locally. No API request was made.");
    });

    els.noBands.addEventListener("click", () => {
      state.visibleBands = new Set();
      localStorage.setItem(STORAGE.visibleBands, JSON.stringify([]));
      renderBandControls();
      repaintFromRaw("All rainfall bands hidden locally. No API request was made.");
    });

    els.showLand.addEventListener("change", () => {
      state.showLand = els.showLand.checked;
      localStorage.setItem(STORAGE.showLand, state.showLand ? "true" : "false");
      repaintFromRaw("Land fill changed locally. No API request was made.");
    });
  }

  async function bootstrap() {
    const apiKey = getApiKey();
    const orderId = getOrderId();

    if (!apiKey || !orderId) {
      setStatus("Setup needed", "Paste the Map Images key and API Order ID once. They stay in this browser only.");
      showSettings(true);
      return;
    }

    const cached = readCachedFiles(orderId);
    if (cached.length) {
      state.fileIds = cached;
      rebuildLayerFiles();
      setStatus("Using cached order list", `${cached.length} file(s) available locally. The page will only fetch the selected PNG frame.`);
      await loadSelectedImage();
      return;
    }

    await loadOrder({ forceRefresh: false, previewAfter: true });
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
    disableControls(true);

    try {
      const cached = forceRefresh ? [] : readCachedFiles(orderId);
      if (cached.length) {
        state.fileIds = cached;
        rebuildLayerFiles();
        setStatus("Using cached order list", `${cached.length} file(s) available locally. No order-list request was made.`);
        if (previewAfter) await loadSelectedImage();
        return;
      }

      setStatus("Listing order", "Fetching the latest order file list once, then caching it locally.");
      const url = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderId)}/latest?detail=MINIMAL`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          apikey: apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Met Office latest-order request returned HTTP ${response.status}.`);
      }

      const json = await response.json();
      const files = findFileIds(json);

      if (!files.length) {
        throw new Error(`Order request worked, but no PNG/file IDs were found. JSON keys: ${Object.keys(json || {}).join(", ")}`);
      }

      state.fileIds = files;
      writeCachedFiles(orderId, files);
      rebuildLayerFiles();
      setStatus("Order OK", `${files.length} file(s) listed and cached. Only the selected PNG frame is fetched.`);

      if (previewAfter) await loadSelectedImage();
    } catch (error) {
      setStatus("Met Office error", getErrorMessage(error));
      showSettings(true);
    } finally {
      disableControls(false);
    }
  }

  async function loadSelectedImage() {
    const apiKey = getApiKey();
    const orderId = getOrderId();

    if (state.loading) return;

    if (!apiKey || !orderId) {
      setStatus("Setup needed", "Paste a Map Images key and API Order ID first.");
      showSettings(true);
      return;
    }

    if (!state.fileIds.length) {
      await loadOrder({ forceRefresh: false, previewAfter: true });
      return;
    }

    rebuildLayerFiles();

    if (!state.selectedFileId) {
      setStatus("Layer unavailable", LAYERS[state.layer].empty);
      return;
    }

    state.loading = true;
    disableControls(true);
    clearImageUrls();
    state.rawBlob = null;
    state.counts = emptyCounts();
    renderCounts();

    try {
      setStatus("Loading image", `${LAYERS[state.layer].label} Â· ${state.selectedFileId}`);
      const url = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderId)}/latest/${encodeURIComponent(state.selectedFileId)}/data?includeLand=true`;
      const response = await fetch(url, {
        headers: {
          Accept: "image/png",
          apikey: apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Met Office image request returned HTTP ${response.status}.`);
      }

      const blob = await response.blob();
      state.rawBlob = blob;
      state.rawUrl = URL.createObjectURL(blob);

      if (state.layer === "rainfall") {
        const cleanBlob = await repaintRainfallBlob(blob);
        state.cleanUrl = URL.createObjectURL(cleanBlob);
      } else {
        state.cleanUrl = state.rawUrl;
        state.viewMode = "raw";
        localStorage.setItem(STORAGE.view, state.viewMode);
      }

      applyImageSource();
      applyViewButtons();
      applyBandVisibility();
      els.image.alt = `Met Office ${LAYERS[state.layer].label} map image: ${state.selectedFileId}`;
      els.image.hidden = false;
      els.placeholder.hidden = true;

      setStatus(
        "Preview loaded",
        state.layer === "rainfall"
          ? "Raw reference and clean mm/h band view are ready from this one PNG request. Checkbox changes repaint locally."
          : `${LAYERS[state.layer].label} is shown as the raw Met Office PNG.`
      );
    } catch (error) {
      setStatus("Image error", getErrorMessage(error));
      els.image.hidden = true;
      els.placeholder.hidden = false;
    } finally {
      state.loading = false;
      disableControls(false);
    }
  }

  async function repaintFromRaw(message) {
    if (state.layer !== "rainfall" || !state.rawBlob || state.loading) return;

    state.loading = true;
    disableControls(true);

    try {
      if (state.cleanUrl && state.cleanUrl !== state.rawUrl) {
        URL.revokeObjectURL(state.cleanUrl);
      }

      const cleanBlob = await repaintRainfallBlob(state.rawBlob);
      state.cleanUrl = URL.createObjectURL(cleanBlob);
      applyImageSource();
      setStatus("Repainted locally", message);
    } catch (error) {
      setStatus("Repaint error", getErrorMessage(error));
    } finally {
      state.loading = false;
      disableControls(false);
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
    const counts = emptyCounts();

    for (let index = 0; index < data.length; index += 4) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];

      if (a < 8) {
        counts.transparent += 1;
        data[index + 3] = 0;
        continue;
      }

      const rainBandIndex = classifyRainBand(r, g, b);
      if (rainBandIndex >= 0) {
        const band = RAIN_BANDS[rainBandIndex];
        counts.bands[rainBandIndex] += 1;

        if (!state.visibleBands.has(band.id)) {
          counts.hiddenRain += 1;
          data[index + 3] = 0;
          continue;
        }

        paintPixel(data, index, band.rgb, 238);
        continue;
      }

      if (isLandPixel(r, g, b)) {
        counts.land += 1;
        if (state.showLand) paintPixel(data, index, LAND.rgb, 255);
        else data[index + 3] = 0;
        continue;
      }

      if (isLikelyMapInkOrBackground(r, g, b)) {
        counts.mapInk += 1;
        data[index + 3] = 0;
        continue;
      }

      counts.unmatched += 1;
      data[index + 3] = 0;
    }

    state.counts = counts;
    ctx.putImageData(imageData, 0, 0);
    renderBandControls();
    renderCounts();

    return await new Promise((resolve, reject) => {
      canvas.toBlob((cleanBlob) => {
        if (cleanBlob) resolve(cleanBlob);
        else reject(new Error("Canvas did not return a PNG blob."));
      }, "image/png");
    });
  }

  function classifyRainBand(r, g, b) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestMaxDelta = Number.POSITIVE_INFINITY;

    for (let index = 0; index < RAIN_BANDS.length; index += 1) {
      const colour = RAIN_BANDS[index].rgb;
      const dr = Math.abs(r - colour[0]);
      const dg = Math.abs(g - colour[1]);
      const db = Math.abs(b - colour[2]);
      const maxDelta = Math.max(dr, dg, db);
      const distance = Math.sqrt((dr * dr) + (dg * dg) + (db * db));

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMaxDelta = maxDelta;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) return -1;
    if (bestDistance <= RAIN_DISTANCE_TOLERANCE && bestMaxDelta <= RAIN_CHANNEL_TOLERANCE) return bestIndex;
    return -1;
  }

  function isLandPixel(r, g, b) {
    const dr = Math.abs(r - LAND.rgb[0]);
    const dg = Math.abs(g - LAND.rgb[1]);
    const db = Math.abs(b - LAND.rgb[2]);
    const distance = Math.sqrt((dr * dr) + (dg * dg) + (db * db));
    const maxDelta = Math.max(dr, dg, db);

    if (distance <= LAND_DISTANCE_TOLERANCE && maxDelta <= LAND_CHANNEL_TOLERANCE) return true;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const paleGreen = g >= 150 && r >= 125 && b >= 115 && g >= b && g >= r - 8;
    return paleGreen && saturation <= 0.36;
  }

  function isLikelyMapInkOrBackground(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const spread = max - min;
    if (max > 236 && spread < 18) return true;
    if (max < 42 && spread < 20) return true;
    if (spread < 18) return true;
    return false;
  }

  function paintPixel(data, index, rgb, alpha) {
    data[index] = rgb[0];
    data[index + 1] = rgb[1];
    data[index + 2] = rgb[2];
    data[index + 3] = alpha;
  }

  function setLayer(layer) {
    if (!LAYERS[layer] || layer === state.layer) return;

    state.layer = layer;
    localStorage.setItem(STORAGE.layer, state.layer);
    state.viewMode = layer === "rainfall" ? (localStorage.getItem(STORAGE.view) || "clean") : "raw";
    rebuildLayerFiles();
    applyLayerButtons();
    applyViewButtons();
    applyBandVisibility();
    loadSelectedImage();
  }

  function setViewMode(mode) {
    if (mode === "clean" && state.layer !== "rainfall") return;
    state.viewMode = mode === "raw" ? "raw" : "clean";
    localStorage.setItem(STORAGE.view, state.viewMode);
    applyViewButtons();
    applyImageSource();
  }

  function rebuildLayerFiles() {
    const layerConfig = LAYERS[state.layer];
    state.layerFiles = state.fileIds.filter((fileId) => matchesLayer(fileId, layerConfig));
    state.frames = buildFrames(state.layerFiles);

    if (!state.frames.length) {
      state.selectedFileId = "";
      applyFrameUi();
      return;
    }

    const savedFrame = localStorage.getItem(STORAGE.frame);
    if (savedFrame && state.frames.some((frame) => frame.key === savedFrame)) {
      state.frameKey = savedFrame;
    } else if (!state.frames.some((frame) => frame.key === state.frameKey)) {
      const zeroFrame = state.frames.find((frame) => frame.key === "000");
      state.frameKey = zeroFrame?.key || state.frames[0].key;
    }

    chooseSelectedFrame();
    applyFrameUi();
  }

  function matchesLayer(fileId, layerConfig) {
    const text = String(fileId || "");
    return layerConfig.patterns.some((pattern) => pattern.test(text));
  }

  function buildFrames(files) {
    const byKey = new Map();

    files.forEach((fileId) => {
      const frame = extractFrameInfo(fileId);
      if (!byKey.has(frame.key)) byKey.set(frame.key, frame);
    });

    return [...byKey.values()].sort((a, b) => a.stepHours - b.stepHours || a.fileId.localeCompare(b.fileId));
  }

  function chooseSelectedFrame() {
    const selected = state.frames.find((frame) => frame.key === state.frameKey) || state.frames[0];
    state.selectedFileId = selected?.fileId || "";
    if (selected) {
      state.frameKey = selected.key;
      localStorage.setItem(STORAGE.frame, state.frameKey);
    }
  }

  function bumpFrame(delta) {
    if (!state.frames.length) return;
    const currentIndex = Math.max(0, state.frames.findIndex((frame) => frame.key === state.frameKey));
    const nextIndex = clamp(currentIndex + delta, 0, state.frames.length - 1);
    state.frameKey = state.frames[nextIndex].key;
    localStorage.setItem(STORAGE.frame, state.frameKey);
    chooseSelectedFrame();
    applyFrameUi();
    loadSelectedImage();
  }

  function extractFrameInfo(fileId) {
    const text = String(fileId || "");
    const stepMatch = text.match(/(?:^|[_\-./])ts(\d{1,3})(?=[_\-./]|$)/i)
      || text.match(/(?:^|[_\-./])t\+?(\d{1,3})(?=[_\-./]|$)/i)
      || text.match(/(?:^|[_\-./])step[_\-]?(\d{1,3})(?=[_\-./]|$)/i)
      || text.match(/(?:^|[_\-./])(\d{1,3})(?=\.png$)/i);

    const stepHours = safeNumber(stepMatch?.[1], 0);
    const key = String(stepHours).padStart(3, "0");

    const datedRun = text.match(/(20\d{6})[_\-T]?([01]\d|2[0-3])(?:00)?z?/i);
    const runOnly = text.match(/(?:^|[_\-./])(?:run)?([01]\d|2[0-3])z(?=[_\-./]|$)/i)
      || text.match(/(?:^|[_\-./])([01]\d|2[0-3])utc(?=[_\-./]|$)/i);

    const runDateText = datedRun?.[1] || "";
    const runHour = datedRun ? Number(datedRun[2]) : runOnly ? Number(runOnly[1]) : null;
    const validDate = buildValidDate(runDateText, runHour, stepHours);

    return {
      key,
      stepHours,
      stepLabel: `T+${stepHours}`,
      runDateText,
      runHour,
      runLabel: formatRunLabel(runDateText, runHour),
      validUtcLabel: validDate ? formatUtcDateTime(validDate) : formatFallbackValidUtc(runHour, stepHours),
      validUkLabel: validDate ? formatUkDateTime(validDate) : "needs run date",
      fileId: text
    };
  }

  function buildValidDate(runDateText, runHour, stepHours) {
    if (!runDateText || !Number.isFinite(runHour)) return null;
    const year = Number(runDateText.slice(0, 4));
    const month = Number(runDateText.slice(4, 6));
    const day = Number(runDateText.slice(6, 8));
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day, runHour + stepHours, 0, 0));
  }

  function formatRunLabel(runDateText, runHour) {
    if (!Number.isFinite(runHour)) return "Run not parsed";
    const runText = `${pad2(runHour)}Z UTC`;
    if (!runDateText) return runText;
    return `${formatRunDate(runDateText)} ${runText}`;
  }

  function formatFallbackValidUtc(runHour, stepHours) {
    if (!Number.isFinite(runHour)) return "not parsed";
    const validHour = (runHour + stepHours) % 24;
    const dayOffset = Math.floor((runHour + stepHours) / 24);
    return `${pad2(validHour)}:00 UTC${dayOffset ? ` +${dayOffset}d` : ""}`;
  }

  function formatRunDate(text) {
    if (!/^20\d{6}$/.test(text)) return text;
    return `${text.slice(6, 8)}/${text.slice(4, 6)}/${text.slice(0, 4)}`;
  }

  function formatUtcDateTime(date) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date) + " UTC";
  }

  function formatUkDateTime(date) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: UK_TIME_ZONE,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short"
    }).format(date);
  }

  function applyFrameUi() {
    const index = Math.max(0, state.frames.findIndex((frame) => frame.key === state.frameKey));
    const frame = state.frames[index] || null;

    els.frameSlider.disabled = state.frames.length <= 1;
    els.frameSlider.min = "0";
    els.frameSlider.max = String(Math.max(0, state.frames.length - 1));
    els.frameSlider.value = String(index);
    els.prevFrame.disabled = state.loading || state.frames.length <= 1 || index <= 0;
    els.nextFrame.disabled = state.loading || state.frames.length <= 1 || index >= state.frames.length - 1;

    if (!frame) {
      els.frameCount.textContent = state.fileIds.length ? "No matching frames" : "Load order first";
      els.runLabel.textContent = "--";
      els.stepLabel.textContent = "--";
      els.validUtcLabel.textContent = "--";
      els.validUkLabel.textContent = "--";
      els.compactLayer.textContent = LAYERS[state.layer].label;
      els.compactStep.textContent = "--";
      els.compactUtc.textContent = "Valid UTC: --";
      els.compactUk.textContent = "Valid UK: --";
      els.metaLabel.textContent = state.fileIds.length ? LAYERS[state.layer].empty : "Full model extent will appear after the order list loads.";
      return;
    }

    const first = state.frames[0];
    const last = state.frames[state.frames.length - 1];
    els.frameCount.textContent = `${index + 1}/${state.frames.length} Â· ${first.stepLabel} to ${last.stepLabel}`;
    els.runLabel.textContent = frame.runLabel;
    els.stepLabel.textContent = frame.stepLabel;
    els.validUtcLabel.textContent = frame.validUtcLabel;
    els.validUkLabel.textContent = frame.validUkLabel;
    els.compactLayer.textContent = LAYERS[state.layer].label;
    els.compactStep.textContent = frame.stepLabel;
    els.compactUtc.textContent = `UTC: ${frame.validUtcLabel}`;
    els.compactUk.textContent = `UK: ${frame.validUkLabel}`;
    els.metaLabel.textContent = `Selected file: ${state.selectedFileId || frame.fileId}`;
  }

  function applyLayerButtons() {
    els.layerButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.layer === state.layer);
    });
  }

  function applyViewButtons() {
    const rainfall = state.layer === "rainfall";
    if (!rainfall && state.viewMode !== "raw") state.viewMode = "raw";
    els.cleanView.disabled = !rainfall || state.loading;
    els.rawView.disabled = state.loading;
    els.cleanView.classList.toggle("is-active", state.viewMode === "clean" && rainfall);
    els.rawView.classList.toggle("is-active", state.viewMode === "raw" || !rainfall);
  }

  function applyBandVisibility() {
    const rainfall = state.layer === "rainfall";
    els.bandDebug.hidden = !rainfall;
    els.showLand.checked = state.showLand;
  }

  function applyImageSource() {
    if (state.viewMode === "raw" || state.layer !== "rainfall") {
      els.image.src = state.rawUrl || state.cleanUrl || "";
      return;
    }
    els.image.src = state.cleanUrl || state.rawUrl || "";
  }

  function renderBandControls() {
    els.bandList.replaceChildren(...RAIN_BANDS.map((band, index) => {
      const row = document.createElement("label");
      row.className = "mo-band-row";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.bandId = band.id;
      input.checked = state.visibleBands.has(band.id);

      const swatch = document.createElement("span");
      swatch.className = "mo-band-swatch";
      swatch.style.background = band.hex;

      const main = document.createElement("span");
      main.className = "mo-band-main";

      const title = document.createElement("strong");
      title.textContent = band.label;

      const detail = document.createElement("span");
      detail.textContent = band.mmh;

      main.append(title, detail);

      const count = document.createElement("span");
      count.className = "mo-band-count";
      count.textContent = formatCount(state.counts.bands[index] || 0);

      row.append(input, swatch, main, count);
      return row;
    }));
  }

  function renderCounts() {
    const items = [
      ["Land", state.counts.land],
      ["Hidden rain", state.counts.hiddenRain],
      ["Map/background", state.counts.mapInk],
      ["Unmatched", state.counts.unmatched]
    ];

    els.countGrid.replaceChildren(...items.map(([label, count]) => {
      const box = document.createElement("div");
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      const countEl = document.createElement("strong");
      countEl.textContent = formatCount(count);
      box.append(labelEl, countEl);
      return box;
    }));
  }

  function togglePanel() {
    state.panelCollapsed = !state.panelCollapsed;
    localStorage.setItem(STORAGE.panelCollapsed, state.panelCollapsed ? "true" : "false");
    applyPanelState();
  }

  function applyPanelState() {
    els.panel.classList.toggle("is-collapsed", state.panelCollapsed);
    els.panelToggle.setAttribute("aria-expanded", state.panelCollapsed ? "false" : "true");
    els.panelToggleText.textContent = state.panelCollapsed ? "Expand" : "Collapse";
  }

  function showSettings(show) {
    els.settingsPanel.hidden = !show;
  }

  function restoreSettingsInputs() {
    els.apiKey.value = localStorage.getItem(STORAGE.key) || "";
    els.orderId.value = localStorage.getItem(STORAGE.order) || "maps-uk1";
    updateStorageNote();
  }

  function saveSettings() {
    const key = getApiKey();
    const orderId = getOrderId();
    if (key) localStorage.setItem(STORAGE.key, key);
    if (orderId) localStorage.setItem(STORAGE.order, orderId);
    els.orderId.value = orderId || els.orderId.value.trim();
    updateStorageNote("Saved locally on this device.");
  }

  function forgetSettings() {
    const orderId = getOrderId();
    clearImageUrls();
    localStorage.removeItem(STORAGE.key);
    localStorage.removeItem(STORAGE.order);
    localStorage.removeItem(STORAGE.layer);
    localStorage.removeItem(STORAGE.frame);
    localStorage.removeItem(STORAGE.view);
    localStorage.removeItem(STORAGE.visibleBands);
    localStorage.removeItem(STORAGE.showLand);
    localStorage.removeItem(STORAGE.panelCollapsed);
    if (orderId) localStorage.removeItem(cacheKey(orderId));

    state.fileIds = [];
    state.layerFiles = [];
    state.frames = [];
    state.selectedFileId = "";
    state.layer = "rainfall";
    state.frameKey = "000";
    state.viewMode = "clean";
    state.visibleBands = new Set(RAIN_BANDS.map((band) => band.id));
    state.showLand = true;
    state.rawBlob = null;
    state.counts = emptyCounts();

    els.apiKey.value = "";
    els.orderId.value = "maps-uk1";
    els.image.hidden = true;
    els.placeholder.hidden = false;

    renderBandControls();
    renderCounts();
    applyLayerButtons();
    applyViewButtons();
    applyBandVisibility();
    applyFrameUi();
    updateStorageNote("Saved key/order removed from this browser.");
    setStatus("Saved key removed", "Paste the Map Images key again when needed. Cached files were removed for the current order.");
    showSettings(true);
  }

  function getApiKey() {
    return els.apiKey.value.trim() || localStorage.getItem(STORAGE.key) || "";
  }

  function getOrderId() {
    return normaliseOrderId(els.orderId.value || localStorage.getItem(STORAGE.order) || "maps-uk1");
  }

  function normaliseOrderId(value) {
    return String(value || "").trim().replace(/^\/+|\/+$/g, "");
  }

  function updateStorageNote(message) {
    els.storageNote.textContent = message || "Key/order are stored only in browser localStorage, not GitHub.";
  }

  function setStatus(title, detail) {
    els.status.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = detail;
    els.status.append(strong, span);
  }

  function disableControls(disabled) {
    els.layerButtons.forEach((button) => { button.disabled = disabled; });
    els.refreshOrder.disabled = disabled;
    els.saveSettings.disabled = disabled;
    els.prevFrame.disabled = disabled || state.frames.length <= 1;
    els.nextFrame.disabled = disabled || state.frames.length <= 1;
    els.frameSlider.disabled = disabled || state.frames.length <= 1;
    els.cleanView.disabled = disabled || state.layer !== "rainfall";
    els.rawView.disabled = disabled;
    els.allBands.disabled = disabled;
    els.noBands.disabled = disabled;
    applyFrameUi();
    applyViewButtons();
  }

  function clearImageUrls() {
    if (state.rawUrl) URL.revokeObjectURL(state.rawUrl);
    if (state.cleanUrl && state.cleanUrl !== state.rawUrl) URL.revokeObjectURL(state.cleanUrl);
    state.rawUrl = "";
    state.cleanUrl = "";
    els.image.removeAttribute("src");
  }

  function findFileIds(json) {
    const output = new Set();

    visit(json, 0);
    return [...output].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    function visit(value, depth) {
      if (depth > 8 || value == null) return;

      if (typeof value === "string") {
        if (looksLikeFileId(value)) output.add(value);
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }

      if (typeof value === "object") {
        const candidate = value.fileId || value.filename || value.fileName || value.name || value.id || value.path;
        if (typeof candidate === "string" && looksLikeFileId(candidate)) output.add(candidate);
        Object.values(value).forEach((item) => visit(item, depth + 1));
      }
    }
  }

  function looksLikeFileId(text) {
    const value = String(text || "");
    if (!value) return false;
    if (/\.png(?:$|\?)/i.test(value)) return true;
    if (/(?:^|[_\-./])ts\d{1,3}(?=[_\-./]|$)/i.test(value)) return true;
    return /(rain|precip|cloud|pressure|mslp|temp|temperature)/i.test(value) && /(\d{8}|ts\d{1,3})/i.test(value);
  }

  function readCachedFiles(orderId) {
    try {
      const text = localStorage.getItem(cacheKey(orderId));
      const json = text ? JSON.parse(text) : null;
      return Array.isArray(json?.files) ? json.files.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function writeCachedFiles(orderId, files) {
    const payload = {
      version: VERSION,
      cachedAt: new Date().toISOString(),
      files
    };
    localStorage.setItem(cacheKey(orderId), JSON.stringify(payload));
  }

  function cacheKey(orderId) {
    return `${STORAGE.cachePrefix}${orderId}`;
  }

  function readVisibleBands() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE.visibleBands) || "null");
      if (Array.isArray(saved)) return new Set(saved.filter((id) => RAIN_BANDS.some((band) => band.id === id)));
    } catch {
      // Fall back to all bands.
    }
    return new Set(RAIN_BANDS.map((band) => band.id));
  }

  function getStoredLayer() {
    const stored = localStorage.getItem(STORAGE.layer);
    return LAYERS[stored] ? stored : "rainfall";
  }

  function emptyCounts() {
    return {
      bands: new Array(RAIN_BANDS.length).fill(0),
      land: 0,
      hiddenRain: 0,
      mapInk: 0,
      transparent: 0,
      unmatched: 0
    };
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString("en-GB");
  }

  function safeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing required element #${id}`);
    return element;
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
})();
