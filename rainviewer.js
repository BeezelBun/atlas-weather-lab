/* RainViewer standalone test page v0.2.3
   Uses the free RainViewer Universal Blue tiles, then repaints warm/yellow intensity pixels
   in-browser so the Atlas hazard overlay stays blue/cyan rather than yellow/orange.
*/

(() => {
  const Lab = window.AtlasWeatherLab;
  const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
  const RAINVIEWER_FREE_COLOUR_SCHEME = 2;

  const state = {
    frames: [],
    radarLayer: null,
    recolourFallbackWarned: false
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

  const BlueRepaintRadarLayer = L.TileLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement("canvas");
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      tile.className = "atlas-radar-canvas";

      const image = new Image();
      image.crossOrigin = "anonymous";

      image.onload = () => {
        const ctx = tile.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, size.x, size.y);

        try {
          const imageData = ctx.getImageData(0, 0, size.x, size.y);
          repaintWarmRadarPixels(imageData.data);
          ctx.putImageData(imageData, 0, 0);
        } catch (error) {
          // If the tile server ever blocks pixel reads, keep the radar visible and fall back to CSS.
          tile.classList.add("atlas-radar-css-fallback");
          if (!state.recolourFallbackWarned) {
            state.recolourFallbackWarned = true;
            setStatus("Radar loaded. Browser blocked pixel repaint, so CSS fallback is being used.");
          }
        }

        done(null, tile);
      };

      image.onerror = () => done(new Error("RainViewer tile failed"), tile);
      image.src = this.getTileUrl(coords);
      return tile;
    }
  });

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
      setStatus(`${state.frames.length} radar frames loaded. Yellow/orange intensity pixels are repainted to cyan for this Atlas test.`);
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
    const tileUrl = `${frame.host}${frame.path}/256/{z}/{x}/{y}/${RAINVIEWER_FREE_COLOUR_SCHEME}/1_1.png`;

    state.radarLayer = new BlueRepaintRadarLayer(tileUrl, {
      opacity,
      maxZoom: 19,
      maxNativeZoom: 7,
      pane: "tilePane",
      className: "radar-blue-recolour",
      attribution: "RainViewer radar"
    }).addTo(map);

    els.radarTimeLabel.textContent = Lab.formatTime(frame.time);
  }

  function repaintWarmRadarPixels(data) {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 8) continue;

      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturationHint = max - min;

      const isYellow = red > 150 && green > 125 && blue < 135;
      const isOrange = red > 170 && green > 70 && green < 190 && blue < 125;
      const isRed = red > 175 && green < 95 && blue < 95;
      const isWarmIntensity = saturationHint > 45 && (isYellow || isOrange || isRed);

      if (!isWarmIntensity) continue;

      const strength = Math.min(1, Math.max(0, (max - 110) / 145));
      data[index] = Math.round(104 + 70 * strength);      // R
      data[index + 1] = Math.round(218 + 30 * strength);  // G
      data[index + 2] = 255;                              // B
      data[index + 3] = Math.max(alpha, 168);              // A
    }
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
