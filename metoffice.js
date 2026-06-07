/* Met Office DataHub Map Images standalone test page v0.2.0 */

(() => {
  const Lab = window.AtlasWeatherLab;
  const METOFFICE_MAP_IMAGES_BASE = "https://data.hub.api.metoffice.gov.uk/map-images/1.0.0";

  const els = {
    key: document.getElementById("metOfficeKey"),
    order: document.getElementById("metOfficeOrder"),
    testButton: document.getElementById("testOrderButton"),
    clearButton: document.getElementById("clearButton"),
    output: document.getElementById("metOfficeOutput")
  };

  bindEvents();

  function bindEvents() {
    els.testButton.addEventListener("click", testOrder);
    els.clearButton.addEventListener("click", () => {
      els.output.textContent = "No Met Office request made yet.";
    });
  }

  async function testOrder() {
    const apiKey = els.key.value.trim();
    const orderName = els.order.value.trim().toLowerCase();

    if (!apiKey || !orderName) {
      els.output.textContent = "Paste an API key and order name first. Do not commit these into the repo.";
      return;
    }

    els.testButton.disabled = true;
    els.output.textContent = "Testing Met Office latest orderâ¦";

    try {
      const detailUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderName)}/latest?detail=MINIMAL`;
      const response = await fetch(detailUrl, {
        headers: {
          Accept: "application/json",
          apikey: apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Met Office latest-order request returned HTTP ${response.status}. If the browser reports CORS, this provider needs a proxy/native layer.`);
      }

      const json = await response.json();
      const files = findFiles(json);

      if (!files.length) {
        els.output.textContent = `Order request worked, but no files were found.\n\nRaw keys: ${Object.keys(json).join(", ")}`;
        return;
      }

      const firstFile = files[0];
      const firstFileId = firstFile.fileId || firstFile.filename || firstFile.name || firstFile.id || String(firstFile);

      els.output.innerHTML = `Order OK. ${files.length} file(s) found.\nFirst file: ${Lab.escapeHtml(firstFileId)}\n\nLoading preview imageâ¦`;
      await loadPreview(apiKey, orderName, firstFileId);
    } catch (error) {
      els.output.textContent = error.message;
    } finally {
      els.testButton.disabled = false;
    }
  }

  function findFiles(json) {
    if (Array.isArray(json?.orderDetails?.files)) return json.orderDetails.files;
    if (Array.isArray(json?.files)) return json.files;
    if (Array.isArray(json?.items)) return json.items;
    return [];
  }

  async function loadPreview(apiKey, orderName, fileId) {
    const pngUrl = `${METOFFICE_MAP_IMAGES_BASE}/orders/${encodeURIComponent(orderName)}/latest/${encodeURIComponent(fileId)}/data?includeLand=true`;
    const response = await fetch(pngUrl, {
      headers: {
        Accept: "image/png",
        apikey: apiKey
      }
    });

    if (!response.ok) throw new Error(`Met Office image request returned HTTP ${response.status}`);

    const blob = await response.blob();
    const localUrl = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.src = localUrl;
    img.alt = "Met Office Map Images API preview";
    els.output.appendChild(img);
  }
})();
