/**
 * config.js — reads weatherConfig from neutralino.config.json,
 * then merges weather.config.json (user override) on top.
 *
 * Override file lives next to the binary (NL_PATH/weather.config.json).
 * It is a plain JSON object with any subset of weatherConfig keys, e.g.:
 *   { "latitude": 40.71, "longitude": -74.00, "useGeolocation": false }
 *
 * Falls back to safe defaults so the app works without
 * Neutralino (e.g. opened directly in a browser for dev).
 */

const DEFAULT_CONFIG = {
  latitude: null,
  longitude: null,
  useGeolocation: true,
  units: 'imperial',
  timeFormat: '12h',
  refreshIntervalSeconds: 300,
  radarOpacity: 0.6,
  radarFrameCount: 2,
  showMenuBar: true,
  theme: 'light',
};

// Fallback coordinates: Kansas City, MO
const FALLBACK_LAT = 39.0997;
const FALLBACK_LON = -94.5786;

const AppConfig = { ...DEFAULT_CONFIG };

// Set by resolveCoordinates: 'gps' | 'config' | 'fallback'
AppConfig.locationSource = 'fallback';

// Base path resolved once at startup
let _basePath = '.';

/**
 * Initialise config by reading neutralino.config.json then
 * weather.config.json (user override), merging in order.
 * Must be awaited before any other module starts.
 */
async function initConfig() {
  if (typeof NL_PATH !== 'undefined') {
    _basePath = NL_PATH;
  }

  try {
    if (typeof Neutralino !== 'undefined') {
      // 1. Read the app config (weatherConfig block)
      const raw = await Neutralino.filesystem.readFile(_basePath + '/neutralino.config.json');
      const json = JSON.parse(raw);
      const wc = json.weatherConfig || {};
      Object.assign(AppConfig, DEFAULT_CONFIG, wc);
    }
  } catch (_) {
    // Not in Neutralino runtime or file unreadable — use defaults
  }

  try {
    if (typeof Neutralino !== 'undefined') {
      // 2. Merge user override file (may not exist — that's fine)
      const raw = await Neutralino.filesystem.readFile(_basePath + '/weather.config.json');
      const override = JSON.parse(raw);
      Object.assign(AppConfig, override);
    }
  } catch (_) {
    // No override file — use whatever neutralino.config.json provided
  }

  // Restore persisted unit preference
  const savedUnits = localStorage.getItem('wx_units');
  if (savedUnits === 'imperial' || savedUnits === 'metric') {
    AppConfig.units = savedUnits;
  }

  // Resolve coordinates
  await resolveCoordinates();
}

/**
 * Save a partial config object to weather.config.json.
 * Merges with any existing override file content so unrelated
 * keys are preserved.
 */
async function saveOverrideConfig(updates) {
  if (typeof Neutralino === 'undefined') return;

  let existing = {};
  try {
    const raw = await Neutralino.filesystem.readFile(_basePath + '/weather.config.json');
    existing = JSON.parse(raw);
  } catch (_) {
    // File doesn't exist yet — start fresh
  }

  const merged = { ...existing, ...updates };
  await Neutralino.filesystem.writeFile(
    _basePath + '/weather.config.json',
    JSON.stringify(merged, null, 2)
  );

  // Apply to live AppConfig immediately
  Object.assign(AppConfig, updates);
}

/**
 * Resolve lat/lon via geolocation -> config -> fallback.
 */
async function resolveCoordinates() {
  // GPS is tried first whenever useGeolocation is true, even if a config
  // location is already saved — the toggle explicitly says "prefer GPS".
  if (AppConfig.useGeolocation) {
    try {
      const pos = await getGeolocation();
      AppConfig.latitude       = pos.coords.latitude;
      AppConfig.longitude      = pos.coords.longitude;
      AppConfig.locationSource = 'gps';
      return;
    } catch (_) {
      // geolocation denied or unavailable — fall through to config/fallback
    }
  }

  if (AppConfig.latitude && AppConfig.longitude) {
    AppConfig.locationSource = 'config';
    return;
  }

  // Final fallback
  AppConfig.latitude       = FALLBACK_LAT;
  AppConfig.longitude      = FALLBACK_LON;
  AppConfig.locationSource = 'fallback';
}

/**
 * Get the device's current coordinates.
 *
 * When running inside Neutralino, we invoke the bundled get-location binary
 * (a compiled Swift helper that calls CoreLocation directly) via
 * Neutralino.os.execCommand. This bypasses WKWebView's broken geolocation
 * pipeline and shows the app in macOS Location Services settings.
 *
 * Falls back to navigator.geolocation for plain-browser dev use.
 */
async function getGeolocation() {
  if (typeof Neutralino !== 'undefined') {
    const helperPath = _basePath + '/get-location';
    try {
      const result = await Neutralino.os.execCommand(`"${helperPath}"`, { background: false });
      const output = (result.stdOut || '').trim();
      const parts  = output.split(',');
      if (parts.length === 2) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon)) {
          return { coords: { latitude: lat, longitude: lon } };
        }
      }
      throw new Error(result.stdErr || 'get-location returned unexpected output');
    } catch (err) {
      throw new Error('Native location helper failed: ' + err.message);
    }
  }

  // Fallback: browser navigator.geolocation (dev/browser mode)
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not available'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 8000,
      maximumAge: 60000,
    });
  });
}

/**
 * Toggle between imperial / metric and persist the choice.
 */
function toggleUnits() {
  AppConfig.units = AppConfig.units === 'imperial' ? 'metric' : 'imperial';
  localStorage.setItem('wx_units', AppConfig.units);
}
