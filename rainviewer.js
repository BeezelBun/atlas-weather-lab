/* RainViewer standalone test page v0.2.2 */

(() => {
  const Lab = window.AtlasWeatherLab;
  const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";

  const state = {
    frames: [],
    radarLayer: null
  };

  const els = {
    statusText: document.getElementById("statusText"),
    loadRadarButton: document.getElementById("loadRadarButton"),
    clearRadarButton: document.getElementById("clearRadarButton"),
    radarFrameRange: document.getElementById("radarFrameRange"),
    radarTimeLabel: document.getElementById("radarTimeLabel"),
    radarOpacityRange: document.getElementById("radarOpacityRange"),
    radarOpacityLabel: document.getElementById("radarOpacityLabel")
  };

  const map = Lab.createBaseMap("map", { center: [54.1, -3.1], zoom: 6 });

  bindEvents();
  setStatus("Ready. Load RainViewer frames to show the latest radar blob tile layer.");

  function bindEvents() {
    els.loadRadarButton.addEventListener("click", loadFrames);
    els.clearRadarButton.addEventListener("click", clearOverlay);
    els.radarFrameRange.addEventListener("input", () => showFrame(Number(els.radarFrameRange.value)));
    els.radarOpacityRange.addEventListener("input", () => {
      const opacity = Number(els.radarOpacityRange.value) / 100;
      els.radarOpacityLabel.textContent = `${els.radarOpacityRange.value}%`;
      if (state.radarLayer) state.radarLayer.setOpacity(opacity);
    });
  }

  async function loadFrames() {
    els.loadRadarButton.disabled = true;
    setStatus("Loading RainViewer framesâ¦");

    try {
      const response = await fetch(RAINVIEWER_API, { cache: "no-store" });
      if (!response.ok) throw new Error(`RainViewer HTTP ${response.status}`);

      const data = await response.json();
      const frames = data?.radar?.past || [];
      if (!frames.length) throw new Error("No radar frames returned.");

      state.frames = frames.map(frame => ({ ...frame, host: data.host }));
      els.radarFrameRange.max = String(state.frames.length - 1);
      els.radarFrameRange.value = String(state.frames.length - 1);
      showFrame(state.frames.length - 1);
      setStatus(`${state.frames.length} radar frames loaded. Scrub the frame slider to check blob movement.`);
    } catch (error) {
      setStatus(`RainViewer failed: ${error.message}`);
    } finally {
      els.loadRadarButton.disabled = false;
    }
  }

  function showFrame(index) {
    const frame = state.frames[index];
    if (!frame) return;

    if (state.radarLayer) map.removeLayer(state.radarLayer);

    const opacity = Number(els.radarOpacityRange.value) / 100;
    const tileUrl = `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;

    state.radarLayer = L.tileLayer(tileUrl, {
      opacity,
      maxZoom: 19,
      maxNativeZoom: 7,
      pane: "tilePane",
      className: "radar-blue-recolour",
      attribution: "RainViewer radar"
    }).addTo(map);

    els.radarTimeLabel.textContent = Lab.formatTime(frame.time);
  }

  function clearOverlay() {
    if (state.radarLayer) map.removeLayer(state.radarLayer);
    state.radarLayer = null;
    els.radarTimeLabel.textContent = "â";
    setStatus("Radar overlay cleared. Frames stay available until refresh or reload.");
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }
})();
