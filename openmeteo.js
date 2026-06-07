/* Open-Meteo visible-site risk page v0.2.3
   Max-detail site popup tester. Keep this deliberately rich so features can be cut later.
*/

(() => {
  const Lab = window.AtlasWeatherLab;
  const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";
  const MAX_SITES_PER_BATCH = 20;
  const HOURS_TO_SHOW = 12;

  const CURRENT_FIELDS = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "is_day",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
    "weather_code",
    "cloud_cover",
    "pressure_msl",
    "surface_pressure",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m"
  ];

  const HOURLY_FIELDS = [
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
    "snow_depth",
    "weather_code",
    "pressure_msl",
    "surface_pressure",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "visibility",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "is_day"
  ];

  const state = {
    regions: [],
    visibleRegions: [],
    visibleSites: [],
    siteLayer: null,
    labelLayer: null,
    blobLayer: null,
    riskBySite: new Map(),
    markerBySite: new Map()
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
    setStatus("Ready. Move the map or load visible sites, then fetch rich risk data for those sample points only.");
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
    state.markerBySite.clear();

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

      marker.bindPopup(renderPopup(site, risk), {
        maxWidth: 360,
        minWidth: 292,
        autoPan: true,
        autoPanPadding: [18, 128]
      });
      marker.on("click", () => setStatus(`${site.name}: ${risk.summary}. ${risk.detail}`));
      state.markerBySite.set(site.id, marker);

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
    setStatus(`Fetching max-detail weather for ${state.visibleSites.length} visible sample site(s)â¦`);

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

      const topRisk = [...risks].sort((a, b) => b.score - a.score)[0];
      setStatus(topRisk ? `Highest visible risk: ${topRisk.label} at ${topRisk.site.name}. Tap any site for the full feature popup.` : "No risk values returned.");
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
      current: CURRENT_FIELDS.join(","),
      hourly: HOURLY_FIELDS.join(","),
      forecast_days: "2",
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
    const hourlyRows = makeHourlyRows(row).slice(0, 24);
    const next12 = hourlyRows.slice(0, HOURS_TO_SHOW);
    const maxNextGust = maxFrom(next12, "gust");
    const maxNextWind = maxFrom(next12, "wind");
    const maxNextRain = maxFrom(next12, "rain");
    const maxNextPrecip = maxFrom(next12, "precipitation");
    const maxNextPrecipProb = maxFrom(next12, "precipitationProbability");
    const minNextVisibility = minPositiveFrom(next12, "visibilityKm");
    const thunderNext = next12.some(hour => isThunderCode(hour.weatherCode));

    const values = {
      temperature: number(current.temperature_2m),
      humidity: number(current.relative_humidity_2m),
      apparentTemperature: number(current.apparent_temperature),
      isDay: number(current.is_day),
      precipitation: number(current.precipitation),
      rain: number(current.rain),
      showers: number(current.showers),
      snow: number(current.snowfall),
      cloud: number(current.cloud_cover),
      pressureMsl: number(current.pressure_msl),
      surfacePressure: number(current.surface_pressure),
      wind: number(current.wind_speed_10m),
      windDirection: number(current.wind_direction_10m),
      gust: number(current.wind_gusts_10m),
      weatherCode: number(current.weather_code),
      thunder: isThunderCode(number(current.weather_code)) || thunderNext,
      maxNextGust,
      maxNextWind,
      maxNextRain,
      maxNextPrecip,
      maxNextPrecipProb,
      minNextVisibility
    };

    const score = Math.max(
      values.gust >= 55 || maxNextGust >= 55 ? 4 : values.gust >= 42 || maxNextGust >= 42 ? 3 : values.gust >= 30 || maxNextGust >= 30 ? 2 : values.gust >= 22 || maxNextGust >= 22 ? 1 : 0,
      values.wind >= 42 || maxNextWind >= 42 ? 3 : values.wind >= 30 || maxNextWind >= 30 ? 2 : values.wind >= 22 || maxNextWind >= 22 ? 1 : 0,
      values.rain >= 8 || maxNextRain >= 8 || maxNextPrecip >= 8 ? 4 : values.rain >= 4 || maxNextRain >= 4 || maxNextPrecip >= 4 ? 3 : values.rain >= 1.5 || maxNextRain >= 1.5 || maxNextPrecip >= 1.5 ? 2 : values.rain > 0 || maxNextRain > 0 || maxNextPrecip > 0 ? 1 : 0,
      values.showers >= 4 ? 3 : values.showers >= 1 ? 2 : 0,
      values.snow > 0 ? 3 : 0,
      values.thunder ? 4 : 0,
      minNextVisibility > 0 && minNextVisibility <= 1 ? 3 : minNextVisibility > 0 && minNextVisibility <= 3 ? 2 : 0
    );

    const level = score >= 4 ? "severe" : score === 3 ? "high" : score === 2 ? "moderate" : score === 1 ? "low" : "none";
    const label = score >= 4 ? "Severe" : score === 3 ? "High" : score === 2 ? "Moderate" : score === 1 ? "Low" : "Clear";
    const detail = `gust ${fmt(values.gust)} mph now / ${fmt(maxNextGust)} mph max, rain ${fmt(values.rain)} mm/h now, ${fmt(maxNextPrecipProb, 0)}% precip chance.`;

    return {
      site,
      row,
      level,
      label,
      score,
      summary: `${label} weather risk`,
      detail,
      values,
      hourlyRows,
      next12,
      fetchedAt: new Date()
    };
  }

  function makeEmptyRisk(site) {
    return {
      site,
      level: "none",
      label: "Not loaded",
      score: 0,
      summary: "Site weather not loaded",
      detail: "Tap Fetch risk to request live values.",
      values: {},
      hourlyRows: [],
      next12: []
    };
  }

  function makeHourlyRows(row) {
    const hourly = row.hourly || {};
    const times = hourly.time || [];
    const currentTime = row.current?.time ? Date.parse(row.current.time) : null;

    return times.map((time, index) => ({
      time,
      timestamp: Date.parse(time),
      temperature: number(hourly.temperature_2m?.[index]),
      humidity: number(hourly.relative_humidity_2m?.[index]),
      dewPoint: number(hourly.dew_point_2m?.[index]),
      apparentTemperature: number(hourly.apparent_temperature?.[index]),
      precipitationProbability: number(hourly.precipitation_probability?.[index]),
      precipitation: number(hourly.precipitation?.[index]),
      rain: number(hourly.rain?.[index]),
      showers: number(hourly.showers?.[index]),
      snowfall: number(hourly.snowfall?.[index]),
      snowDepth: number(hourly.snow_depth?.[index]),
      weatherCode: number(hourly.weather_code?.[index]),
      pressureMsl: number(hourly.pressure_msl?.[index]),
      surfacePressure: number(hourly.surface_pressure?.[index]),
      cloud: number(hourly.cloud_cover?.[index]),
      cloudLow: number(hourly.cloud_cover_low?.[index]),
      cloudMid: number(hourly.cloud_cover_mid?.[index]),
      cloudHigh: number(hourly.cloud_cover_high?.[index]),
      visibilityKm: number(hourly.visibility?.[index]) / 1000,
      wind: number(hourly.wind_speed_10m?.[index]),
      windDirection: number(hourly.wind_direction_10m?.[index]),
      gust: number(hourly.wind_gusts_10m?.[index]),
      isDay: number(hourly.is_day?.[index])
    })).filter(hour => !currentTime || hour.timestamp >= currentTime);
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
        <button type="button" data-flyto="${Lab.escapeHtml(risk.site.id)}">View details</button>
      </article>
    `).join("");

    els.riskList.querySelectorAll("[data-flyto]").forEach(button => {
      button.addEventListener("click", () => flyToSite(button.dataset.flyto, true));
    });
  }

  function renderPopup(site, risk) {
    const values = risk.values || {};
    const detailRows = [
      metric("Risk", risk.label || "Not loaded", `Score ${risk.score ?? 0}`),
      metric("Gust now", mph(values.gust), `Max ${mph(values.maxNextGust)}`),
      metric("Wind", mph(values.wind), `${compass(values.windDirection)} ${fmt(values.windDirection, 0)}Â°`),
      metric("Rain", `${fmt(values.rain)} mm/h`, `Max ${fmt(values.maxNextRain)} mm/h`),
      metric("Precip", `${fmt(values.precipitation)} mm`, `${fmt(values.maxNextPrecipProb, 0)}% chance`),
      metric("Showers", `${fmt(values.showers)} mm`, "current"),
      metric("Snow", `${fmt(values.snow)} cm`, "current"),
      metric("Visibility", km(values.minNextVisibility), "min next 12h"),
      metric("Cloud", percent(values.cloud), "total"),
      metric("Temp", celsius(values.temperature), `Feels ${celsius(values.apparentTemperature)}`),
      metric("Humidity", percent(values.humidity), "current"),
      metric("Pressure", hpa(values.pressureMsl), `Surface ${hpa(values.surfacePressure)}`)
    ].join("");

    const hourly = (risk.next12 || []).slice(0, 6).map(hour => `
      <article class="popup-hour-card">
        <strong>${hourLabel(hour.time)}</strong>
        <span>${weatherIcon(hour.weatherCode)}</span>
        <b>${mph(hour.gust)}</b>
        <small>${fmt(hour.precipitationProbability, 0)}% Â· ${fmt(hour.rain || hour.precipitation)} mm</small>
      </article>
    `).join("") || `<article class="popup-hour-card"><strong>â</strong><small>Fetch risk first</small></article>`;

    const checks = makeChecks(risk).map(item => `<li>${Lab.escapeHtml(item)}</li>`).join("");

    return `
      <section class="site-weather-popup risk-${Lab.escapeHtml(risk.level || "none")}">
        <header class="site-popup-header">
          <div>
            <p class="eyebrow">${Lab.escapeHtml(site.id)} Â· ${Lab.escapeHtml(site.region)}</p>
            <h3>${Lab.escapeHtml(site.name)}</h3>
          </div>
          <span class="risk-badge">${Lab.escapeHtml(risk.label || "Not loaded")}</span>
        </header>

        <div class="site-popup-meta">
          <span>${fmt(site.lat, 4)}, ${fmt(site.lon, 4)}</span>
          <span>${risk.fetchedAt ? `Fetched ${risk.fetchedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Not fetched"}</span>
        </div>

        <div class="popup-hazard-strip">
          <strong>${Lab.escapeHtml(risk.summary)}</strong>
          <span>${Lab.escapeHtml(risk.detail)}</span>
        </div>

        <div class="popup-metric-grid">${detailRows}</div>

        <section class="popup-section">
          <h4>Next 12h quick scan</h4>
          <div class="popup-hour-strip">${hourly}</div>
        </section>

        <section class="popup-section">
          <h4>Signal / access checks</h4>
          <ul class="popup-check-list">${checks}</ul>
        </section>

        <p class="popup-footnote">Thunder is inferred from weather code only in this test. This is a feature dump so we can remove what is not useful.</p>
      </section>
    `;
  }

  function metric(label, value, hint) {
    return `
      <article class="popup-metric">
        <span>${Lab.escapeHtml(label)}</span>
        <strong>${Lab.escapeHtml(value)}</strong>
        <small>${Lab.escapeHtml(hint || "")}</small>
      </article>
    `;
  }

  function makeChecks(risk) {
    const values = risk.values || {};
    const checks = [];

    if ((values.maxNextGust || values.gust || 0) >= 42) checks.push("High gusts: exposed ladders, dishes and hilltop access need caution.");
    if ((values.maxNextRain || values.rain || 0) >= 4) checks.push("Heavy rain: check feeder/water ingress risk and track conditions.");
    if (values.thunder) checks.push("Lightning flag: avoid exposed structures and mast work.");
    if ((values.minNextVisibility || 99) <= 3) checks.push("Poor visibility: access roads and hill sites may be harder to work safely.");
    if ((values.cloud || 0) >= 90) checks.push("Full cloud cover: useful for general situational awareness, not a fault by itself.");
    if (!checks.length) checks.push("No obvious severe trigger from the fetched values.");

    return checks;
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

  function flyToSite(siteId, openPopup = false) {
    const site = state.visibleSites.find(candidate => candidate.id === siteId);
    if (!site) return;
    map.setView([site.lat, site.lon], Math.max(map.getZoom(), 10));
    if (openPopup) {
      window.setTimeout(() => {
        const marker = state.markerBySite.get(site.id);
        if (marker) marker.openPopup();
      }, 260);
    }
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function maxFrom(rows, key) {
    return rows.reduce((max, row) => Math.max(max, number(row[key])), 0);
  }

  function minPositiveFrom(rows, key) {
    const values = rows.map(row => number(row[key])).filter(value => value > 0);
    return values.length ? Math.min(...values) : 0;
  }

  function fmt(value, places = 1) {
    if (!Number.isFinite(Number(value))) return "â";
    return String(Lab.round(value, places));
  }

  function mph(value) {
    return `${fmt(value)} mph`;
  }

  function celsius(value) {
    return `${fmt(value)}Â°C`;
  }

  function percent(value) {
    return `${fmt(value, 0)}%`;
  }

  function hpa(value) {
    return value ? `${fmt(value, 0)} hPa` : "â";
  }

  function km(value) {
    return value ? `${fmt(value, 1)} km` : "â";
  }

  function hourLabel(time) {
    if (!time) return "â";
    return new Date(time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function compass(degrees) {
    if (!Number.isFinite(Number(degrees))) return "â";
    const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return points[Math.round(((Number(degrees) % 360) / 45)) % 8];
  }

  function isThunderCode(code) {
    return [95, 96, 99].includes(Number(code));
  }

  function weatherIcon(code) {
    const value = Number(code);
    if ([95, 96, 99].includes(value)) return "â¡";
    if ([71, 73, 75, 77, 85, 86].includes(value)) return "â";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return "ð§";
    if ([45, 48].includes(value)) return "ð«";
    if ([1, 2, 3].includes(value)) return "â";
    return "â";
  }
})();
