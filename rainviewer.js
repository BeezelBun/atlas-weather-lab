/* RainViewer standalone test page v0.2.6
   Auto-loads the latest observed radar frame at 95% opacity.
   The top pill is now the observed-frame slider.
   Rain is kept blue/cyan; warm RainViewer core pixels are cooled into bright blue-white.
*/

(() => {
  const Lab = window.AtlasWeatherLab;
  const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
  const RAINVIEWER_FREE_COLOUR_SCHEME = 2;
  const DEFAULT_OPACITY = 0.95;

  const state = {
    frames: [],
    hourlyFrames: [],
    radarLayer: null,
    recolourFallbackWarned: false
  };

  const els = {
    statusText: document.getElementById("statusText"),
    loadRadarButton: document.getElementById("loadRadarButton"),
    clearRadarButton: document.getElementById("clearRadarButton"),
    radarFrameRange: document.getElementById("radarFrameRange"),
    radarTimeLabel: document.getElementById("radarTimeLabel"),
    radarFrameCount: document.getElementById("radarFrameCount"),
    radarOpacityLabel: document.getElementById("radarOpacityLabel")
  };

  const map = Lab.createBaseMap("map", { center: [54.1, -3.1], zoom: 6 });

  const BlueRadarLayer = L.TileLayer.extend({
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
          repaintRadarPixels(imageData.data);
          ctx.putImageData(imageData, 0, 0);
        } catch (error) {
          tile.style.filter = "url(#atlasSoftBlueRadar) saturate(1.18)";
          if (!state.recolourFallbackWarned) {
            state.recolourFallbackWarned = true;
            setStatus("Observed radar loaded. Browser blocked exact blue repaint, so fallback blue filter is being used.");
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
  initialiseRadar();

  function bindEvents() {
    els.loadRadarButton?.addEventListener("click", () => loadFrames({ manual: true }));
    els.clearRadarButton?.addEventListener("click", clearOverlay);
    els.radarFrameRange?.addEventListener("input", () => showFrame(Number(els.radarFrameRange.value)));
  }

  async function initialiseRadar() {
    setFixedOpacityLabel();
    setStatus("Loading latest observed RainViewer radar automatically...");
    await loadFrames({ manual: false });
  }

  async function loadFrames({ manual } = { manual: false }) {
    if (els.loadRadarButton) {
      els.loadRadarButton.disabled = true;
      els.loadRadarButton.textContent = manual ? "Reloading observed radar..." : "Loading observed radar...";
    }

    try {
      const response = await fetch(RAINVIEWER_API, { cache: "no-store" });
      if (!response.ok) throw new Error(`RainViewer HTTP ${response.status}`);

      const data = await response.json();
      const frames = data?.radar?.past || [];
      if (!frames.length) throw new Error("No observed radar frames returned.");

      state.frames = frames.map(frame => ({ ...frame, host: data.host }));
      state.hourlyFrames = makeHourlyFrames(state.frames);

      const sliderFrames = getSliderFrames();
      const latestIndex = Math.max(0, sliderFrames.length - 1);

      if (els.radarFrameRange) {
        els.radarFrameRange.min = "0";
        els.radarFrameRange.max = String(latestIndex);
        els.radarFrameRange.value = String(latestIndex);
      }

      showFrame(latestIndex);
      updateFrameCountLabel();
      setStatus(`${state.frames.length} observed radar frames loaded. Top slider uses hourly observed points, and the latest observed frame is shown at 95% opacity.`);
    } catch (error) {
      setStatus(`RainViewer failed: ${error.message}`);
    } finally {
      if (els.loadRadarButton) {
        els.loadRadarButton.disabled = false;
        els.loadRadarButton.textContent = "Reload observed radar";
      }
    }
  }

  function makeHourlyFrames(frames) {
    const byHour = new Map();

    frames.forEach(frame => {
      const date = new Date(frame.time * 1000);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
      byHour.set(key, frame); // keep the latest frame within each local hour
    });

    const hourly = [...byHour.values()].sort((a, b) => a.time - b.time);
    const latest = frames[frames.length - 1];

    if (latest && hourly[hourly.length - 1]?.time !== latest.time) {
      hourly.push(latest);
    }

    return hourly.length ? hourly : frames;
  }

  function getSliderFrames() {
    return state.hourlyFrames.length ? state.hourlyFrames : state.frames;
  }

  function showFrame(index) {
    const sliderFrames = getSliderFrames();
    const frame = sliderFrames[index];
    if (!frame) return;

    if (state.radarLayer) map.removeLayer(state.radarLayer);

    const tileUrl = `${frame.host}${frame.path}/256/{z}/{x}/{y}/${RAINVIEWER_FREE_COLOUR_SCHEME}/1_1.png`;

    state.radarLayer = new BlueRadarLayer(tileUrl, {
      opacity: DEFAULT_OPACITY,
      maxZoom: 19,
      maxNativeZoom: 7,
      pane: "tilePane",
      attribution: "RainViewer radar"
    }).addTo(map);

    if (els.radarTimeLabel) els.radarTimeLabel.textContent = Lab.formatTime(frame.time);
    updateFrameCountLabel(index);
  }

  function repaintRadarPixels(data) {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 8) continue;

      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturation = max - min;

      const isYellow = red > 145 && green > 115 && blue < 160 && red + green > 280;
      const isOrange = red > 150 && green > 55 && green < 210 && blue < 160 && red > blue + 40;
      const isRed = red > 165 && green < 130 && blue < 140 && red > green + 35;
      const isWarmRadarPixel = saturation > 35 && (isYellow || isOrange || isRed);

      if (!isWarmRadarPixel) continue;

      const brightness = (red + green + blue) / 3;
      const strength = Math.min(1, Math.max(0, (brightness - 90) / 145));
      const heavyCore = red > 190 || brightness > 145 || isRed;

      if (heavyCore) {
        // Heavy rain is still rain: make the core bright blue-white, not yellow/orange/purple.
        data[index] = Math.round(155 + 55 * strength);
        data[index + 1] = Math.round(232 + 23 * strength);
        data[index + 2] = 255;
        data[index + 3] = Math.max(alpha, 184);
      } else {
        // Warm fringes become normal cyan-blue rain.
        data[index] = Math.round(60 + 45 * strength);
        data[index + 1] = Math.round(198 + 44 * strength);
        data[index + 2] = 255;
        data[index + 3] = Math.max(alpha, 150);
      }
    }
  }

  function clearOverlay() {
    if (state.radarLayer) map.removeLayer(state.radarLayer);
    state.radarLayer = null;
    if (els.radarTimeLabel) els.radarTimeLabel.textContent = "--:--";
    setStatus("Observed radar overlay cleared. Reload observed radar to restore the latest frame.");
  }

  function updateFrameCountLabel(index) {
    if (!els.radarFrameCount) return;
    const sliderFrames = getSliderFrames();
    const current = Number.isFinite(Number(index)) ? Number(index) + 1 : sliderFrames.length;
    els.radarFrameCount.textContent = `${current}/${sliderFrames.length} hourly`;
  }

  function setFixedOpacityLabel() {
    if (els.radarOpacityLabel) els.radarOpacityLabel.textContent = "95%";
  }

  function setStatus(text) {
    if (els.statusText) els.statusText.textContent = text;
  }
})();
