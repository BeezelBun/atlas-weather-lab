# Atlas Weather API Lab

A separate static test repo for FieldOps Atlas weather-provider experiments.

## Purpose

This repo is deliberately separate from the main Atlas app. It tests:

1. RainViewer radar tiles as a UK-wide rain/blob overlay.
2. Open-Meteo batched site risk for visible region sites.
3. Met Office DataHub Map Images access with a user-supplied key and order name.

No internal Atlas operational data belongs here.

## Provider notes

### RainViewer

No API key. The app calls:

```text
https://api.rainviewer.com/public/weather-maps.json
```

Then uses returned `host` and `path` values to create Leaflet radar tiles.

RainViewer public examples state personal-use limits including max native zoom level 7, Universal Blue, past radar data only and PNG format.

### Open-Meteo

No API key. The app batches visible site coordinates into compact forecast calls.

It intentionally fetches only a small set of variables for site-risk testing.

### Met Office DataHub Map Images

Requires your own DataHub API key and an active Map Images order. The key is typed into the browser session and is not stored in the repo.

The test request uses:

```text
https://data.hub.api.metoffice.gov.uk/map-images/1.0.0/orders/{order}/latest?detail=MINIMAL
```

and then tries to preview the first returned PNG file.

If this fails in browser due to CORS, that is useful: it means the final Atlas version needs a tiny backend/proxy or native iOS networking rather than direct GitHub Pages access.

## GitHub Pages

After creating the repo, enable Pages:

Settings → Pages → Deploy from branch → main → root.

Then open:

```text
https://beezelbun.github.io/atlas-weather-lab/
```

## Files

```text
index.html
styles.css
app.js
data/regions.json
README.md
```

## Safety

Do not commit API keys, access notes, contacts, internal links, ports, IPs, spares locations, configuration notes, job details or fault details.
