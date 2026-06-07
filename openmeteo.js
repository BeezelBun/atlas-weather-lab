/* Open-Meteo visible-site risk page v0.2.0 */

(() => {
  const Lab = window.AtlasWeatherLab;
  const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";
  const MAX_SITES_PER_BATCH = 40;

  const state = {
    regions: [],
    visibleRegions: [],
    visibleSites: [],
    siteLayer: null,
    labelLayer: null,
    blobLayer: null,
    riskBySite: new Map()
  };

  const els = {
    statusText: document.getElementById("statusText"),
    regionCount: document.getElementById("regionCount"),
    siteCount: document.getElementById("siteCount"),
    loadSitesButton: document.getElementById("loadSitesButton"),
    fetchRiskButton: document.getElementById("fetchRiskButton"),
    riskList: document.getElementById("riskList"),
    siteSearch: document.getElementById("siteSearch")
  };

  const map = Lab.createBaseMap("map", { center: [52.15, -3.85], zoom: 7 });
  state.blobLayer = L.layerGroup().addTo(map);
  state.siteLayer = L.layerGroup().addTo(map);
  state.labelLayer = L.layerGroup().addTo(map);

  init();

  async function init() {
    state.regions = await Lab.loadRegions();
    bindEvents();
    loadVisibleSites(false);
    renderSites(false);
    setStatus("Ready. Move the map or load visible sites, then fetch risk for those sample points only.");
  }

  function bindEvents() {
    els.loadSitesButton.addEventListener("click", () => {
      loadVisibleSites(true);
      renderSites(true);
    });

    els.fetchRiskButton.addEventListener("click", fetchRisk);

    els.siteSearch.addEventListener("change", findSite);

    map.on("moveend", () => {
      loadVisibleSites(false);
      renderSites(true);
    });

    map.on("zoomend", () => renderSites(true));
  }

  function loadVisibleSites(showStatus) {
    state.visibleRegions = Lab.visibleRegionsForMap(map, state.regions);
    state.visibleSites = Lab.sitesFromRegions(state.visibleRegions);

    els.regionCount.textContent = String(state.visibleRegions.length);
    els.siteCount.textContent = String(state.visibleSites.length);

    if (showStatus) {
      setStatus(`${state.visibleRegions.length} region file(s) and ${state.visibleSites.length} sample site(s) loaded for this viewport.`);
    }
  }

  function renderSites(includeRisk) {
    state.siteLayer.clearLayers();
    state.labelLayer.clearLayers();
    state.blobLayer.clearLayers();

    const showLabels = map.getZoom() >= 9;

    state.visibleSites.forEach(site => {
      const risk = state.riskBySite.get(site.id) || makeEmptyRisk(site);

      if (includeRisk && risk.level !== "none") {
        L.circle([site.lat, site.lon], {
          radius: Lab.riskRadius(risk.level),
          stroke: false,
          fillColor: Lab.riskColor(risk.level),
          fillOpacity: 0.18,
          interactive: false
        }).addTo(state.blobLayer);
      }

      const marker = L.marker([site.lat, site.lon], {
        icon: Lab.createDivIcon(`<div class="site-dot ${risk.level}"></div>`)
      }).addTo(state.siteLayer);

      marker.bindPopup(renderPopup(site, risk));
      marker.on("click", () => setStatus(`${site.name}: ${risk.summary}. ${risk.detail}`));

      if (showLabels) {
        L.marker([site.lat, site.lon], {
          interactive: false,
          icon: Lab.createDivIcon(`<div class="site-label">${Lab.escapeHtml(site.name)}</div>`, [120, 20], [-14, 30])
        }).addTo(state.labelLayer);
      }
    });
  }

  async function fetchRisk() {
    if (!state.visibleSites.length) loadVisibleSites(true);
    if (!state.visibleSites.length) {
      setStatus("No visible sites. Pan or zoom to a sample region first.");
      return;
    }

    els.fetchRiskButton.disabled = true;
    els.fetchRiskButton.textContent = "Fetchingâ¦";
    els.riskList.innerHTML = "";
    setStatus(`Fetching weather for ${state.visibleSites.length} visible sample site(s)â¦`);

    try {
      const batches = Lab.chunk(state.visibleSites, MAX_SITES_PER_BATCH);
      const risks = [];

      for (const batch of batches) {
        risks.push(...await fetchOpenMeteoBatch(batch));
      }

      state.riskBySite.clear();
      risks.forEach(risk => state.riskBySite.set(risk.site.id, risk));

      renderSites(true);
      renderRiskList(risks);

      const topRisk = risks.sort((a, b) => b.score - a.score)[0];
      setStatus(topRisk ? `Highest visible risk: ${topRisk.label} at ${topRisk.site.name}.` : "No risk values returned.");
    } catch (error) {
      setStatus(`Open-Meteo failed: ${error.message}`);
    } finally {
      els.fetchRiskButton.disabled = false;
      els.fetchRiskButton.textContent = "Fetch risk";
    }
  }

  async function fetchOpenMeteoBatch(sites) {
    const params = new URLSearchParams({
      latitude: sites.map(site => site.lat.toFixed(5)).join(","),
      longitude: sites.map(site => site.lon.toFixed(5)).join(","),
      current: "temperature_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m",
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
    const cloud = Number(current.cloud_cover || 0);
    const weatherCode = Number(current.weather_code || 0);
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
    const detail = `gust ${Lab.round(gust)} mph, wind ${Lab.round(wind)} mph, rain ${Lab.round(rain)} mm/h, cloud ${Lab.round(cloud)}%.`;

    return {
      site,
      level,
      label,
      score,
      summary: `${label} weather risk`,
      detail,
      values: { gust, wind, rain, showers, snow, cloud, weatherCode, thunder }
    };
  }

  function makeEmptyRisk(site) {
    return {
      site,
      level: "none",
      label: "Not loaded",
      score: 0,
      summary: "Site weather not loaded",
      detail: "Tap Fetch risk to request live values."
    };
  }

  function renderRiskList(risks) {
    const sorted = [...risks].sort((a, b) => b.score - a.score).slice(0, 12);

    if (!sorted.length) {
      els.riskList.innerHTML = `<div class="result-card"><span>No risk data returned.</span></div>`;
      return;
    }

    els.riskList.innerHTML = sorted.map(risk => `
      <article class="result-card">
        <strong>${Lab.escapeHtml(risk.site.name)} Â· ${risk.label}</strong>
        <span>${Lab.escapeHtml(risk.site.region)} Â· ${Lab.escapeHtml(risk.detail)}</span>
        <button type="button" data-flyto="${Lab.escapeHtml(risk.site.id)}">View</button>
      </article>
    `).join("");

    els.riskList.querySelectorAll("[data-flyto]").forEach(button => {
      button.addEventListener("click", () => flyToSite(button.dataset.flyto));
    });
  }

  function renderPopup(site, risk) {
    return `
      <strong>${Lab.escapeHtml(site.name)}</strong><br />
      ${Lab.escapeHtml(site.region)}<br />
      ${Lab.escapeHtml(risk.summary)}<br />
      ${Lab.escapeHtml(risk.detail)}
    `;
  }

  function findSite() {
    const query = els.siteSearch.value.trim().toLowerCase();
    if (!query) return;

    const found = Lab.allSites(state.regions).find(site =>
      site.name.toLowerCase().includes(query) || site.id.toLowerCase() === query
    );

    if (!found) {
      setStatus(`No sample site matched â${query}â.`);
      return;
    }

    map.setView([found.lat, found.lon], 10);
    setStatus(`${found.name} selected. Fetch risk again if you want fresh visible-site values.`);
  }

  function flyToSite(siteId) {
    const site = state.visibleSites.find(candidate => candidate.id === siteId);
    if (!site) return;
    map.setView([site.lat, site.lon], Math.max(map.getZoom(), 10));
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }
})();
