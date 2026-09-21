/**
 * weather.js — Panel 2: current conditions + 5-day forecast.
 *
 * Primary data source: Open-Meteo (free, no key required).
 * Reverse geocoding: nominatim.openstreetmap.org (free, no key).
 */

// Open-Meteo WMO weather code → { label, icon filename }
const WMO_CODES = {
  0:  { label: 'Clear Sky',           icon: 'clear-day' },
  1:  { label: 'Mainly Clear',        icon: 'clear-day' },
  2:  { label: 'Partly Cloudy',       icon: 'partly-cloudy-day' },
  3:  { label: 'Overcast',            icon: 'cloudy' },
  45: { label: 'Foggy',               icon: 'fog' },
  48: { label: 'Icy Fog',             icon: 'fog' },
  51: { label: 'Light Drizzle',       icon: 'drizzle' },
  53: { label: 'Drizzle',             icon: 'drizzle' },
  55: { label: 'Heavy Drizzle',       icon: 'drizzle' },
  61: { label: 'Light Rain',          icon: 'rain' },
  63: { label: 'Rain',                icon: 'rain' },
  65: { label: 'Heavy Rain',          icon: 'rain' },
  71: { label: 'Light Snow',          icon: 'snow' },
  73: { label: 'Snow',                icon: 'snow' },
  75: { label: 'Heavy Snow',          icon: 'snow' },
  77: { label: 'Snow Grains',         icon: 'snow' },
  80: { label: 'Light Showers',       icon: 'sleet' },
  81: { label: 'Showers',             icon: 'rain' },
  82: { label: 'Heavy Showers',       icon: 'rain' },
  85: { label: 'Snow Showers',        icon: 'snow' },
  86: { label: 'Heavy Snow Showers',  icon: 'snow' },
  95: { label: 'Thunderstorm',        icon: 'thunderstorm' },
  96: { label: 'Thunderstorm w/ Hail',icon: 'thunderstorm' },
  99: { label: 'Thunderstorm w/ Hail',icon: 'thunderstorm' },
};

const WIND_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function windDir(deg) {
  return WIND_DIRS[Math.round(deg / 22.5) % 16];
}

function wmoInfo(code) {
  return WMO_CODES[code] || { label: 'Unknown', icon: 'cloudy' };
}

// ---- Unit helpers -------------------------------------------------------

function fmtTemp(celsius) {
  if (AppConfig.units === 'imperial') {
    return Math.round(celsius * 9 / 5 + 32);
  }
  return Math.round(celsius);
}

function tempUnit() {
  return AppConfig.units === 'imperial' ? '°F' : '°C';
}

function fmtSpeed(kph) {
  if (AppConfig.units === 'imperial') {
    return `${Math.round(kph * 0.621371)} mph`;
  }
  return `${Math.round(kph)} km/h`;
}

// ---- Time helpers -------------------------------------------------------

function fmtTime(isoString) {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  if (isNaN(d)) return '--:--';
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (AppConfig.timeFormat === '12h') {
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m} ${ampm}`;
  }
  return `${String(h).padStart(2,'0')}:${m}`;
}

// ---- Reverse geocoding --------------------------------------------------

let _cachedLocation = null;

async function fetchLocationName(lat, lon) {
  if (_cachedLocation) return _cachedLocation;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error('nominatim');
    const data = await res.json();
    const addr = data.address || {};
    _cachedLocation = addr.city || addr.town || addr.village || addr.county || 'Unknown';
  } catch (_) {
    _cachedLocation = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  }
  return _cachedLocation;
}

// ---- Open-Meteo fetch ---------------------------------------------------

let _lastFetchTime = null;
let _lastWeatherData = null;

async function fetchWeather() {
  const lat = AppConfig.latitude;
  const lon = AppConfig.longitude;

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: [
      'temperature_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m',
      'relative_humidity_2m',
    ].join(','),
    hourly: [
      'precipitation_probability',
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max',
      'sunrise',
      'sunset',
      'uv_index_max',
    ].join(','),
    timezone: 'auto',
    forecast_days: 6,
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  return res.json();
}

// ---- Render -------------------------------------------------------------

function renderCurrent(data, locationName) {
  const c = data.current;
  const daily = data.daily;

  // Location source icon: satellite dish = GPS, pin = config, warning = fallback
  const srcIcons = {
    gps: `<svg class="location-icon" viewBox="0 0 14 14" width="13" height="13" style="display:inline-block;vertical-align:middle;margin-right:3px;cursor:pointer;" title="Click to set location">
      <circle cx="7" cy="7" r="2.5" fill="#2c8a3a"/>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="#2c8a3a" stroke-width="1.2"/>
      <line x1="7" y1="1" x2="7" y2="3" stroke="#2c8a3a" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="7" y1="11" x2="7" y2="13" stroke="#2c8a3a" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="1" y1="7" x2="3" y2="7" stroke="#2c8a3a" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="11" y1="7" x2="13" y2="7" stroke="#2c8a3a" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,
    config: `<svg class="location-icon" viewBox="0 0 14 14" width="13" height="13" style="display:inline-block;vertical-align:middle;margin-right:3px;cursor:pointer;" title="Click to set location">
      <line x1="7" y1="1" x2="7" y2="9" stroke="#3b82d4" stroke-width="1.5" stroke-linecap="round"/>
      <polygon points="4,6 7,9 10,6" fill="#3b82d4"/>
      <ellipse cx="7" cy="11.5" rx="2.5" ry="1" fill="#3b82d4" opacity="0.4"/>
    </svg>`,
    fallback: `<svg class="location-icon" viewBox="0 0 14 14" width="13" height="13" style="display:inline-block;vertical-align:middle;margin-right:3px;cursor:pointer;" title="Click to set location">
      <circle cx="7" cy="5" r="2.5" fill="none" stroke="#d4790a" stroke-width="1.4"/>
      <line x1="7" y1="7.5" x2="7" y2="11" stroke="#d4790a" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="7" cy="12.5" r="0.8" fill="#d4790a"/>
    </svg>`,
  };
  const locIcon = srcIcons[AppConfig.locationSource] || srcIcons.fallback;
  const locEl = document.getElementById('weather-location');
  locEl.innerHTML = `${locIcon}${locationName}`;

  const info = wmoInfo(c.weather_code);
  const iconEl = document.getElementById('weather-icon');
  iconEl.src   = `icons/${info.icon}.svg`;
  iconEl.alt   = info.label;

  document.getElementById('weather-temp').textContent   = fmtTemp(c.temperature_2m);
  document.getElementById('weather-unit').textContent   = tempUnit();
  document.getElementById('weather-feels-like').textContent =
    `Feels like ${fmtTemp(c.apparent_temperature)}${tempUnit()}`;
  document.getElementById('weather-condition').textContent = info.label;
  // Wind: rotating arrow SVG + direction label + speed
  const deg = c.wind_direction_10m;
  const arrowDeg = (deg + 180) % 360;  // meteorological → where wind is going
  document.getElementById('weather-wind').innerHTML =
    `<svg class="wind-arrow" viewBox="0 0 16 16" width="15" height="15"
        style="transform:rotate(${arrowDeg}deg);display:inline-block;vertical-align:middle;margin-right:3px;">
      <polygon points="8,1 11,13 8,10 5,13" fill="currentColor"/>
    </svg>${windDir(deg)} ${fmtSpeed(c.wind_speed_10m)}`;
  const rh = c.relative_humidity_2m;
  const rhColor = rh < 30 ? '#d4790a'   // dry — orange
                : rh <= 60 ? '#2c8a3a'  // comfortable — green
                : '#3b82d4';            // humid — blue
  document.getElementById('weather-humidity').innerHTML =
    `<span style="color:${rhColor};font-weight:600;">${rh}%</span> humidity`;

  // UV index — today's max, colour-coded by level
  const uv = daily.uv_index_max?.[0];
  const uvEl = document.getElementById('weather-uv');
  if (uv != null) {
    const uvColor = uv <= 2 ? '#2c8a3a'
                  : uv <= 5 ? '#d4790a'
                  : uv <= 7 ? '#c0392b'
                  : uv <= 10 ? '#7c3aed'
                  : '#7c3aed';
    uvEl.innerHTML =
      `<svg viewBox="0 0 13 13" width="12" height="12" style="display:inline-block;vertical-align:middle;margin-right:2px;" fill="${uvColor}">
        <circle cx="6.5" cy="6.5" r="3"/>
        <line x1="6.5" y1="0.5" x2="6.5" y2="2" stroke="${uvColor}" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="6.5" y1="11" x2="6.5" y2="12.5" stroke="${uvColor}" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="0.5" y1="6.5" x2="2" y2="6.5" stroke="${uvColor}" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="11" y1="6.5" x2="12.5" y2="6.5" stroke="${uvColor}" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="2.4" y1="2.4" x2="3.4" y2="3.4" stroke="${uvColor}" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="9.6" y1="9.6" x2="10.6" y2="10.6" stroke="${uvColor}" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="10.6" y1="2.4" x2="9.6" y2="3.4" stroke="${uvColor}" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="3.4" y1="9.6" x2="2.4" y2="10.6" stroke="${uvColor}" stroke-width="1.3" stroke-linecap="round"/>
      </svg><span style="color:${uvColor};font-weight:600;">UV ${Math.round(uv)}</span>`;
  } else {
    uvEl.innerHTML = '';
  }

  // Sunrise / sunset — bold arrow + sun icon
  const sunriseIcon = `<svg viewBox="0 0 22 14" width="22" height="14" style="display:inline-block;vertical-align:middle;margin-right:3px;">
    <!-- up arrow on the left -->
    <polygon points="3,9 5.5,3 8,9" fill="#2c8a3a"/>
    <line x1="5.5" y1="9" x2="5.5" y2="13" stroke="#2c8a3a" stroke-width="2" stroke-linecap="round"/>
    <!-- sun on the right -->
    <circle cx="16" cy="7" r="3" fill="#f5a623"/>
    <line x1="16" y1="1.5" x2="16" y2="2.8" stroke="#f5a623" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="16" y1="11.2" x2="16" y2="12.5" stroke="#f5a623" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="10.5" y1="7" x2="11.8" y2="7" stroke="#f5a623" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="20.2" y1="7" x2="21.5" y2="7" stroke="#f5a623" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="11.9" y1="3.4" x2="12.8" y2="4.3" stroke="#f5a623" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="19.2" y1="9.7" x2="20.1" y2="10.6" stroke="#f5a623" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="11.9" y1="10.6" x2="12.8" y2="9.7" stroke="#f5a623" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="19.2" y1="4.3" x2="20.1" y2="3.4" stroke="#f5a623" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;

  const sunsetIcon = `<svg viewBox="0 0 22 14" width="22" height="14" style="display:inline-block;vertical-align:middle;margin-right:3px;">
    <!-- down arrow on the left -->
    <polygon points="3,5 5.5,11 8,5" fill="#c0392b"/>
    <line x1="5.5" y1="1" x2="5.5" y2="5" stroke="#c0392b" stroke-width="2" stroke-linecap="round"/>
    <!-- sun on the right -->
    <circle cx="16" cy="7" r="3" fill="#d4790a"/>
    <line x1="16" y1="1.5" x2="16" y2="2.8" stroke="#d4790a" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="16" y1="11.2" x2="16" y2="12.5" stroke="#d4790a" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="10.5" y1="7" x2="11.8" y2="7" stroke="#d4790a" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="20.2" y1="7" x2="21.5" y2="7" stroke="#d4790a" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="11.9" y1="3.4" x2="12.8" y2="4.3" stroke="#d4790a" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="19.2" y1="9.7" x2="20.1" y2="10.6" stroke="#d4790a" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="11.9" y1="10.6" x2="12.8" y2="9.7" stroke="#d4790a" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="19.2" y1="4.3" x2="20.1" y2="3.4" stroke="#d4790a" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;

  document.getElementById('weather-sunrise').innerHTML = `${sunriseIcon}${fmtTime(daily.sunrise[0])}`;
  document.getElementById('weather-sunset').innerHTML  = `${sunsetIcon}${fmtTime(daily.sunset[0])}`;

  document.getElementById('weather-updated').textContent = '';
  document.getElementById('panel-current').classList.remove('stale');

  // Hourly precipitation probability — next 12 hours from now
  renderPrecipBar(data);
}

function renderPrecipBar(data) {
  const container = document.getElementById('precip-bar');
  if (!container || !data.hourly) return;

  const times = data.hourly.time;
  const probs  = data.hourly.precipitation_probability;
  if (!times || !probs) return;

  // Find the index of the current hour
  const nowIso = new Date().toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
  let startIdx = times.findIndex(t => t.slice(0, 13) >= nowIso);
  if (startIdx < 0) startIdx = 0;

  const hours = 12;
  const BAR_W = 12;
  const GAP   = 2;
  const H     = 22;   // bar area height
  const LABEL_H = 12; // space below bars for labels
  const svgW  = hours * (BAR_W + GAP) - GAP;

  let bars = '';
  let labels = '';
  for (let i = 0; i < hours; i++) {
    const idx  = startIdx + i;
    const prob = probs[idx] ?? 0;
    const barH = Math.max(2, Math.round((prob / 100) * H));
    const x    = i * (BAR_W + GAP);
    const y    = H - barH;

    // Colour: blue tint scales with probability
    const opacity = 0.25 + (prob / 100) * 0.75;
    bars += `<rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}"
      rx="2" fill="#3b82d4" fill-opacity="${opacity.toFixed(2)}"/>`;

    // Hour label every 3 hours
    if (i % 3 === 0 && times[idx]) {
      const hr = new Date(times[idx]).getHours();
      const label = AppConfig.timeFormat === '12h'
        ? `${hr % 12 || 12}${hr >= 12 ? 'p' : 'a'}`
        : String(hr).padStart(2, '0');
      labels += `<text x="${x + BAR_W / 2}" y="${H + LABEL_H - 2}" text-anchor="middle"
        font-size="8" fill="${AppConfig.theme === 'dark' ? '#a8d8f0' : '#6b7694'}">${label}</text>`;
    }
  }

  container.innerHTML =
    `<svg viewBox="0 0 ${svgW} ${H + LABEL_H}" width="${svgW}" height="${H + LABEL_H}"
        overflow="visible" style="display:block;">${bars}${labels}</svg>`;
}

function renderForecast(data) {
  const daily = data.daily;
  const container = document.getElementById('forecast-rows');
  container.innerHTML = '';

  // Start from index 1 (skip today) and show 5 days
  for (let i = 1; i <= 5; i++) {
    const date   = new Date(daily.time[i] + 'T12:00:00');
    const day    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()];
    const info   = wmoInfo(daily.weather_code[i]);
    const hi     = fmtTemp(daily.temperature_2m_max[i]);
    const lo     = fmtTemp(daily.temperature_2m_min[i]);
    const precip = daily.precipitation_probability_max[i] ?? 0;

    const row = document.createElement('div');
    row.className = 'fc-row';
    row.innerHTML = `
      <div class="fc-line1">
        <span class="fc-day">${day}</span>
        <img src="icons/${info.icon}.svg" alt="${info.label}" width="28" height="28">
      </div>
      <div class="fc-line2">
        <span class="fc-hi">${hi}°</span>
        <span class="fc-lo">${lo}°</span>
        <span class="fc-precip"><svg viewBox="0 0 10 13" width="9" height="11" style="display:inline-block;vertical-align:middle;margin-right:1px;" fill="#3b82d4"><path d="M5 1 C5 1 1 6 1 8.5 a4 4 0 0 0 8 0 C9 6 5 1 5 1 Z"/></svg>${precip}%</span>
      </div>
    `;
    container.appendChild(row);
  }
}

function markStale() {
  if (!_lastFetchTime) return;
  const ageMin = (Date.now() - _lastFetchTime) / 60000;
  if (ageMin > 15) {
    const h = new Date(_lastFetchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('weather-updated').textContent = `Last updated ${h}`;
    document.getElementById('panel-current').classList.add('stale');
  }
}

// ---- Public API ---------------------------------------------------------

async function refreshWeather() {
  const loadingEl = document.getElementById('weather-loading');
  loadingEl.classList.add('active');

  try {
    const [data, locationName] = await Promise.all([
      fetchWeather(),
      fetchLocationName(AppConfig.latitude, AppConfig.longitude),
    ]);
    _lastFetchTime   = Date.now();
    _lastWeatherData = data;
    renderCurrent(data, locationName);
    renderForecast(data);
  } catch (_) {
    // Network failure — show stale indicator if we have old data
    if (_lastWeatherData) {
      renderCurrent(_lastWeatherData, _cachedLocation || '--');
      renderForecast(_lastWeatherData);
      markStale();
    }
  } finally {
    loadingEl.classList.remove('active');
  }
}

function initWeather() {
  // Unit toggle click
  document.getElementById('weather-unit').addEventListener('click', () => {
    toggleUnits();
    if (_lastWeatherData) {
      renderCurrent(_lastWeatherData, _cachedLocation || '--');
      renderForecast(_lastWeatherData);
    }
  });

  // Map double-click / home button → fetch weather for the new coordinates
  document.addEventListener('locationPinned', (e) => {
    const { lat, lon } = e.detail;
    AppConfig.latitude  = lat;
    AppConfig.longitude = lon;
    _cachedLocation     = null;   // clear cache so reverse-geocode runs again
    refreshWeather();
  });

  refreshWeather();
  setInterval(refreshWeather, AppConfig.refreshIntervalSeconds * 1000);
  // Check for stale data every minute
  setInterval(markStale, 60000);
}
