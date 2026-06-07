/* Atlas Weather API Lab shared utilities v0.2.0
   Static-safe: no committed API keys, no internal operational data.
*/

window.AtlasWeatherLab = (() => {
  const version = "0.2.0";
  const regionsUrl = "data/regions.json";

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

  async function loadRegions() {
    try {
      const response = await fetch(regionsUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Region file HTTP ${response.status}`);
      const data = await response.json();
      return Array.isArray(data.regions) ? data.regions : fallbackRegions;
    } catch (error) {
      console.warn("Using fallback regions", error);
      return fallbackRegions;
    }
  }

  function createBaseMap(elementId, options = {}) {
    const map = L.map(elementId, {
      zoomControl: false,
      preferCanvas: true,
      ...options.mapOptions
    }).setView(options.center || [52.15, -3.85], options.zoom || 7);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    return map;
  }

  function mapBoundsIntersect(mapBounds, regionBounds) {
    const southWest = L.latLng(regionBounds[0][0], regionBounds[0][1]);
    const northEast = L.latLng(regionBounds[1][0], regionBounds[1][1]);
    return mapBounds.intersects(L.latLngBounds(southWest, northEast));
  }

  function visibleRegionsForMap(map, regions) {
    const bounds = map.getBounds();
    return regions.filter(region => mapBoundsIntersect(bounds, region.bounds));
  }

  function sitesFromRegions(regions) {
    const seen = new Set();
    const sites = [];

    regions.forEach(region => {
      (region.sites || []).forEach(site => {
        if (seen.has(site.id)) return;
        seen.add(site.id);
        sites.push({ ...site, region: region.name, regionId: region.id });
      });
    });

    return sites;
  }

  function allSites(regions) {
    return sitesFromRegions(regions);
  }

  function createDivIcon(html, size = [24, 24], anchor = [12, 12]) {
    return L.divIcon({
      className: "",
      html,
      iconSize: size,
      iconAnchor: anchor
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatTime(unixSeconds) {
    return new Date(unixSeconds * 1000).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDateTime(value) {
    if (!value) return "unknown time";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function round(value, places = 1) {
    const factor = 10 ** places;
    return Math.round(Number(value || 0) * factor) / factor;
  }

  function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
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

  function riskRadius(level) {
    return {
      severe: 34000,
      high: 26000,
      moderate: 19000,
      low: 13000,
      none: 9000
    }[level] || 13000;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  return {
    version,
    loadRegions,
    createBaseMap,
    visibleRegionsForMap,
    sitesFromRegions,
    allSites,
    createDivIcon,
    escapeHtml,
    formatTime,
    formatDateTime,
    round,
    chunk,
    riskColor,
    riskRadius,
    setText,
    setHtml
  };
})();
