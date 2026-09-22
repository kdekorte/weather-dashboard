/**
 * map.js — Panel 3: Leaflet map + RainViewer precipitation radar.
 *
 * - OSM base tiles (no key)
 * - RainViewer animated radar: up to 15 historical frames, smooth cross-fade,
 *   refreshes every 5 minutes, pre-loads all tiles before animating.
 */

// Default zoom level
const DEFAULT_ZOOM = 7;

// Radar settings
const RADAR_MAX_FRAMES     = 15;   // max historical frames to keep
const RADAR_REFRESH_MS     = 5 * 60 * 1000;  // 5 minutes
const RADAR_FRAME_DWELL_MS = 1000;  // ms each frame is shown
const RADAR_FADE_MS        = 400;  // cross-fade duration (CSS transition)

let _map             = null;
let _homeLatLng      = null;
let _pinnedMarker    = null;   // marker at the double-clicked location
let _homeMarker      = null;   // marker at the home location
let _radarPaused     = false;  // true when animation is manually paused
let _radarLayers     = [];   // Leaflet tile layers, one per frame
let _radarTimestamps = [];   // unix timestamps matching each layer
let _radarFrameIdx   = 0;
let _radarAnimTimer  = null;
let _radarRefreshTimer = null;
let _idleTimer       = null;   // auto-return-to-home timer

// 10 minutes of map inactivity before returning home
const MAP_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// ---- RainViewer ---------------------------------------------------------

async function fetchRadarFrames() {
  const url = 'https://api.rainviewer.com/public/weather-maps.json';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RainViewer metadata HTTP ${res.status}`);
  const data = await res.json();
  const host   = data.host || 'https://tilecache.rainviewer.com';
  const frames = data.radar?.past || [];
  // Take up to RADAR_MAX_FRAMES most recent frames
  return frames.slice(-RADAR_MAX_FRAMES).map(f => ({
    time:    f.time,
    tileUrl: `${host}${f.path}/512/{z}/{x}/{y}/2/1_1.png`,
  }));
}

function radarTimestampLabel(ts) {
  const d = new Date(ts * 1000);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (AppConfig.timeFormat === '12h') {
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `Radar ${h % 12 || 12}:${m} ${ampm}`;
  }
  return `Radar ${String(h).padStart(2,'0')}:${m}`;
}

/**
 * Wait until all tiles for a layer are loaded (or timeout after 8s).
 * Resolves immediately if the layer has no pending tiles.
 */
function waitForLayerLoad(layer) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };

    // If Leaflet reports the layer is already idle, resolve right away
    if (layer._loading === false || !layer._loading) {
      // Give a short tick for tiles to start requesting
      setTimeout(() => {
        if (!done) {
          layer.once('load', finish);
          // Safety timeout
          setTimeout(finish, 8000);
        }
      }, 50);
    } else {
      layer.once('load', finish);
      setTimeout(finish, 8000);
    }
  });
}

// ---- Animation ----------------------------------------------------------

function stopRadarAnimation() {
  if (_radarAnimTimer) {
    clearTimeout(_radarAnimTimer);
    _radarAnimTimer = null;
  }
}

/**
 * Show a layer by bringing it to the top of the stack at full opacity.
 * Hide a layer by pushing it behind and setting display:none on its container.
 * No opacity animation — eliminates all flash caused by opacity dips.
 */
function showLayer(layer) {
  const el = layer._container;
  if (el) {
    el.style.display = '';
    el.style.zIndex  = 250;
  }
  layer.setOpacity(AppConfig.radarOpacity || 0.6);
}

function hideLayer(layer) {
  const el = layer._container;
  if (el) {
    el.style.zIndex  = 200;
    el.style.display = 'none';
  }
  layer.options.opacity = 0;
}

function scheduleNextFrame() {
  // Most recent frame dwells twice as long before the loop restarts
  const isLast  = _radarFrameIdx === _radarLayers.length - 1;
  const delay   = isLast ? RADAR_FRAME_DWELL_MS * 2 : RADAR_FRAME_DWELL_MS;

  _radarAnimTimer = setTimeout(() => {
    const current = _radarLayers[_radarFrameIdx];

    // Advance index
    _radarFrameIdx = (_radarFrameIdx + 1) % _radarLayers.length;
    const next = _radarLayers[_radarFrameIdx];

    // Bring next frame on top first, then hide the current one
    showLayer(next);
    hideLayer(current);

    document.getElementById('radar-timestamp').textContent =
      radarTimestampLabel(_radarTimestamps[_radarFrameIdx]);

    scheduleNextFrame();
  }, delay);
}

function startRadarAnimation() {
  stopRadarAnimation();
  if (_radarPaused || _radarLayers.length < 2) return;
  scheduleNextFrame();
}

// ---- Play / Pause button icon helpers -----------------------------------

const ICON_PAUSE = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
  <rect x="2" y="1" width="4" height="14" rx="1"/>
  <rect x="10" y="1" width="4" height="14" rx="1"/>
</svg>`;

const ICON_PLAY = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
  <polygon points="3,1 14,8 3,15"/>
</svg>`;

// ---- Load / reload radar ------------------------------------------------

async function loadRadar() {
  try {
    const frames = await fetchRadarFrames();
    if (!frames.length) return;

    // Check whether the newest frame is already in our set
    const latestTime = frames[frames.length - 1].time;
    const alreadyCurrent = _radarTimestamps.length > 0 &&
      _radarTimestamps[_radarTimestamps.length - 1] === latestTime;
    if (alreadyCurrent) return;  // nothing new from the API

    // Pause animation while we rebuild
    stopRadarAnimation();

    // Reuse existing layers for timestamps we already have
    const existingMap = new Map();
    _radarTimestamps.forEach((ts, i) => existingMap.set(ts, _radarLayers[i]));

    const newLayers     = [];
    const newTimestamps = [];
    const layersToPreload = [];

    frames.forEach(frame => {
      let layer = existingMap.get(frame.time);
      if (!layer) {
        layer = L.tileLayer(frame.tileUrl, {
          opacity:     0,
          tileSize:    512,
          zoomOffset:  -1,
          attribution: 'Radar © <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>',
        });
        layer.addTo(_map);
        layersToPreload.push(layer);
        existingMap.delete(frame.time);
      }
      newLayers.push(layer);
      newTimestamps.push(frame.time);
    });

    // Remove layers that aged out of the window
    _radarLayers.forEach(l => {
      if (!newLayers.includes(l)) _map.removeLayer(l);
    });

    _radarLayers     = newLayers;
    _radarTimestamps = newTimestamps;

    // Pre-load only new tile layers before animating
    if (layersToPreload.length > 0) {
      await Promise.all(layersToPreload.map(waitForLayerLoad));
    }

    // Hide every frame, show the oldest to start the sweep
    _radarLayers.forEach(l => hideLayer(l));
    _radarFrameIdx = 0;
    showLayer(_radarLayers[0]);

    document.getElementById('radar-timestamp').textContent =
      radarTimestampLabel(_radarTimestamps[0]);

    startRadarAnimation();
  } catch (err) {
    console.error('Radar load failed:', err);
  }
}

// ---- Map init -----------------------------------------------------------

function initMap() {
  const lat  = AppConfig.latitude;
  const lon  = AppConfig.longitude;
  _homeLatLng = [lat, lon];

  const zoom = DEFAULT_ZOOM;

  _map = L.map('map', {
    center:             _homeLatLng,
    zoom:               zoom,
    zoomControl:        false,
    attributionControl: true,
    doubleClickZoom:    false,
  });

  L.control.zoom({ position: 'topright' }).addTo(_map);

  // Home button — resets pinned location and recentres to home
  const HomeControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-home-btn');
      btn.title = 'Reset to home location';
      btn.innerHTML = `<a role="button" aria-label="Reset to home location" href="#" style="display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M8 1.5L1 7.5h2V14h4v-4h2v4h4V7.5h2L8 1.5z"/>
        </svg>
      </a>`;
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        resetToHome();
      });
      return btn;
    }
  });
  new HomeControl().addTo(_map);

  // Play/Pause radar animation button
  const PlayPauseControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-playpause-btn');
      btn.title = 'Pause radar animation';
      btn.innerHTML = `<a role="button" aria-label="Pause radar animation" href="#" style="display:flex;align-items:center;justify-content:center;">${ICON_PAUSE}</a>`;
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        const anchor = btn.querySelector('a');
        if (_radarPaused) {
          // Resume
          _radarPaused = false;
          btn.title = 'Pause radar animation';
          anchor.setAttribute('aria-label', 'Pause radar animation');
          anchor.innerHTML = ICON_PAUSE;
          startRadarAnimation();
        } else {
          // Pause — show the most recent frame
          _radarPaused = true;
          stopRadarAnimation();
          btn.title = 'Resume radar animation';
          anchor.setAttribute('aria-label', 'Resume radar animation');
          anchor.innerHTML = ICON_PLAY;
          // Snap to the last (most recent) frame
          _radarLayers.forEach((l, i) => {
            if (i === _radarLayers.length - 1) showLayer(l);
            else hideLayer(l);
          });
          if (_radarTimestamps.length) {
            _radarFrameIdx = _radarLayers.length - 1;
            document.getElementById('radar-timestamp').textContent =
              radarTimestampLabel(_radarTimestamps[_radarFrameIdx]);
          }
        }
      });
      return btn;
    }
  });
  new PlayPauseControl().addTo(_map);

  // Base tile layer — OSM
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:     19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
  }).addTo(_map);

  // Home location marker (permanent, blue)
  _homeMarker = L.circleMarker(_homeLatLng, {
    radius:      6,
    color:       '#3b82d4',
    fillColor:   '#3b82d4',
    fillOpacity: 1,
    weight:      2,
  }).addTo(_map);

  // Double-click on the map → pin that location, fetch weather for it
  _map.on('dblclick', (e) => {
    const { lat, lng } = e.latlng;
    setPinnedLocation(lat, lng);
  });

  // Reset idle timer on any map interaction
  _map.on('moveend zoomend', resetIdleTimer);

  // Ensure Leaflet picks up the actual rendered size (100vh vs fixed px)
  setTimeout(() => _map.invalidateSize(), 100);

  // Load all historical radar frames immediately on startup
  loadRadar();

  // Refresh radar every 5 minutes independent of weather refresh
  _radarRefreshTimer = setInterval(loadRadar, RADAR_REFRESH_MS);
}

// ── Idle auto-return ──────────────────────────────────────────────────────────

function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(resetToHome, MAP_IDLE_TIMEOUT_MS);
}

// ── Pinned location helpers ───────────────────────────────────────────────────

function setPinnedLocation(lat, lng) {
  // Move or create the pinned marker (orange)
  if (_pinnedMarker) {
    _pinnedMarker.setLatLng([lat, lng]);
  } else {
    _pinnedMarker = L.circleMarker([lat, lng], {
      radius:      6,
      color:       '#d4790a',
      fillColor:   '#d4790a',
      fillOpacity: 1,
      weight:      2,
    }).addTo(_map);
  }

  // Centre the map on the new location
  _map.setView([lat, lng], _map.getZoom(), { animate: true });

  // Notify weather module
  document.dispatchEvent(new CustomEvent('locationPinned', {
    detail: { lat, lon: lng }
  }));
}

function setHomeLocation(lat, lng) {
  _homeLatLng = [lat, lng];

  // Move the permanent blue home marker
  if (_homeMarker) {
    _homeMarker.setLatLng(_homeLatLng);
  }

  // Remove any temporary pin — this location IS home now
  if (_pinnedMarker) {
    _map.removeLayer(_pinnedMarker);
    _pinnedMarker = null;
  }

  // Centre map on the new home
  _map.setView(_homeLatLng, DEFAULT_ZOOM, { animate: true });
}

function resetToHome() {
  // Remove pinned marker
  if (_pinnedMarker) {
    _map.removeLayer(_pinnedMarker);
    _pinnedMarker = null;
  }

  // Re-centre on home
  _map.setView(_homeLatLng, DEFAULT_ZOOM, { animate: true });

  // Notify weather module to restore home weather
  document.dispatchEvent(new CustomEvent('locationPinned', {
    detail: { lat: _homeLatLng[0], lon: _homeLatLng[1] }
  }));
}
