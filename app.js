const GPX_FAIRWAYS = {
  "Koplilah": {
    "name": "Koplilah Fairway",
    "region": "Tallinn Bay",
    "points": [
      {
        "lat": 59.499833,
        "lon": 24.543,
        "label": "1"
      },
      {
        "lat": 59.4475,
        "lon": 24.6535,
        "label": "2"
      }
    ],
    "note": "Official GPX fairway aligned with the Tallinn Bay area."
  },
  "Muuga": {
    "name": "Muuga Fairway",
    "region": "Tallinn Bay East",
    "points": [
      {
        "lat": 59.6875,
        "lon": 25.085666667,
        "label": "1"
      },
      {
        "lat": 59.5615,
        "lon": 25.046,
        "label": "2"
      },
      {
        "lat": 59.502666667,
        "lon": 24.955833333,
        "label": "3"
      }
    ],
    "note": "Official GPX fairway useful for the eastern approach / traffic context."
  },
  "Prangli": {
    "name": "Prangli Fairway",
    "region": "Tallinn Bay North-East",
    "points": [
      {
        "lat": 59.589666667,
        "lon": 24.912333333,
        "label": "1"
      },
      {
        "lat": 59.5485,
        "lon": 25.026166667,
        "label": "2"
      }
    ],
    "note": "Official GPX fairway relevant for the north-eastern corridor."
  }
};

const points = [
  { key: 'oldcity', name: 'Old City Harbour Exit', lat: 59.4446, lon: 24.7546, note: 'Urban harbour exit with partial coastal shelter.' },
  { key: 'pirita', name: 'Pirita Marina Exit', lat: 59.4714, lon: 24.8350, note: 'Primary recreational departure point.' },
  { key: 'aegna', name: 'Aegna South Approach', lat: 59.5750, lon: 24.7590, note: 'Southern approach sector toward Aegna.' },
  { key: 'naissaar', name: 'Naissaar South Approach', lat: 59.5440, lon: 24.5010, note: 'More exposed approach sector toward Naissaar.' }
];

const vesselProfiles = {
  rib: { label: 'RIB / small boat', hint: 'Raised thresholds versus earlier versions, but still the strictest profile.', thresholds: { goodWave: 0.45, badWave: 0.85, goodWind: 7.5, badWind: 12, goodGust: 11, badGust: 17, goodCurrent: 1.0, badCurrent: 2.0 } },
  motorboat: { label: 'Motorboat', hint: 'Moderately raised departure thresholds for a typical leisure motorboat.', thresholds: { goodWave: 0.65, badWave: 1.15, goodWind: 9, badWind: 14, goodGust: 13, badGust: 19, goodCurrent: 1.3, badCurrent: 2.4 } },
  sailboat: { label: 'Sailboat', hint: 'More tolerant to waves, but gusts still matter strongly.', thresholds: { goodWave: 0.8, badWave: 1.4, goodWind: 10, badWind: 16, goodGust: 15, badGust: 22, goodCurrent: 1.4, badCurrent: 2.6 } }
};

const CURRENT_VARS = 'wave_height,sea_surface_temperature,ocean_current_velocity,ocean_current_direction';
const HOURLY_VARS = ['wave_height','sea_surface_temperature','ocean_current_velocity','ocean_current_direction'].join(',');
const WEATHER_HOURLY = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'].join(',');
const REFRESH_MS = 60 * 60 * 1000;

let map;
let hourlyCanvas;
let refreshTimer;
let allResults = [];
let selectedHourlyKey = 'pirita';
let selectedMode = 'rib';
let fairwayLayerGroup;
let forecastLayerGroup;

function nmDistance(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const R = 6371000;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2-lat1), Δλ = toRad(lon2-lon1);
  const a = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return (R * c) / 1852;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2), λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2-λ1) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([59.53, 24.77], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: 'Sea marks © OpenSeaMap'
  }).addTo(map);

  fairwayLayerGroup = L.layerGroup().addTo(map);
  forecastLayerGroup = L.layerGroup().addTo(map);

  points.forEach((point) => {
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: 7,
      weight: 2,
      color: '#6fb1ff',
      fillColor: '#07101c',
      fillOpacity: 1
    }).addTo(forecastLayerGroup);
    marker.bindPopup(`<strong>${point.name}</strong><br>${point.note}`);
  });

  renderFairwaysOnMap();
}

function renderFairwaysOnMap() {
  fairwayLayerGroup.clearLayers();
  const bounds = [];
  Object.values(GPX_FAIRWAYS).forEach((route) => {
    const latlngs = route.points.map((p) => [p.lat, p.lon]);
    const poly = L.polyline(latlngs, {
      color: '#27c37f',
      weight: 4,
      opacity: 0.95
    }).addTo(fairwayLayerGroup);
    poly.bindPopup(`<strong>${route.name}</strong><br>${route.region}`);
    bounds.push(poly.getBounds());

    route.points.forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius: 5,
        weight: 2,
        color: '#27c37f',
        fillColor: '#07101c',
        fillOpacity: 1
      }).addTo(fairwayLayerGroup).bindPopup(`${route.name} • WP ${p.label}`);
    });
  });

  if (bounds.length) {
    const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0]);
    map.fitBounds(combined.pad(0.15));
  }
}

function getProfile() { return vesselProfiles[selectedMode]; }

function getRisk(values) {
  const { waveHeight = 0, currentVelocity = 0, windSpeed = 0, windGust = 0 } = values;
  const t = getProfile().thresholds;
  if (waveHeight > t.badWave || currentVelocity > t.badCurrent || windSpeed > t.badWind || windGust > t.badGust) return { key: 'bad', label: 'No-go' };
  if (waveHeight > t.goodWave || currentVelocity > t.goodCurrent || windSpeed > t.goodWind || windGust > t.goodGust) return { key: 'warn', label: 'Caution' };
  return { key: 'good', label: 'Go' };
}

function formatNumber(value, unit, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(digits)} ${unit}`;
}

function directionToText(deg) {
  if (deg === null || deg === undefined || Number.isNaN(deg)) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return `${dirs[Math.round(deg / 45) % 8]} (${Math.round(deg)}°)`;
}

async function fetchMarinePoint(point) {
  const marineParams = new URLSearchParams({
    latitude: point.lat, longitude: point.lon, hourly: HOURLY_VARS, current: CURRENT_VARS,
    forecast_hours: '24', timezone: 'Europe/Tallinn', cell_selection: 'sea'
  });
  const weatherParams = new URLSearchParams({
    latitude: point.lat, longitude: point.lon, hourly: WEATHER_HOURLY,
    current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    forecast_hours: '24', timezone: 'Europe/Tallinn'
  });

  const [marineResponse, weatherResponse] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?${marineParams.toString()}`),
    fetch(`https://api.open-meteo.com/v1/forecast?${weatherParams.toString()}`)
  ]);

  if (!marineResponse.ok) throw new Error(`Marine API error for ${point.name}: ${marineResponse.status}`);
  if (!weatherResponse.ok) throw new Error(`Weather API error for ${point.name}: ${weatherResponse.status}`);

  const marine = await marineResponse.json();
  const weather = await weatherResponse.json();
  const hourly = marine.hourly || {};
  const hourlyWeather = weather.hourly || {};
  const current = marine.current || {};
  const currentWeather = weather.current || {};
  const waveSeries = hourly.wave_height || [];

  return {
    point,
    currentWave: current.wave_height,
    maxWave24h: waveSeries.length ? Math.max(...waveSeries.filter((v) => typeof v === 'number')) : null,
    seaTemp: current.sea_surface_temperature,
    currentVelocity: current.ocean_current_velocity,
    currentDirection: current.ocean_current_direction,
    windSpeed: currentWeather.wind_speed_10m,
    windDirection: currentWeather.wind_direction_10m,
    windGust: currentWeather.wind_gusts_10m,
    currentTime: current.time || currentWeather.time || null,
    marineHourly: {
      time: hourly.time || [],
      wave_height: hourly.wave_height || [],
      sea_surface_temperature: hourly.sea_surface_temperature || [],
      ocean_current_velocity: hourly.ocean_current_velocity || []
    },
    weatherHourly: {
      time: hourlyWeather.time || [],
      wind_speed_10m: hourlyWeather.wind_speed_10m || [],
      wind_direction_10m: hourlyWeather.wind_direction_10m || [],
      wind_gusts_10m: hourlyWeather.wind_gusts_10m || []
    }
  };
}

function renderPointCard(result) {
  const tpl = document.getElementById('cardTemplate');
  const node = tpl.content.cloneNode(true);
  const risk = getRisk({ waveHeight: result.currentWave, currentVelocity: result.currentVelocity, windSpeed: result.windSpeed, windGust: result.windGust });

  node.querySelector('.point-name').textContent = result.point.name;
  node.querySelector('.point-coords').textContent = `${result.point.lat.toFixed(3)}, ${result.point.lon.toFixed(3)}`;
  node.querySelector('.point-note').textContent = result.point.note;
  const badge = node.querySelector('.point-badge');
  badge.textContent = risk.label;
  badge.classList.add(risk.key);
  node.querySelector('.wave-now').textContent = formatNumber(result.currentWave, 'm');
  node.querySelector('.wave-max').textContent = formatNumber(result.maxWave24h, 'm');
  node.querySelector('.sea-temp').textContent = formatNumber(result.seaTemp, '°C');
  node.querySelector('.current-speed').textContent = formatNumber(result.currentVelocity, 'km/h');
  node.querySelector('.current-direction').textContent = `Current direction: ${directionToText(result.currentDirection)}`;
  node.querySelector('.wind-line').textContent = `Wind: ${formatNumber(result.windSpeed, 'km/h')} • Gust: ${formatNumber(result.windGust, 'km/h')} • ${directionToText(result.windDirection)}`;
  return node;
}

function renderFairwayCards() {
  const container = document.getElementById('fairwayCards');
  const tpl = document.getElementById('fairwayTemplate');
  container.innerHTML = '';
  Object.values(GPX_FAIRWAYS).forEach((route) => {
    const node = tpl.content.cloneNode(true);
    node.querySelector('.fairway-name').textContent = route.name;
    node.querySelector('.fairway-region').textContent = route.region;
    node.querySelector('.fairway-note').textContent = route.note;
    node.querySelector('.fairway-points').textContent = route.points.length;
    let total = 0;
    for (let i = 0; i < route.points.length - 1; i += 1) {
      const a = route.points[i], b = route.points[i+1];
      total += nmDistance(a.lat, a.lon, b.lat, b.lon);
    }
    node.querySelector('.fairway-distance').textContent = `${total.toFixed(2)} NM`;
    container.appendChild(node);
  });
}

function renderLegCards() {
  const container = document.getElementById('legCards');
  const tpl = document.getElementById('legTemplate');
  container.innerHTML = '';
  Object.values(GPX_FAIRWAYS).forEach((route) => {
    for (let i = 0; i < route.points.length - 1; i += 1) {
      const a = route.points[i], b = route.points[i+1];
      const node = tpl.content.cloneNode(true);
      node.querySelector('.leg-name').textContent = `WP ${a.label} → WP ${b.label}`;
      node.querySelector('.leg-route').textContent = route.name;
      node.querySelector('.leg-bearing').textContent = `${bearingDeg(a.lat, a.lon, b.lat, b.lon).toFixed(0)}°`;
      node.querySelector('.leg-distance').textContent = `${nmDistance(a.lat, a.lon, b.lat, b.lon).toFixed(2)} NM`;
      container.appendChild(node);
    }
  });
}

function renderSummary(results) {
  const routeStatus = document.getElementById('routeStatus');
  const routeMetrics = document.getElementById('routeMetrics');
  const routeSummary = document.getElementById('routeSummary');
  const updatedAt = document.getElementById('updatedAt');

  const maxWave = Math.max(...results.map((r) => r.maxWave24h ?? 0));
  const maxCurrent = Math.max(...results.map((r) => r.currentVelocity ?? 0));
  const maxWind = Math.max(...results.map((r) => r.windSpeed ?? 0));
  const maxGust = Math.max(...results.map((r) => r.windGust ?? 0));
  const avgTemp = results.reduce((acc, r) => acc + (r.seaTemp ?? 0), 0) / Math.max(results.length, 1);
  const risk = getRisk({ waveHeight: maxWave, currentVelocity: maxCurrent, windSpeed: maxWind, windGust: maxGust });

  routeStatus.className = `route-status ${risk.key}`;
  routeStatus.textContent = risk.label;
  routeSummary.textContent = `${getProfile().label}: local decision engine overlaid on real GPX fairways for the Tallinn Bay area.`;
  routeMetrics.innerHTML = `
    <div><span>Max wave 24h</span><strong>${formatNumber(maxWave, 'm')}</strong></div>
    <div><span>Max wind</span><strong>${formatNumber(maxWind, 'km/h')}</strong></div>
    <div><span>Max gust</span><strong>${formatNumber(maxGust, 'km/h')}</strong></div>
    <div><span>Avg water temp</span><strong>${formatNumber(avgTemp, '°C')}</strong></div>
  `;
  const times = results.map((r) => r.currentTime).filter(Boolean).sort();
  updatedAt.textContent = times.length ? `Updated: ${times.at(-1).replace('T', ' ')}` : 'Updated';
}

function renderQuickCard(targetId, result) {
  const state = document.getElementById(targetId);
  const metrics = document.getElementById(`${targetId}Metrics`);
  const risk = getRisk({ waveHeight: result.currentWave, currentVelocity: result.currentVelocity, windSpeed: result.windSpeed, windGust: result.windGust });
  state.className = `quick-state ${risk.key}`;
  state.textContent = risk.label;
  metrics.innerHTML = `
    <div><span>Wave</span><strong>${formatNumber(result.currentWave, 'm')}</strong></div>
    <div><span>Wind</span><strong>${formatNumber(result.windSpeed, 'km/h')}</strong></div>
    <div><span>Current</span><strong>${formatNumber(result.currentVelocity, 'km/h')}</strong></div>
  `;
}

function setupCanvas(canvas, targetHeight = 240) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
  canvas.width = cssWidth * dpr;
  canvas.height = targetHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, targetHeight);
  return { ctx, cssWidth, cssHeight: targetHeight };
}

function drawLineChart(canvas, lines, labels, legend) {
  const { ctx, cssWidth, cssHeight } = setupCanvas(canvas, 240);
  const margin = { top: 22, right: 18, bottom: 34, left: 38 };
  const width = cssWidth - margin.left - margin.right;
  const height = cssHeight - margin.top - margin.bottom;
  const values = lines.flatMap((line) => line.values.map((v) => v ?? 0));
  const maxValue = Math.max(1, ...values);
  const x = (index) => margin.left + (width * index) / Math.max(labels.length - 1, 1);
  const y = (value) => margin.top + height - ((value ?? 0) / maxValue) * height;

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const gy = margin.top + (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(margin.left, gy);
    ctx.lineTo(margin.left + width, gy);
    ctx.stroke();
  }

  ctx.fillStyle = '#9fb2d7';
  ctx.font = '12px sans-serif';
  labels.forEach((label, index) => { if (index % 3 === 0) ctx.fillText(label, x(index) - 12, cssHeight - 8); });

  lines.forEach((line) => {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    line.values.forEach((value, index) => {
      const px = x(index), py = y(value);
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });

  legend.forEach((item, index) => {
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, margin.left + index * 150, 14);
  });
}

function drawHourlyChart(result) {
  hourlyCanvas = hourlyCanvas || document.getElementById('hourlyChart');
  const waves = (result.marineHourly.wave_height || []).slice(0, 24);
  const winds = (result.weatherHourly.wind_speed_10m || []).slice(0, 24).map((w) => (w ?? 0) / 10);
  const labels = (result.marineHourly.time || []).slice(0, 24).map((t) => t.slice(11, 16));
  drawLineChart(hourlyCanvas, [
    { color: '#6fb1ff', values: waves },
    { color: '#ffbf5a', values: winds }
  ], labels, [
    { color: '#6fb1ff', text: 'Blue — wave (m)' },
    { color: '#ffbf5a', text: 'Yellow — wind / 10' }
  ]);
}

function renderHourlyTable(result) {
  const container = document.getElementById('hourlyTable');
  const waves = (result.marineHourly.wave_height || []).slice(0, 6);
  const temps = (result.marineHourly.sea_surface_temperature || []).slice(0, 6);
  const winds = (result.weatherHourly.wind_speed_10m || []).slice(0, 6);
  const gusts = (result.weatherHourly.wind_gusts_10m || []).slice(0, 6);
  const currents = (result.marineHourly.ocean_current_velocity || []).slice(0, 6);
  const times = (result.marineHourly.time || []).slice(0, 6);

  container.innerHTML = times.map((time, i) => `
    <div class="hourly-cell">
      <div class="time">${time.replace('T', ' ').slice(5, 16)}</div>
      <strong>${formatNumber(waves[i], 'm')}</strong><span>Wave</span>
      <strong>${formatNumber(winds[i], 'km/h')}</strong><span>Wind</span>
      <strong>${formatNumber(gusts[i], 'km/h')}</strong><span>Gust</span>
      <strong>${formatNumber(currents[i], 'km/h')}</strong><span>Current</span>
      <strong>${formatNumber(temps[i], '°C')}</strong><span>Water</span>
    </div>
  `).join('');
}

function renderHourlyByKey(key) {
  const result = allResults.find((r) => r.point.key === key);
  if (!result) return;
  selectedHourlyKey = key;
  drawHourlyChart(result);
  renderHourlyTable(result);
  document.getElementById('hourlyPointLabel').textContent = `Reference point: ${result.point.name}`;
  document.querySelectorAll('.hourly-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.key === key));
}

function updateRefreshNote() {
  const note = document.getElementById('refreshNote');
  const next = new Date(Date.now() + REFRESH_MS);
  note.textContent = `Next auto-refresh around ${next.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderAll(results) {
  allResults = results;
  const cards = document.getElementById('cards');
  cards.innerHTML = '';
  results.forEach((result) => cards.appendChild(renderPointCard(result)));
  renderSummary(results);
  const byKey = new Map(results.map((r) => [r.point.key, r]));
  renderQuickCard('piritaQuick', byKey.get('pirita'));
  renderQuickCard('oldcityQuick', byKey.get('oldcity'));
  renderHourlyByKey(selectedHourlyKey);
  updateRefreshNote();
}

async function loadAll() {
  const routeStatus = document.getElementById('routeStatus');
  const routeMetrics = document.getElementById('routeMetrics');
  routeStatus.className = 'route-status loading';
  routeStatus.textContent = 'Collecting forecast…';
  routeMetrics.innerHTML = '';
  document.getElementById('piritaQuick').className = 'quick-state loading';
  document.getElementById('piritaQuick').textContent = 'Loading…';
  document.getElementById('oldcityQuick').className = 'quick-state loading';
  document.getElementById('oldcityQuick').textContent = 'Loading…';
  try {
    const results = await Promise.all(points.map(fetchMarinePoint));
    renderAll(results);
  } catch (error) {
    console.error(error);
    routeStatus.className = 'route-status bad';
    routeStatus.textContent = 'Failed to load marine forecast';
    routeMetrics.innerHTML = `<div><span>Reason</span><strong>Check API availability / network / CORS</strong></div>`;
  }
}

function bindUi() {
  document.getElementById('refreshBtn').addEventListener('click', loadAll);
  document.querySelectorAll('.hourly-btn').forEach((btn) => btn.addEventListener('click', () => renderHourlyByKey(btn.dataset.key)));
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedMode = btn.dataset.mode;
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('vesselHint').textContent = vesselProfiles[selectedMode].hint;
      if (allResults.length) renderAll(allResults);
    });
  });
}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderFairwayCards();
  renderLegCards();
  bindUi();
  document.getElementById('vesselHint').textContent = vesselProfiles[selectedMode].hint;
  loadAll();
  refreshTimer = setInterval(loadAll, REFRESH_MS);
});
