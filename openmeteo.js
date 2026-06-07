/* Open-Meteo visible-site risk page v0.2.6
   Maximum-feature site detail tester. Intentionally over-informative so the final Atlas card can be cut down later.
*/

(() => {
  const Lab = window.AtlasWeatherLab;
  const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";
  const MAX_SITES_PER_BATCH = 20;
  const HOURS_TO_SHOW = 12;
  const AUTO_FETCH_DEBOUNCE_MS = 750;

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
    markerBySite: new Map(),
    selectedSiteId: null,
    autoFetchTimer: null,
    lastFetchKey: "",
    fetchSequence: 0
  };

  const els = {
    statusText: document.getElementById("statusText"),
    regionCount: document.getElementById("regionCount"),
    siteCount: document.getElementById("siteCount"),
    loadSitesButton: document.getElementById("loadSitesButton"),
    fetchRiskButton: document.getElementById("fetchRiskButton"),
    riskList: document.getElementById("riskList"),
    siteSearch: document.getElementById("siteSearch"),
    detailPanel: document.getElementById("siteDetailPanel"),
    detailContent: document.getElementById("siteDetailContent"),
    detailCloseButton: document.getElementById("siteDetailCloseButton")
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
    renderSites(true);
    setStatus("Loading visible sites and fetching risk automatically...");
    await fetchRisk({ auto: true, force: true });
  }

  function bindEvents() {
    els.loadSitesButton.addEventListener("click", () => refreshVisibleSites({ force: true, reason: "Manual visible-site refresh" }));
    els.fetchRiskButton.addEventListener("click", () => fetchRisk({ auto: false, force: true }));
    els.siteSearch.addEventListener("change", findSite);
    els.detailCloseButton?.addEventListener("click", closeDetailPanel);

    map.on("moveend", () => refreshVisibleSites({ force: false, reason: "Viewport changed" }));
    map.on("zoomend", () => refreshVisibleSites({ force: false, reason: "Zoom changed" }));
  }

  function refreshVisibleSites({ force = false, reason = "Viewport changed" } = {}) {
    loadVisibleSites(false);
    renderSites(true);
    scheduleAutoFetch(force, reason);
  }

  function scheduleAutoFetch(force = false, reason = "Viewport changed") {
    window.clearTimeout(state.autoFetchTimer);
    state.autoFetchTimer = window.setTimeout(() => {
      fetchRisk({ auto: true, force, reason });
    }, AUTO_FETCH_DEBOUNCE_MS);
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

  function visibleSiteKey() {
    return state.visibleSites.map(site => site.id).sort().join("|");
  }

  function renderSites(includeRisk) {
    state.siteLayer.clearLayers();
    state.labelLayer.clearLayers();
    state.blobLayer.clearLayers();
    state.markerBySite.clear();

    const showLabels = map.getZoom() >= 9;

    state.visibleSites.forEach(site => {
      const risk = state.riskBySite.get(site.id) || makeEmptyRisk(site);
      const visual = risk.visual || makeVisualState(risk);

      if (includeRisk && visual.state !== "normal" && visual.state !== "unloaded") {
        L.circle([site.lat, site.lon], {
          radius: visualRadius(visual.state, risk.score),
          stroke: false,
          fillColor: visual.color,
          fillOpacity: visual.state === "rain" ? 0.16 : 0.2,
          interactive: false
        }).addTo(state.blobLayer);
      }

      const marker = L.marker([site.lat, site.lon], {
        icon: Lab.createDivIcon(`<div class="site-dot wx-${visual.state} risk-score-${risk.score || 0}">${visual.icon}</div>`, [32, 32], [16, 16])
      }).addTo(state.siteLayer);

      marker.on("click", () => openSiteDetail(site, risk));
      state.markerBySite.set(site.id, marker);

      if (showLabels) {
        L.marker([site.lat, site.lon], {
          interactive: false,
          icon: Lab.createDivIcon(`<div class="site-label">${Lab.escapeHtml(site.name)}</div>`, [120, 20], [-14, 30])
        }).addTo(state.labelLayer);
      }
    });
  }

  async function fetchRisk({ auto = false, force = false, reason = "" } = {}) {
    if (!state.visibleSites.length) loadVisibleSites(true);
    if (!state.visibleSites.length) {
      setStatus("No visible sites. Pan or zoom to a sample region first.");
      return;
    }

    const fetchKey = visibleSiteKey();
    const hasAllRisks = state.visibleSites.every(site => state.riskBySite.has(site.id));

    if (auto && !force && fetchKey === state.lastFetchKey && hasAllRisks) {
      setStatus(`${state.visibleSites.length} visible site risk value(s) already loaded. Move the map to auto-refresh another region.`);
      return;
    }

    const requestId = ++state.fetchSequence;
    els.fetchRiskButton.disabled = true;
    els.fetchRiskButton.textContent = auto ? "Auto-refreshing..." : "Refreshing...";
    els.riskList.innerHTML = "";
    setStatus(`${auto ? "Auto-fetching" : "Fetching"} maximum-feature weather for ${state.visibleSites.length} visible sample site(s)${reason ? ` (${reason})` : ""}...`);

    try {
      const batches = Lab.chunk(state.visibleSites, MAX_SITES_PER_BATCH);
      const risks = [];

      for (const batch of batches) {
        risks.push(...await fetchOpenMeteoBatch(batch));
      }

      if (requestId !== state.fetchSequence) return;

      state.riskBySite.clear();
      risks.forEach(risk => state.riskBySite.set(risk.site.id, risk));
      state.lastFetchKey = fetchKey;

      renderSites(true);
      renderRiskList(risks);

      const topRisk = [...risks].sort((a, b) => b.score - a.score || b.nextRisk.score - a.nextRisk.score)[0];
      setStatus(topRisk ? `Auto-loaded ${risks.length} visible site risk value(s). Highest: ${topRisk.label} at ${topRisk.site.name}. Tap any site for the full feature sheet.` : "No risk values returned.");

      if (state.selectedSiteId) {
        const selected = risks.find(risk => risk.site.id === state.selectedSiteId);
        if (selected) openSiteDetail(selected.site, selected, false);
      }
    } catch (error) {
      setStatus(`Open-Meteo failed: ${error.message}`);
    } finally {
      if (requestId === state.fetchSequence) {
        els.fetchRiskButton.disabled = false;
        els.fetchRiskButton.textContent = "Refresh risk";
      }
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
    const currentHour = hourlyRows[0] || {};
    const next12 = hourlyRows.slice(0, HOURS_TO_SHOW);
    const next24 = hourlyRows.slice(0, 24);

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
      currentTime: current.time || "",
      dewPoint: number(currentHour.dewPoint),
      currentVisibility: number(currentHour.visibilityKm),
      currentCloudLow: number(currentHour.cloudLow),
      currentCloudMid: number(currentHour.cloudMid),
      currentCloudHigh: number(currentHour.cloudHigh),
      currentPrecipProbability: number(currentHour.precipitationProbability),
      maxNextGust: maxFrom(next12, "gust"),
      maxNextWind: maxFrom(next12, "wind"),
      maxNextRain: maxFrom(next12, "rain"),
      maxNextPrecip: maxFrom(next12, "precipitation"),
      maxNextShowers: maxFrom(next12, "showers"),
      maxNextSnow: maxFrom(next12, "snowfall"),
      maxNextSnowDepth: maxFrom(next12, "snowDepth"),
      maxNextPrecipProb: maxFrom(next12, "precipitationProbability"),
      maxNextCloud: maxFrom(next12, "cloud"),
      maxNextCloudLow: maxFrom(next12, "cloudLow"),
      maxNextCloudMid: maxFrom(next12, "cloudMid"),
      maxNextCloudHigh: maxFrom(next12, "cloudHigh"),
      minNextVisibility: minPositiveFrom(next12, "visibilityKm"),
      minNextTemperature: minFrom(next12, "temperature"),
      maxNextTemperature: maxFrom(next12, "temperature"),
      minNextFeels: minFrom(next12, "apparentTemperature"),
      maxNextFeels: maxFrom(next12, "apparentTemperature"),
      pressureTrend: pressureTrend(next12),
      wetHours12: countWhere(next12, hour => number(hour.rain) > 0 || number(hour.precipitation) > 0),
      highGustHours12: countWhere(next12, hour => number(hour.gust) >= 30),
      lowVisibilityHours12: countWhere(next12, hour => number(hour.visibilityKm) > 0 && number(hour.visibilityKm) <= 3),
      thunderHours12: countWhere(next12, hour => isThunderCode(hour.weatherCode)),
      thunderCurrent: isThunderCode(number(current.weather_code)),
      thunderNext: next12.some(hour => isThunderCode(hour.weatherCode)),
      sourceModelTime: row.current?.time || "",
      elevation: number(row.elevation),
      generationTimeMs: number(row.generationtime_ms),
      timezone: row.timezone || "Europe/London",
      utcOffsetSeconds: number(row.utc_offset_seconds)
    };

    values.thunder = values.thunderCurrent || values.thunderNext;

    const currentRisk = scoreCurrent(values);
    const nextRisk = scoreNext(values);
    const score = Math.max(currentRisk.score, nextRisk.score);
    const level = riskLevel(score);
    const label = riskLabel(score);
    const topCheck = [currentRisk.topCheck, nextRisk.topCheck]
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)[0];
    const topReason = topCheck?.reason || "No obvious severe trigger from the fetched values.";

    const risk = {
      site,
      row,
      level,
      label,
      score,
      currentRisk,
      nextRisk,
      summary: `Current ${currentRisk.label} - Next 12h ${nextRisk.label}`,
      detail: topReason,
      values,
      visual: null,
      hourlyRows,
      next12,
      next24,
      fetchedAt: new Date()
    };

    risk.visual = makeVisualState(risk);
    return risk;
  }

  function makeEmptyRisk(site) {
    return {
      site,
      level: "unloaded",
      label: "Not loaded",
      score: 0,
      currentRisk: { score: 0, label: "Not loaded", reasons: [] },
      nextRisk: { score: 0, label: "Not loaded", reasons: [] },
      summary: "Site weather not loaded",
      detail: "Tap Fetch risk to request live values.",
      values: {},
      visual: { state: "unloaded", label: "Not loaded", icon: "", color: "#607080" },
      hourlyRows: [],
      next12: [],
      next24: []
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

  function scoreCurrent(values) {
    const checks = [
      gustRisk(values.gust, "current gust"),
      windRisk(values.wind, "current wind"),
      rainRisk(values.rain, "current rain"),
      showersRisk(values.showers, "current showers"),
      snowRisk(values.snow, "current snow"),
      visibilityRisk(values.currentVisibility, "current visibility"),
      thunderRisk(values.thunderCurrent, "current thunderstorm code")
    ].filter(Boolean);

    return scoreFromChecks(checks);
  }

  function scoreNext(values) {
    const checks = [
      gustRisk(values.maxNextGust, "next 12h gust"),
      windRisk(values.maxNextWind, "next 12h wind"),
      rainRisk(Math.max(values.maxNextRain, values.maxNextPrecip), "next 12h rain/precip"),
      showersRisk(values.maxNextShowers, "next 12h showers"),
      snowRisk(Math.max(values.maxNextSnow, values.maxNextSnowDepth), "next 12h snow/ice"),
      visibilityRisk(values.minNextVisibility, "next 12h visibility"),
      thunderRisk(values.thunderNext, "next 12h thunderstorm code"),
      precipProbabilityRisk(values.maxNextPrecipProb, values.wetHours12)
    ].filter(Boolean);

    return scoreFromChecks(checks);
  }

  function scoreFromChecks(checks) {
    const sorted = [...checks].sort((a, b) => b.score - a.score);
    const score = sorted.reduce((highest, check) => Math.max(highest, check.score), 0);
    const reasons = sorted.map(check => check.reason);

    return { score, label: riskLabel(score), level: riskLevel(score), reasons, topCheck: sorted[0] || null };
  }

  function gustRisk(value, label) {
    const gust = number(value);
    if (gust >= 55) return { score: 4, reason: `${label}: ${fmt(gust)} mph. Severe exposure risk.` };
    if (gust >= 42) return { score: 3, reason: `${label}: ${fmt(gust)} mph. High gust risk.` };
    if (gust >= 30) return { score: 2, reason: `${label}: ${fmt(gust)} mph. Watch for exposed sites.` };
    if (gust >= 22) return { score: 1, reason: `${label}: ${fmt(gust)} mph. Breezy.` };
    return null;
  }

  function windRisk(value, label) {
    const wind = number(value);
    if (wind >= 42) return { score: 3, reason: `${label}: ${fmt(wind)} mph sustained wind.` };
    if (wind >= 30) return { score: 2, reason: `${label}: ${fmt(wind)} mph sustained wind.` };
    if (wind >= 22) return { score: 1, reason: `${label}: ${fmt(wind)} mph sustained wind.` };
    return null;
  }

  function rainRisk(value, label) {
    const rain = number(value);
    if (rain >= 8) return { score: 4, reason: `${label}: ${fmt(rain)} mm/h. Very heavy rain.` };
    if (rain >= 4) return { score: 3, reason: `${label}: ${fmt(rain)} mm/h. Heavy rain.` };
    if (rain >= 1.5) return { score: 2, reason: `${label}: ${fmt(rain)} mm/h. Moderate rain.` };
    if (rain > 0) return { score: 1, reason: `${label}: ${fmt(rain)} mm/h. Light rain.` };
    return null;
  }

  function showersRisk(value, label) {
    const showers = number(value);
    if (showers >= 4) return { score: 3, reason: `${label}: ${fmt(showers)} mm. Heavy showers.` };
    if (showers >= 1) return { score: 2, reason: `${label}: ${fmt(showers)} mm. Showers likely.` };
    if (showers > 0) return { score: 1, reason: `${label}: ${fmt(showers)} mm. Light showers.` };
    return null;
  }

  function snowRisk(value, label) {
    const snow = number(value);
    if (snow > 0) return { score: 3, reason: `${label}: ${fmt(snow)}. Snow/ice flag.` };
    return null;
  }

  function visibilityRisk(value, label) {
    const visibility = number(value);
    if (!visibility) return null;
    if (visibility <= 0.5) return { score: 4, reason: `${label}: ${fmt(visibility, 1)} km. Very poor visibility.` };
    if (visibility <= 1) return { score: 3, reason: `${label}: ${fmt(visibility, 1)} km. Poor visibility.` };
    if (visibility <= 3) return { score: 2, reason: `${label}: ${fmt(visibility, 1)} km. Reduced visibility.` };
    return null;
  }

  function thunderRisk(isThunder, label) {
    return isThunder ? { score: 4, reason: `${label}: thunderstorm weather code present. Treat as lightning-risk proxy only.` } : null;
  }

  function precipProbabilityRisk(probability, wetHours) {
    const probabilityValue = number(probability);
    const wetHourCount = number(wetHours);
    if (probabilityValue >= 90 && wetHourCount >= 3) return { score: 2, reason: `next 12h precip chance: ${fmt(probabilityValue, 0)}% across ${wetHourCount} wet hour(s).` };
    if (probabilityValue >= 60 && wetHourCount >= 1) return { score: 1, reason: `next 12h precip chance: ${fmt(probabilityValue, 0)}%.` };
    return null;
  }

  function riskLabel(score) {
    return score >= 4 ? "Severe" : score === 3 ? "High" : score === 2 ? "Moderate" : score === 1 ? "Low" : "Clear";
  }

  function riskLevel(score) {
    return score >= 4 ? "severe" : score === 3 ? "high" : score === 2 ? "moderate" : score === 1 ? "low" : "none";
  }

  function makeVisualState(risk) {
    const values = risk.values || {};

    if (!risk.values || risk.level === "unloaded") {
      return { state: "unloaded", label: "Not loaded", icon: "", color: "#607080" };
    }

    if (values.thunder || (risk.score >= 4 && (values.thunderCurrent || values.thunderNext))) {
      return { state: "lightning", label: "Lightning / thunder", icon: "", color: "#ff3131" };
    }

    const peakGust = Math.max(number(values.gust), number(values.maxNextGust));
    const peakWind = Math.max(number(values.wind), number(values.maxNextWind));
    if (peakGust >= 36 || peakWind >= 30) {
      return { state: "storm", label: "Storm / wind", icon: "", color: "#ff8a1f" };
    }

    const rainAmount = Math.max(number(values.rain), number(values.maxNextRain), number(values.maxNextPrecip));
    if (rainAmount >= 0.2 || (number(values.maxNextPrecipProb) >= 70 && number(values.wetHours12) >= 1)) {
      return { state: "rain", label: "Rain", icon: "", color: "#22d9ff" };
    }

    return { state: "normal", label: values.isDay ? "Normal / sunny" : "Normal / night", icon: "", color: "#f6d55c" };
  }

  function visualRadius(stateName, score) {
    if (stateName === "lightning") return 36000;
    if (stateName === "storm") return 30000;
    if (stateName === "rain") return score >= 3 ? 24000 : 18000;
    return 11000;
  }

  function renderRiskList(risks) {
    const sorted = [...risks].sort((a, b) => b.score - a.score || b.nextRisk.score - a.nextRisk.score).slice(0, 14);

    if (!sorted.length) {
      els.riskList.innerHTML = `<div class="result-card"><span>No risk data returned.</span></div>`;
      return;
    }

    els.riskList.innerHTML = sorted.map(risk => `
      <article class="result-card compact-risk-card wx-${Lab.escapeHtml(risk.visual.state)}">
        <strong>${Lab.escapeHtml(risk.site.name)} - ${Lab.escapeHtml(risk.visual.label)}</strong>
        <span>${Lab.escapeHtml(risk.summary)} - ${Lab.escapeHtml(risk.detail)}</span>
        <button type="button" data-flyto="${Lab.escapeHtml(risk.site.id)}">Open full feature sheet</button>
      </article>
    `).join("");

    els.riskList.querySelectorAll("[data-flyto]").forEach(button => {
      button.addEventListener("click", () => flyToSite(button.dataset.flyto, true));
    });
  }

  function openSiteDetail(site, risk, panMap = true) {
    state.selectedSiteId = site.id;
    if (panMap) map.panTo([site.lat, site.lon], { animate: true, duration: 0.25 });

    const chosenRisk = state.riskBySite.get(site.id) || risk || makeEmptyRisk(site);
    setStatus(`${site.name}: ${chosenRisk.summary}. ${chosenRisk.detail}`);

    if (els.detailContent && els.detailPanel) {
      els.detailContent.innerHTML = renderDetailSheet(site, chosenRisk);
      els.detailPanel.hidden = false;
    }
  }

  function closeDetailPanel() {
    if (els.detailPanel) els.detailPanel.hidden = true;
  }

  function renderDetailSheet(site, risk) {
    const values = risk.values || {};
    const visual = risk.visual || makeVisualState(risk);
    const sourceRows = sourceFacts(risk).map(item => metric(item.label, item.value, item.hint)).join("");
    const decisionRows = [
      metric("Display state", visual.label, "highest-priority visible state"),
      metric("Current risk", risk.currentRisk?.label || "--", `score ${risk.currentRisk?.score ?? 0}`),
      metric("Next 12h", risk.nextRisk?.label || "--", `score ${risk.nextRisk?.score ?? 0}`),
      metric("Top reason", risk.detail || "--", "why it was flagged")
    ].join("");

    const windRows = [
      metric("Gust now", mph(values.gust), `max ${mph(values.maxNextGust)}`),
      metric("Wind now", mph(values.wind), `${compass(values.windDirection)} ${fmt(values.windDirection, 0)} deg`),
      metric("Max wind", mph(values.maxNextWind), "next 12h"),
      metric("Gust hours", String(values.highGustHours12 || 0), ">=30 mph next 12h")
    ].join("");

    const rainRows = [
      metric("Rain now", `${fmt(values.rain)} mm/h`, `max ${fmt(values.maxNextRain)} mm/h`),
      metric("Precip now", `${fmt(values.precipitation)} mm`, `max ${fmt(values.maxNextPrecip)} mm`),
      metric("Precip chance", `${fmt(values.maxNextPrecipProb, 0)}%`, "max next 12h"),
      metric("Wet hours", String(values.wetHours12 || 0), "next 12h"),
      metric("Showers", `${fmt(values.showers)} mm`, `max ${fmt(values.maxNextShowers)} mm`),
      metric("Snow", `${fmt(values.snow)} cm`, `depth max ${fmt(values.maxNextSnowDepth)} cm`)
    ].join("");

    const visibilityRows = [
      metric("Visibility now", km(values.currentVisibility), `min ${km(values.minNextVisibility)}`),
      metric("Low-vis hours", String(values.lowVisibilityHours12 || 0), "<=3 km next 12h"),
      metric("Cloud now", percent(values.cloud), `max ${percent(values.maxNextCloud)}`),
      metric("Low cloud", percent(values.currentCloudLow), `max ${percent(values.maxNextCloudLow)}`),
      metric("Mid cloud", percent(values.currentCloudMid), `max ${percent(values.maxNextCloudMid)}`),
      metric("High cloud", percent(values.currentCloudHigh), `max ${percent(values.maxNextCloudHigh)}`)
    ].join("");

    const airRows = [
      metric("Temp", celsius(values.temperature), `${celsius(values.minNextTemperature)} to ${celsius(values.maxNextTemperature)}`),
      metric("Feels like", celsius(values.apparentTemperature), `${celsius(values.minNextFeels)} to ${celsius(values.maxNextFeels)}`),
      metric("Dew point", celsius(values.dewPoint), "nearest hourly value"),
      metric("Humidity", percent(values.humidity), "current"),
      metric("MSL pressure", hpa(values.pressureMsl), `trend ${values.pressureTrend}`),
      metric("Surface pressure", hpa(values.surfacePressure), "current")
    ].join("");

    const codeRows = [
      metric("Weather code", String(values.weatherCode ?? "--"), weatherCodeText(values.weatherCode)),
      metric("Day/night", values.isDay ? "Day" : "Night", "Open-Meteo is_day"),
      metric("Thunder", values.thunder ? "Inferred" : "Not flagged", "weather code only"),
      metric("Official warning", "Not connected", "Met Office polygon check pending")
    ].join("");

    const operationRows = makeOperationChecks(risk).map(check => `
      <article class="operation-check severity-${check.severity}">
        <strong>${Lab.escapeHtml(check.title)}</strong>
        <span>${Lab.escapeHtml(check.detail)}</span>
      </article>
    `).join("");

    const hourCards = (risk.next12 || []).map(hour => renderHourCard(hour)).join("") || `<article class="popup-hour-card"><strong>--</strong><small>Fetch risk first</small></article>`;
    const rawRows = renderRawDebug(risk);

    return `
      <div class="site-detail-hero wx-${Lab.escapeHtml(visual.state)}">
        <div>
          <p class="eyebrow">${Lab.escapeHtml(site.id)} - ${Lab.escapeHtml(site.region)}</p>
          <h2>${Lab.escapeHtml(site.name)}</h2>
          <div class="site-popup-meta">
            <span>${fmt(site.lat, 4)}, ${fmt(site.lon, 4)}</span>
            <span>${risk.fetchedAt ? `Fetched ${risk.fetchedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Not fetched"}</span>
          </div>
        </div>
        <div class="detail-state-badge">${Lab.escapeHtml(visual.label)}</div>
      </div>

      <div class="popup-hazard-strip risk-${Lab.escapeHtml(risk.level || "none")}">
        <strong>${Lab.escapeHtml(risk.summary)}</strong>
        <span>${Lab.escapeHtml(risk.detail)}</span>
      </div>

      <section class="detail-section">
        <h3>Decision / display</h3>
        <div class="popup-metric-grid four">${decisionRows}</div>
      </section>

      <section class="detail-section">
        <h3>Wind / exposure</h3>
        <div class="popup-metric-grid four">${windRows}</div>
      </section>

      <section class="detail-section">
        <h3>Rain / precipitation / snow</h3>
        <div class="popup-metric-grid four">${rainRows}</div>
      </section>

      <section class="detail-section">
        <h3>Visibility / cloud</h3>
        <div class="popup-metric-grid four">${visibilityRows}</div>
      </section>

      <section class="detail-section">
        <h3>Temperature / air</h3>
        <div class="popup-metric-grid four">${airRows}</div>
      </section>

      <section class="detail-section">
        <h3>Code / warnings</h3>
        <div class="popup-metric-grid four">${codeRows}</div>
      </section>

      <section class="detail-section">
        <h3>Operational checks</h3>
        <div class="operation-grid">${operationRows}</div>
      </section>

      <section class="detail-section">
        <h3>Next 12h feature scan</h3>
        <div class="hour-table">${hourCards}</div>
      </section>

      <section class="detail-section">
        <h3>Source / metadata</h3>
        <div class="popup-metric-grid four">${sourceRows}</div>
      </section>

      <details class="raw-details">
        <summary>Raw/debug values requested</summary>
        <div class="raw-debug-grid">${rawRows}</div>
      </details>

      <p class="popup-footnote">This is deliberately overloaded. It uses Open-Meteo forecast/current fields only. Lightning is inferred from WMO weather codes; official Met Office warnings are not linked yet.</p>
    `;
  }

  function renderHourCard(hour) {
    const score = scoreFromChecks([
      gustRisk(hour.gust, "gust"),
      windRisk(hour.wind, "wind"),
      rainRisk(Math.max(number(hour.rain), number(hour.precipitation)), "rain"),
      showersRisk(hour.showers, "showers"),
      snowRisk(Math.max(number(hour.snowfall), number(hour.snowDepth)), "snow"),
      visibilityRisk(hour.visibilityKm, "visibility"),
      thunderRisk(isThunderCode(hour.weatherCode), "thunder")
    ].filter(Boolean));

    return `
      <article class="hour-feature-card risk-${score.level}">
        <strong>${hourLabel(hour.time)}</strong>
        <span class="hour-icon">${weatherIcon(hour.weatherCode)}</span>
        <small>${weatherCodeText(hour.weatherCode)}</small>
        <b>${score.label}</b>
        <span>Temp ${celsius(hour.temperature)} / feels ${celsius(hour.apparentTemperature)}</span>
        <span>Wind ${mph(hour.wind)} - gust ${mph(hour.gust)}</span>
        <span>Rain ${fmt(hour.rain || hour.precipitation)} mm - ${fmt(hour.precipitationProbability, 0)}%</span>
        <span>Vis ${km(hour.visibilityKm)} - cloud ${percent(hour.cloud)}</span>
      </article>
    `;
  }

  function renderRiskListSummaryValue(risk) {
    return `${risk.visual.label} - ${risk.summary}`;
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

  function makeOperationChecks(risk) {
    const values = risk.values || {};
    const checks = [];

    checks.push(checkItem(
      "Mast / exposed work",
      (values.thunder ? 4 : 0) || ((values.maxNextGust || values.gust || 0) >= 42 ? 3 : (values.maxNextGust || values.gust || 0) >= 30 ? 2 : 1),
      values.thunder ? "Thunderstorm code present: do not treat as safe for exposed structures." : `Peak gust ${mph(values.maxNextGust || values.gust)}.`
    ));

    checks.push(checkItem(
      "Track / access",
      Math.max((values.minNextVisibility || values.currentVisibility || 99) <= 1 ? 3 : (values.minNextVisibility || values.currentVisibility || 99) <= 3 ? 2 : 1, (values.maxNextRain || 0) >= 4 ? 3 : (values.maxNextRain || 0) > 0 ? 1 : 0),
      `Visibility min ${km(values.minNextVisibility || values.currentVisibility)}, rain max ${fmt(values.maxNextRain)} mm/h.`
    ));

    checks.push(checkItem(
      "RF / water ingress watch",
      (values.maxNextRain || values.rain || 0) >= 4 ? 3 : (values.wetHours12 || 0) >= 3 ? 2 : (values.wetHours12 || 0) > 0 ? 1 : 0,
      `${values.wetHours12 || 0} wet hour(s) next 12h, max precip ${fmt(values.maxNextPrecip)} mm.`
    ));

    checks.push(checkItem(
      "Signal fade / path watch",
      Math.max((values.maxNextRain || 0) >= 4 ? 2 : (values.maxNextRain || 0) > 0 ? 1 : 0, (values.maxNextCloud || values.cloud || 0) >= 95 ? 1 : 0),
      `Rain max ${fmt(values.maxNextRain)} mm/h, cloud max ${percent(values.maxNextCloud)}.`
    ));

    checks.push(checkItem(
      "Ice / snow",
      (values.maxNextSnow || values.maxNextSnowDepth || values.snow || 0) > 0 ? 3 : 0,
      `Snow ${fmt(values.snow)} now, max depth ${fmt(values.maxNextSnowDepth)} cm.`
    ));

    checks.push(checkItem(
      "Official warnings",
      0,
      "Not checked yet. Needs Met Office warning polygon layer."
    ));

    return checks;
  }

  function checkItem(title, score, detail) {
    return { title, detail, severity: score >= 4 ? "severe" : score === 3 ? "high" : score === 2 ? "moderate" : score === 1 ? "low" : "none" };
  }

  function sourceFacts(risk) {
    const values = risk.values || {};
    const row = risk.row || {};
    return [
      { label: "Source", value: "Open-Meteo", hint: "no key test API" },
      { label: "Model time", value: values.sourceModelTime || "--", hint: "current.time" },
      { label: "Timezone", value: values.timezone || "--", hint: `${values.utcOffsetSeconds || 0}s offset` },
      { label: "Elevation", value: values.elevation ? `${fmt(values.elevation, 0)} m` : "--", hint: "provider value" },
      { label: "Generated", value: values.generationTimeMs ? `${fmt(values.generationTimeMs, 1)} ms` : "--", hint: "generationtime_ms" },
      { label: "Current units", value: Object.keys(row.current_units || {}).length ? "present" : "--", hint: "from response" },
      { label: "Hourly rows", value: String((risk.hourlyRows || []).length), hint: "from now onward" },
      { label: "Requested", value: `${CURRENT_FIELDS.length}+${HOURLY_FIELDS.length}`, hint: "current + hourly fields" }
    ];
  }

  function renderRawDebug(risk) {
    const values = risk.values || {};
    const entries = [
      ["weather_code", values.weatherCode],
      ["visual_state", risk.visual?.state],
      ["current_score", risk.currentRisk?.score],
      ["next12_score", risk.nextRisk?.score],
      ["temperature_2m", values.temperature],
      ["apparent_temperature", values.apparentTemperature],
      ["relative_humidity_2m", values.humidity],
      ["dew_point_2m", values.dewPoint],
      ["wind_speed_10m", values.wind],
      ["wind_gusts_10m", values.gust],
      ["wind_direction_10m", values.windDirection],
      ["rain", values.rain],
      ["showers", values.showers],
      ["snowfall", values.snow],
      ["precipitation", values.precipitation],
      ["precip_probability_current_hour", values.currentPrecipProbability],
      ["visibility_current_hour_km", values.currentVisibility],
      ["min_visibility_next12_km", values.minNextVisibility],
      ["cloud_cover", values.cloud],
      ["cloud_low_current", values.currentCloudLow],
      ["cloud_mid_current", values.currentCloudMid],
      ["cloud_high_current", values.currentCloudHigh],
      ["pressure_msl", values.pressureMsl],
      ["surface_pressure", values.surfacePressure],
      ["thunder_inferred", values.thunder]
    ];

    return entries.map(([key, value]) => `
      <div><code>${Lab.escapeHtml(key)}</code><span>${Lab.escapeHtml(String(value ?? "--"))}</span></div>
    `).join("");
  }

  function findSite() {
    const query = els.siteSearch.value.trim().toLowerCase();
    if (!query) return;

    const found = Lab.allSites(state.regions).find(site =>
      site.name.toLowerCase().includes(query) || site.id.toLowerCase() === query
    );

    if (!found) {
      setStatus(`No sample site matched "${query}".`);
      return;
    }

    map.setView([found.lat, found.lon], 10);
    loadVisibleSites(false);
    renderSites(true);
    setStatus(`${found.name} selected. Fetch risk again if you want fresh visible-site values.`);
  }

  function flyToSite(siteId, openPanel = false) {
    const site = Lab.allSites(state.regions).find(candidate => candidate.id === siteId);
    if (!site) return;
    map.setView([site.lat, site.lon], Math.max(map.getZoom(), 10));
    loadVisibleSites(false);
    renderSites(true);
    if (openPanel) {
      window.setTimeout(() => {
        const latestSite = state.visibleSites.find(candidate => candidate.id === site.id) || site;
        openSiteDetail(latestSite, state.riskBySite.get(site.id) || makeEmptyRisk(site), false);
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

  function minFrom(rows, key) {
    const values = rows.map(row => number(row[key])).filter(value => Number.isFinite(value));
    return values.length ? Math.min(...values) : 0;
  }

  function minPositiveFrom(rows, key) {
    const values = rows.map(row => number(row[key])).filter(value => value > 0);
    return values.length ? Math.min(...values) : 0;
  }

  function countWhere(rows, predicate) {
    return rows.filter(predicate).length;
  }

  function pressureTrend(rows) {
    const first = rows.find(row => row.pressureMsl)?.pressureMsl;
    const last = [...rows].reverse().find(row => row.pressureMsl)?.pressureMsl;
    if (!first || !last) return "--";
    const diff = last - first;
    if (Math.abs(diff) < 1) return "steady";
    return diff > 0 ? `rising ${fmt(diff)} hPa` : `falling ${fmt(Math.abs(diff))} hPa`;
  }

  function fmt(value, places = 1) {
    if (!Number.isFinite(Number(value))) return "--";
    return String(Lab.round(value, places));
  }

  function mph(value) {
    return `${fmt(value)} mph`;
  }

  function celsius(value) {
    return `${fmt(value)} C`;
  }

  function percent(value) {
    return `${fmt(value, 0)}%`;
  }

  function hpa(value) {
    return value ? `${fmt(value, 0)} hPa` : "--";
  }

  function km(value) {
    return value ? `${fmt(value, 1)} km` : "--";
  }

  function hourLabel(time) {
    if (!time) return "--";
    return new Date(time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function compass(degrees) {
    if (!Number.isFinite(Number(degrees))) return "--";
    const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return points[Math.round(((Number(degrees) % 360) / 45)) % 8];
  }

  function isThunderCode(code) {
    return [95, 96, 99].includes(Number(code));
  }

  function weatherIcon(code) {
    const value = Number(code);
    if ([95, 96, 99].includes(value)) return "T";
    if ([71, 73, 75, 77, 85, 86].includes(value)) return "SN";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return "R";
    if ([45, 48].includes(value)) return "FG";
    if ([1, 2, 3].includes(value)) return "CL";
    return "OK";
  }

})();
