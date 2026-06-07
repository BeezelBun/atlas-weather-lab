/* Environment Agency rainfall gauge standalone test page v0.2.0 */

(() => {
  const Lab = window.AtlasWeatherLab;
  const EA_ROOT = "https://environment.data.gov.uk/flood-monitoring";

  const state = {
    regions: [],
    sites: [],
    siteMarker: null,
    gaugeLayer: null
  };

  const els = {
    statusText: document.getElementById("statusText"),
    siteSelect: document.getElementById("siteSelect"),
    distanceRange: document.getElementById("distanceRange"),
    distanceLabel: document.getElementById("distanceLabel"),
    loadGaugesButton: document.getElementById("loadGaugesButton"),
    clearGaugesButton: document.getElementById("clearGaugesButton"),
    gaugeList: document.getElementById("gaugeList")
  };

  const map = Lab.createBaseMap("map", { center: [52.15, -3.85], zoom: 7 });
  state.gaugeLayer = L.layerGroup().addTo(map);

  init();

  async function init() {
    state.regions = await Lab.loadRegions();
    state.sites = Lab.allSites(state.regions);
    populateSites();
    bindEvents();
    selectCurrentSite();
    setStatus("Ready. Pick a sample site and load nearby Environment Agency rainfall gauges.");
  }

  function populateSites() {
    els.siteSelect.innerHTML = state.sites.map(site => `
      <option value="${Lab.escapeHtml(site.id)}">${Lab.escapeHtml(site.name)} Â· ${Lab.escapeHtml(site.region)}</option>
    `).join("");

    const preseli = state.sites.find(site => site.name.toLowerCase() === "preseli");
    if (preseli) els.siteSelect.value = preseli.id;
  }

  function bindEvents() {
    els.siteSelect.addEventListener("change", selectCurrentSite);
    els.distanceRange.addEventListener("input", () => {
      els.distanceLabel.textContent = `${els.distanceRange.value} km`;
    });
    els.loadGaugesButton.addEventListener("click", loadNearbyGauges);
    els.clearGaugesButton.addEventListener("click", clearGauges);
  }

  function selectCurrentSite() {
    const site = currentSite();
    if (!site) return;

    if (state.siteMarker) map.removeLayer(state.siteMarker);

    state.siteMarker = L.marker([site.lat, site.lon], {
      icon: Lab.createDivIcon(`<div class="site-dot severe"></div>`)
    }).addTo(map);

    state.siteMarker.bindPopup(`<strong>${Lab.escapeHtml(site.name)}</strong><br />Sample site centre`);
    map.setView([site.lat, site.lon], 9);
    setStatus(`${site.name} selected. Load gauges to show measured rainfall near this sample site.`);
  }

  async function loadNearbyGauges() {
    const site = currentSite();
    if (!site) return;

    const distance = Number(els.distanceRange.value);
    const url = `${EA_ROOT}/id/stations?parameter=rainfall&lat=${site.lat}&long=${site.lon}&dist=${distance}&_view=full`;

    els.loadGaugesButton.disabled = true;
    els.loadGaugesButton.textContent = "Loadingâ¦";
    clearGauges(false);
    setStatus(`Loading rainfall gauges within ${distance} km of ${site.name}â¦`);

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Environment Agency HTTP ${response.status}`);

      const data = await response.json();
      const gauges = Array.isArray(data.items) ? data.items : [];
      const normalised = gauges
        .filter(gauge => Number.isFinite(Number(gauge.lat)) && Number.isFinite(Number(gauge.long)))
        .map(normaliseGauge);

      renderGauges(normalised);
      setStatus(`${normalised.length} rainfall gauge(s) loaded near ${site.name}.`);
    } catch (error) {
      setStatus(`Environment Agency rainfall failed: ${error.message}`);
    } finally {
      els.loadGaugesButton.disabled = false;
      els.loadGaugesButton.textContent = "Load nearby gauges";
    }
  }

  function normaliseGauge(gauge) {
    const measures = Array.isArray(gauge.measures) ? gauge.measures : [];
    const rainfallMeasure = measures.find(measure => measure.parameter === "rainfall") || measures[0] || {};
    const reading = rainfallMeasure.latestReading || {};
    const value = Number(reading.value || 0);

    return {
      id: gauge.stationReference || gauge.notation || gauge["@id"] || "unknown",
      lat: Number(gauge.lat),
      lon: Number(gauge.long),
      grid: gauge.gridReference || "unknown grid",
      value,
      unit: rainfallMeasure.unitName || "mm",
      dateTime: reading.dateTime,
      label: gauge.label || "Rainfall station"
    };
  }

  function renderGauges(gauges) {
    state.gaugeLayer.clearLayers();

    if (!gauges.length) {
      els.gaugeList.innerHTML = `<div class="gauge-card"><span>No rainfall gauges returned for this distance.</span></div>`;
      return;
    }

    gauges.forEach(gauge => {
      const wetClass = gauge.value >= 4 ? "heavy" : gauge.value > 0 ? "wet" : "";
      const marker = L.marker([gauge.lat, gauge.lon], {
        icon: Lab.createDivIcon(`<div class="gauge-dot ${wetClass}"></div>`)
      }).addTo(state.gaugeLayer);

      marker.bindPopup(renderGaugePopup(gauge));
    });

    els.gaugeList.innerHTML = gauges
      .sort((a, b) => b.value - a.value)
      .slice(0, 12)
      .map(gauge => `
        <article class="gauge-card">
          <strong>${Lab.escapeHtml(gauge.id)} Â· ${Lab.round(gauge.value)} ${Lab.escapeHtml(gauge.unit)}</strong>
          <span>${Lab.escapeHtml(gauge.grid)} Â· ${Lab.escapeHtml(Lab.formatDateTime(gauge.dateTime))}</span>
          <button type="button" data-gauge="${Lab.escapeHtml(gauge.id)}">View</button>
        </article>
      `).join("");

    els.gaugeList.querySelectorAll("[data-gauge]").forEach(button => {
      button.addEventListener("click", () => {
        const gauge = gauges.find(candidate => candidate.id === button.dataset.gauge);
        if (gauge) map.setView([gauge.lat, gauge.lon], Math.max(map.getZoom(), 11));
      });
    });
  }

  function renderGaugePopup(gauge) {
    return `
      <strong>${Lab.escapeHtml(gauge.id)}</strong><br />
      ${Lab.escapeHtml(gauge.grid)}<br />
      Latest: ${Lab.round(gauge.value)} ${Lab.escapeHtml(gauge.unit)}<br />
      ${Lab.escapeHtml(Lab.formatDateTime(gauge.dateTime))}
    `;
  }

  function clearGauges(updateStatus = true) {
    state.gaugeLayer.clearLayers();
    els.gaugeList.innerHTML = "";
    if (updateStatus) setStatus("Gauge layer cleared.");
  }

  function currentSite() {
    return state.sites.find(site => site.id === els.siteSelect.value);
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }
})();
