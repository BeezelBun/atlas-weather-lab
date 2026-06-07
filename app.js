/* Atlas Weather API Lab v0.1.0
   Purpose: isolated provider testing before merging any weather logic into FieldOps Atlas.
   Public/static-safe: no committed API keys; Met Office keys are browser-session inputs only.
*/

const LAB_VERSION = "0.1.0";
const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";
const METOFFICE_MAP_IMAGES_BASE = "https://data.hub.api.metoffice.gov.uk/map-images/1.0.0";
const MAX_SITES_PER_BATCH = 40;

const fallbackRegions = [
  {
    id: "west-wales",
    name: "West Wales",
    bounds: [[51.55, -5.65], [52.55, -3.65]],
    sites: [
      { id: "WW-001", name: "Preseli", lat: 51.946, lon: -4.735 },
      { id: "WW-002", name: "Haverfordwest", lat: 51.801, lon: -4.969 },
      { id: "WW-003", name: "Fishguard", lat: 52.004, lon: -4.982 },
      { id: "WW-004", name: "Blaenplwyf", lat: 52.386, lon: -4.075 },
      { id: "WW-005", name: "Carmarthen", lat: 51.857, lon: -4.312 }
    ]
  },
  {
    id: "north-wales",
    name: "North Wales",
    bounds: [[52.55, -4.95], [53.45, -2.8]],
    sites: [
      { id: "NW-001", name: "Llanddona", lat: 53.294, lon: -4.126 },
      { id: "NW-002", name: "Moel-y-Parc", lat: 53.217, lon: -3.255 },
      { id: "NW-003", name: "Bangor", lat: 53.227, lon: -4.129 },
      { id: "NW-004", name: "Wrexham", lat: 53.046, lon: -2.993 },
      { id: "NW-005", name: "Bala", lat: 52.912, lon: -3.598 }
    ]
  },
  {
    id: "mid-wales",
    name: "Mid Wales",
    bounds: [[51.95, -4.15], [52.75, -2.75]],
    sites: [
      { id: "MW-001", name: "Aberystwyth", lat: 52.416, lon: -4.082 },
      { id: "MW-002", name: "Llandrindod Wells", lat: 52.242, lon: -3.378 },
      { id: "MW-003", name: "Newtown", lat: 52.513, lon: -3.314 },
      { id: "MW-004", name: "Brecon", lat: 51.947, lon: -3.391 },
      { id: "MW-005", name: "Machynlleth", lat: 52.590, lon: -3.854 }
    ]
  },
  {
    id: "south-wales",
    name: "South Wales",
    bounds: [[51.25, -4.3], [51.95, -2.55]],
    sites: [
      { id: "SW-001", name: "Swansea", lat: 51.621, lon: -3.944 },
      { id: "SW-002", name: "Wenvoe", lat: 51.456, lon: -3.284 },
      { id: "SW-003", name: "Cardiff", lat: 51.481, lon: -3.179 },
      { id: "SW-004", name: "Cwmbran", lat: 51.654, lon: -3.020 },
      { id: "SW-005", name: "Abergavenny", lat: 51.825, lon: -3.018 }
    ]
  },
  {
    id: "border-west",
    name: "Welsh Border",
    bounds: [[51.55, -3.1], [52.75, -2.0]],
    sites: [
      { id: "BW-001", name: "Hereford", lat: 52.056, lon: -2.716 },
      { id: "BW-002", name: "Shrewsbury", lat: 52.707, lon: -2.755 },
      { id: "BW-003", name: "Monmouth", lat: 51.812, lon: -2.714 },
      { id: "BW-004", name: "Ludlow", lat: 52.367, lon: -2.718 },
      { id: "BW-005", name: "Hay-on-Wye", lat: 52.075, lon: -3.125 }
    ]
  }
];

const state = {
  regions: [],
  visibleSites: [],
  radarFrames: [],
  radarLayer: null,
  siteLayer: null,
  labelLayer: null,
  riskBlobLayer: null,
  riskBySite: new Map(),
  weatherMode: false
};

const els = {
  shell: document.querySelector(".app-shell"),
  statusPanel: document.getElementById("statusPanel"),
  panelTitle: document.getElementById("panelTitle"),
  panelText: document.getElementById("panelText"),
  panelCloseButton: document.getElementById("panelCloseButton"),
  modePill: document.getElementById("modePill"),
  exitWeatherButton: document.getElementById("exitWeatherButton"),
  activateWeatherButton: document.getElementById("activateWeatherButton"),
  loadSitesButton: document.getElementById("loadSitesButton"),
  weatherFab: document.getElementById("weatherFab"),
  labDrawer: document.getElementById("labDrawer"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  refreshRadarButton: document.getElementById("refreshRadarButton"),
  radarFrameRange: document.getElementById("radarFrameRange"),
  radarTimeLabel: document.getElementById("radarTimeLabel"),
  radarOpacityRange: document.getElementById("radarOpacityRange"),
  radarOpacityLabel: document.getElementById("radarOpacityLabel"),
  fetchSiteWeatherButton: document.getElementById("fetchSiteWeatherButton"),
  rainStatus: document.getElementById("rainStatus"),
  siteStatus: document.getElementById("siteStatus"),
  riskStatus: document.getElementById("riskStatus"),
  riskList: document.getElementById("riskList"),
  metOfficeKey: document.getElementById("metOfficeKey"),
  metOfficeOrder: document.getElementById("metOfficeOrder"),
  testMetOfficeButton: document.getElementById("testMetOfficeButton"),
  metOfficeOutput: document.getElementById("metOfficeOutput"),
  siteSearch: document.getElementById("siteSearch")
};

const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true
}).setView([52.15, -3.85], 7);

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

state.riskBlobLayer = L.layerGroup().addTo(map);
state.siteLayer = L.layerGroup().addTo(map);
state.labelLayer = L.layerGroup().addTo(map);

init();

async function init() {
  state.regions = await loadRegions();
  bindEvents();
  updateVisibleSites(false);
  renderSitePoints(false);
  updateSummary();
  setPanel("Weather overlay off", "Test RainViewer radar blobs, Open-Meteo site risk, and Met Office DataHub image access before this goes near Atlas.");
  console.log(`Atlas Weather API Lab ${LAB_VERSION}`);
}

async function loadRegions() {
  try {
    const response = await fetch("data/regions.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Region file HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.regions) ? data.regions : fallbackRegions;
  } catch (error) {
    console.warn("Using fallback regions", error);
    return fallbackRegions;
  }
}

function bindEvents() {
  els.activateWeatherButton.addEventListener("click", activateWeatherMode);
  els.weatherFab.addEventListener("click", () => {
    els.labDrawer.classList.toggle("is-open");
    if (!state.weatherMode) activateWeatherMode();
  });
  els.exitWeatherButton.addEventListener("click", exitWeatherMode);
  els.panelCloseButton.addEventListener("click", () => els.statusPanel.hidden = true);
  els.loadSitesButton.addEventListener("click", () => {
    updateVisibleSites(true);
    renderSitePoints(true);
  });
  els.refreshRadarButton.addEventListener("click", loadRainViewerFrames);
  els.radarFrameRange.addEventListener("input", () => showRadarFrame(Number(els.radarFrameRange.value)));
  els.radarOpacityRange.addEventListener("input", () => {
    const opacity = Number(els.radarOpacityRange.value) / 100;
    els.radarOpacityLabel.textContent = `${els.radarOpacityRange.value}%`;
    if (state.radarLayer) state.radarLayer.setOpacity(opacity);
  });
  els.fetchSiteWeatherButton.addEventListener("click", fetchVisibleSiteWeather);
  els.tabs.forEach(tab => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));
  els.testMetOfficeButton.addEventListener("click", testMetOfficeOrder);
  els.siteSearch.addEventListener("change", findSite);
  map.on("moveend", () => {
    if (!state.weatherMode) return;
    updateVisibleSites(false);
    renderSitePoints(true);
  });
  map.on("zoomend", () => renderSitePoints(true));
}

async function activateWeatherMode() {
  state.weatherMode = true;
  els.shell.dataset.weatherMode = "on";
  els.weatherFab.classList.add("is-active");
  els.modePill.hidden = false;
  els.statusPanel.hidden = false;
  setPanel("Hazard weather active", "Rain radar loads as a UK-wide blob layer. Site risk only loads for visible region files.");
  updateVisibleSites(true);
  renderSitePoints(true);
  await loadRainViewerFrames();
}

function exitWeatherMode() {
  state.weatherMode = false;
  els.shell.dataset.weatherMode = "off";
  els.weatherFab.classList.remove("is-active");
  els.modePill.hidden = true;
  if (state.radarLayer) map.removeLayer(state.radarLayer);
  state.radarLayer = null;
  state.riskBlobLayer.clearLayers();
  state.riskBySite.clear();
  renderSitePoints(false);
  updateSummary();
  setPanel("Weather overlay off", "Weather layers cleared. Use this lab to compare providers before merging anything into Atlas.");
}

function setPanel(title, text) {
  els.panelTitle.textContent = title;
  els.panelText.textContent = text;
}

function selectTab(name) {
  els.tabs.forEach(tab => tab.classList.toggle("is-active", tab.dataset.tab === name));
  els.tabPanels.forEach(panel => panel.classList.toggle("is-active", panel.id === `tab-${name}`));
  els.labDrawer.classList.add("is-open");
}

async function loadRainViewerFrames() {
  els.rainStatus.textContent = "Loading";
  try {
    const response = await fetch(RAINVIEWER_API, { cache: "no-store" });
    if (!response.ok) throw new Error(`RainViewer HTTP ${response.status}`);
    const data = await response.json();
    const frames = data?.radar?.past || [];
    if (!frames.length) throw new Error("No RainViewer radar frames returned");
    state.radarFrames = frames.map(frame => ({ ...frame, host: data.host }));
    els.radarFrameRange.max = String(state.radarFrames.length - 1);
    els.radarFrameRange.value = String(state.radarFrames.length - 1);
    showRadarFrame(state.radarFrames.length - 1);
    els.rainStatus.textContent = `${state.radarFrames.length} frames`;
  } catch (error) {
    els.rainStatus.textContent = "Failed";
    setPanel("RainViewer failed", error.message);
  }
}

function showRadarFrame(index) {
  const frame = state.radarFrames[index];
  if (!frame) return;
  if (state.radarLayer) map.removeLayer(state.radarLayer);
  const opacity = Number(els.radarOpacityRange.value) / 100;
  const tileUrl = `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  state.radarLayer = L.tileLayer(tileUrl, {
    opacity,
    maxZoom: 19,
    maxNativeZoom: 7,
    pane: "tilePane",
    attribution: "RainViewer radar"
  }).addTo(map);
  els.radarTimeLabel.textContent = formatFrameTime(frame.time);
  els.rainStatus.textContent = formatFrameTime(frame.time);
}

function updateVisibleSites(showPanel) {
  const mapBounds = map.getBounds();
  const visibleRegions = state.regions.filter(region => boundsIntersect(mapBounds, region.bounds));
  const sites = visibleRegions.flatMap(region => region.sites.map(site => ({ ...site, region: region.name, regionId: region.id })));
  state.visibleSites = uniqueSites(sites);
  if (showPanel) {
    setPanel("Visible regions loaded", `${visibleRegions.length} region file(s), ${state.visibleSites.length} site point(s). Use Fetch risk for live site weather values.`);
  }
  updateSummary();
}

function boundsIntersect(mapBounds, regionBounds) {
  const southWest = L.latLng(regionBounds[0][0], regionBounds[0][1]);
  const northEast = L.latLng(regionBounds[1][0], regionBounds[1][1]);
  return mapBounds.intersects(L.latLngBounds(southWest, northEast));
}

function uniqueSites(sites) {
  const seen = new Set();
  return sites.filter(site => {
    if (seen.has(site.id)) return false;
    seen.add(site.id);
    return true;
  });
}

function renderSitePoints(includeWeather) {
  state.siteLayer.clearLayers();
  state.labelLayer.clearLayers();
  if (includeWeather) state.riskBlobLayer.clearLayers();

  const showLabels = map.getZoom() >= 9;
  state.visibleSites.forEach(site => {
    const risk = state.riskBySite.get(site.id) || emptyRisk(site);
    if (includeWeather && risk.level !== "none") addRiskBlob(site, risk);
    const marker = L.marker([site.lat, site.lon], {
      icon: L.divIcon({
        className: "",
        html: `<div class="site-risk-dot risk-${risk.level}"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(state.siteLayer);
    marker.bindPopup(renderPopup(site, risk));
    marker.on("click", () => setPanel(`${site.name}`, `${risk.summary} ${risk.detail}`.trim()));
    if (showLabels) {
      L.marker([site.lat, site.lon], {
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: `<span class="site-label">${escapeHtml(site.name)}</span>`,
          iconSize: [120, 20],
          iconAnchor: [-14, 30]
        })
      }).addTo(state.labelLayer);
    }
  });
  updateSummary();
}

function addRiskBlob(site, risk) {
  const color = riskColor(risk.level);
  const radius = risk.level === "severe" ? 34000 : risk.level === "high" ? 26000 : risk.level === "moderate" ? 19000 : 13000;
  L.circle([site.lat, site.lon], {
    radius,
    stroke: false,
    fillColor: color,
    fillOpacity: 0.18,
    interactive: false
  }).addTo(state.riskBlobLayer);
}

async function fetchVisibleSiteWeather() {
  if (!state.visibleSites.length) updateVisibleSites(true);
  if (!state.visibleSites.length) return;

  els.fetchSiteWeatherButton.disabled = true;
  els.fetchSiteWeatherButton.textContent = "Fetching…";
  els.riskList.innerHTML = "";

  try {
    const batches = chunk(state.visibleSites, MAX_SITES_PER_BATCH);
    const allRisks = [];
    for (const batch of batches) {
      const risks = await fetchOpenMeteoBatch(batch);
      allRisks.push(...risks);
    }
    state.riskBySite.clear();
    allRisks.forEach(risk => state.riskBySite.set(risk.site.id, risk));
    renderSitePoints(true);
    renderRiskList(allRisks);
    const topRisk = pickTopRisk(allRisks);
    setPanel("Site risk updated", topRisk ? `Highest visible risk: ${topRisk.label} at ${topRisk.site.name}.` : "No site risk returned.");
  } catch (error) {
    setPanel("Open-Meteo failed", error.message);
  } finally {
    els.fetchSiteWeatherButton.disabled = false;
    els.fetchSiteWeatherButton.textContent = "Fetch risk";
  }
}

async function fetchOpenMeteoBatch(sites) {
  const latitudes = sites.map(site => site.lat.toFixed(5)).join(",");
  const longitudes = sites.map(site => site.lon.toFixed(5)).join(",");
  const params = new URLSearchParams({
    latitude: latitudes,
    longitude: longitudes,
    current: "temperature_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m",
    hourly: "temperature_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m",
    forecast_days: "1",
    timezone: "Europe/London",
    wind_speed_unit: "mph"
  });
  const response = await fetch(`${OPEN_METEO_API}?${params.toString()}`);
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data) ? data : [data];
  return rows.map((row, index) => makeRisk(sites[index], row)).filter(Boolean);
}

function makeRisk(site, row) {
  if (!site || !row?.current) return null;
  const current = row.current;
  const gust = Number(current.wind_gusts_10m || 0);
  const wind = Number(current.wind_speed_10m || 0);
  const rain = Number(current.rain || current.precipitation || 0);
  const showers = Number(current.showers || 0);
  const snow = Number(current.snowfall || 0);
  const weatherCode = Number(current.weather_code || 0);
  const cloud = Number(current.cloud_cover || 0);
  const thunder = weatherCode >= 95;
  const score = Math.max(
    gust >= 55 ? 4 : gust >= 42 ? 3 : gust >= 30 ? 2 : gust >= 22 ? 1 : 0,
    wind >= 42 ? 3 : wind >= 30 ? 2 : wind >= 22 ? 1 : 0,
    rain >= 8 ? 4 : rain >= 4 ? 3 : rain >= 1.5 ? 2 : rain > 0 ? 1 : 0,
    showers >= 4 ? 3 : showers >= 1 ? 2 : 0,
    snow > 0 ? 3 : 0,
    thunder ? 4 : 0
  );
  const level = score >= 4 ? "severe" : score === 3 ? "high" : score === 2 ? "moderate" : score === 1 ? "low" : "none";
  const label = score >= 4 ? "Severe" : score === 3 ? "High" : score === 2 ? "Moderate" : score === 1 ? "Low" : "Clear";
  const summary = `${label} weather risk`;
  const detail = `gust ${round(gust)} mph, wind ${round(wind)} mph, rain ${round(rain)} mm/h, cloud ${round(cloud)}%.`;
  return { site, level, label, score, summary, detail, values: { gust, wind, rain, showers, snow, cloud, weatherCode, thunder } };
}

function renderRiskList(risks) {
  const sorted = [...risks].sort((a, b) => b.score - a.score).slice(0, 12);
  if (!sorted.length) {
    els.riskList.innerHTML = `<p class="small-copy">No risk data returned.</p>`;
    return;
  }
  els.riskList.innerHTML = sorted.map(risk => `
    <article class="risk-card risk-${risk.level}">
      <div>
        <strong>${escapeHtml(risk.site.name)} · ${risk.label}</strong>
        <span>${escapeHtml(risk.site.region)} · ${escapeHtml(risk.detail)}</span>
      </div>
      <button class="small-action" data-flyto="${escapeHtml(risk.site.id)}">View</button>
    </article>
  `).join("");
  els.riskList.querySelectorAll("[data-flyto]").forEach(button => {
    button.addEventListener("click", () => flyToSite(button.dataset.flyto));
  });
}

function pickTopRisk(risks) {
  return [...risks].sort((a, b) => b.score - a.score)[0];
}

async function testMetOfficeOrder() {
  const apiKey = els.metOfficeKey.value.trim();
  const orderName = els.metOfficeOrder.value.trim().toLowerCase();
  if (!apiKey || !orderName) {
    els.metOfficeOutput.textContent = "Paste an API key and order name first. Do not commit these into the repo.";
    return;
  }
  els.metOfficeOutput.textContent = "Testing Met Office order…";
  try {
    const detailUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderName)}/latest?detail=MINIMAL`;
    const response = await fetch(detailUrl, {
      headers: {
        Accept: "application/json",
        apikey: apiKey
      }
    });
    if (!response.ok) throw new Error(`Met Office HTTP ${response.status}. If this is a browser/CORS error, this provider needs a small proxy.`);
    const json = await response.json();
    const files = json?.orderDetails?.files || [];
    if (!files.length) {
      els.metOfficeOutput.textContent = "Order loaded, but no files were returned. Check the order name and required runs.";
      return;
    }
    const firstFileId = files[0].fileId;
    els.metOfficeOutput.innerHTML = `Order OK. ${files.length} file(s) found.<br><strong>First file:</strong> ${escapeHtml(firstFileId)}<br>Loading preview image…`;
    await loadMetOfficePreview(apiKey, orderName, firstFileId);
  } catch (error) {
    els.metOfficeOutput.textContent = error.message;
  }
}

async function loadMetOfficePreview(apiKey, orderName, fileId) {
  const pngUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderName)}/latest/${encodeURIComponent(fileId)}/data?includeLand=true`;
  const response = await fetch(pngUrl, {
    headers: {
      Accept: "image/png",
      apikey: apiKey
    }
  });
  if (!response.ok) throw new Error(`Met Office image HTTP ${response.status}`);
  const blob = await response.blob();
  const localUrl = URL.createObjectURL(blob);
  const img = document.createElement("img");
  img.src = localUrl;
  img.alt = "Met Office Map Images API preview";
  els.metOfficeOutput.appendChild(img);
}

function findSite() {
  const query = els.siteSearch.value.trim().toLowerCase();
  if (!query) return;
  const allSites = state.regions.flatMap(region => region.sites.map(site => ({ ...site, region: region.name, regionId: region.id })));
  const found = allSites.find(site => site.name.toLowerCase().includes(query) || site.id.toLowerCase() === query);
  if (!found) {
    setPanel("No site found", `No sample site matched “${query}”.`);
    return;
  }
  map.setView([found.lat, found.lon], 10);
  setPanel(found.name, `${found.region}. This search loaded the map location; weather risk still needs Fetch risk.`);
}

function flyToSite(siteId) {
  const site = state.visibleSites.find(candidate => candidate.id === siteId);
  if (!site) return;
  map.setView([site.lat, site.lon], Math.max(map.getZoom(), 10));
}

function updateSummary() {
  els.siteStatus.textContent = String(state.visibleSites.length);
  const risks = Array.from(state.riskBySite.values());
  const topRisk = pickTopRisk(risks);
  els.riskStatus.textContent = topRisk ? topRisk.label : "—";
}

function renderPopup(site, risk) {
  return `
    <strong>${escapeHtml(site.name)}</strong><br>
    ${escapeHtml(site.region)}<br>
    ${escapeHtml(risk.summary)}<br>
    <small>${escapeHtml(risk.detail)}</small>
  `;
}

function emptyRisk(site) {
  return {
    site,
    level: "none",
    label: "Not loaded",
    score: 0,
    summary: "Site weather not loaded",
    detail: "Tap Fetch risk to request live values for visible regions."
  };
}

function riskColor(level) {
  return {
    severe: "#ff3131",
    high: "#ff8a1f",
    moderate: "#f2ff00",
    low: "#22d9ff",
    none: "#2c8cff"
  }[level] || "#22d9ff";
}

function formatFrameTime(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
