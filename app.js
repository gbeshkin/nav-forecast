const points = [
  { key: 'oldcity', name: 'Tallinn Old City Marina', lat: 59.4446, lon: 24.7546, note: 'Городская марина у пассажирского и туристического трафика.' },
  { key: 'pirita', name: 'Pirita Marina', lat: 59.4714, lon: 24.8350, note: 'Ключевая точка выхода для катеров и яхт.' },
  { key: 'aegna', name: 'Aegna South', lat: 59.5750, lon: 24.7590, note: 'Подход к Аэгна со стороны Таллиннского залива.' },
  { key: 'naissaar', name: 'Naissaar South', lat: 59.5440, lon: 24.5010, note: 'Южная часть Найссаара, чувствительная к ветру и волне.' },
  { key: 'rohuneeme', name: 'Rohuneeme', lat: 59.5650, lon: 24.8420, note: 'Северо-восточный край района, полезен для общей картины.' }
];

const routes = [
  { name: 'Pirita → Aegna', description: 'Типовой короткий выход из Пирита на Аэгну.', pointKeys: ['pirita', 'aegna'] },
  { name: 'Old City → Pirita', description: 'Городской участок вдоль берега с частым трафиком.', pointKeys: ['oldcity', 'pirita'] },
  { name: 'Pirita → Naissaar', description: 'Более открытый участок. К ветру и волне чувствителен сильнее.', pointKeys: ['pirita', 'naissaar', 'rohuneeme'] },
  { name: 'Old City → Aegna', description: 'Маршрут из центра в сторону острова через открытую воду.', pointKeys: ['oldcity', 'pirita', 'aegna'] }
];

const vesselProfiles = {
  rib: {
    label: 'RIB / малый катер',
    hint: 'Самый строгий профиль. Подходит для небольшого катера, прогулочного выхода и более консервативной оценки.',
    thresholds: { goodWave: 0.35, badWave: 0.75, goodWind: 6, badWind: 10, goodCurrent: 0.9, badCurrent: 1.8 }
  },
  motorboat: {
    label: 'Прогулочный катер',
    hint: 'Сбалансированный режим для обычного моторного судна в хорошей погоде.',
    thresholds: { goodWave: 0.5, badWave: 1.0, goodWind: 7.5, badWind: 12, goodCurrent: 1.2, badCurrent: 2.2 }
  },
  sailboat: {
    label: 'Парусная яхта',
    hint: 'Чуть мягче по волне, но при сильном ветре всё равно быстро уходит в caution / no-go.',
    thresholds: { goodWave: 0.65, badWave: 1.25, goodWind: 8.5, badWind: 14, goodCurrent: 1.2, badCurrent: 2.4 }
  }
};

const CURRENT_VARS = 'wave_height,sea_surface_temperature,ocean_current_velocity,ocean_current_direction';
const HOURLY_VARS = [
  'wave_height',
  'sea_surface_temperature',
  'ocean_current_velocity',
  'ocean_current_direction'
].join(',');
const WEATHER_HOURLY = ['wind_speed_10m', 'wind_direction_10m'].join(',');
const REFRESH_MS = 60 * 60 * 1000;
const HISTORY_KEY = 'tallinn-bay-nav-forecast-v4-history';
const HISTORY_LIMIT = 72;

let map;
let hourlyCanvas;
let historyCanvas;
let refreshTimer;
let allResults = [];
let selectedHourlyKey = 'pirita';
let selectedMode = 'rib';

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([59.525, 24.73], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  routes.forEach((route) => {
    const coords = route.pointKeys.map((key) => {
      const p = points.find((x) => x.key === key);
      return [p.lat, p.lon];
    });
    L.polyline(coords, { weight: 4, opacity: 0.85 }).addTo(map);
  });

  points.forEach((point) => {
    const marker = L.marker([point.lat, point.lon]).addTo(map);
    marker.bindPopup(`<strong>${point.name}</strong><br>${point.note}`);
  });
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

function getProfile() {
  return vesselProfiles[selectedMode];
}

function getRisk(values) {
  const { waveHeight = 0, currentVelocity = 0, windSpeed = 0 } = values;
  const t = getProfile().thresholds;
  if (waveHeight > t.badWave || currentVelocity > t.badCurrent || windSpeed > t.badWind) {
    return { key: 'bad', label: 'No-go / неблагоприятно' };
  }
  if (waveHeight > t.goodWave || currentVelocity > t.goodCurrent || windSpeed > t.goodWind) {
    return { key: 'warn', label: 'Caution / с осторожностью' };
  }
  return { key: 'good', label: 'Go / относительно спокойно' };
}

async function fetchMarinePoint(point) {
  const marineParams = new URLSearchParams({
    latitude: point.lat,
    longitude: point.lon,
    hourly: HOURLY_VARS,
    current: CURRENT_VARS,
    forecast_hours: '24',
    timezone: 'Europe/Tallinn',
    cell_selection: 'sea'
  });

  const weatherParams = new URLSearchParams({
    latitude: point.lat,
    longitude: point.lon,
    hourly: WEATHER_HOURLY,
    current: 'wind_speed_10m,wind_direction_10m',
    forecast_hours: '24',
    timezone: 'Europe/Tallinn'
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
  const currentSeries = hourly.ocean_current_velocity || [];
  const windSeries = hourlyWeather.wind_speed_10m || [];

  return {
    point,
    currentWave: current.wave_height,
    maxWave24h: waveSeries.length ? Math.max(...waveSeries.filter((v) => typeof v === 'number')) : null,
    seaTemp: current.sea_surface_temperature,
    currentVelocity: current.ocean_current_velocity,
    currentDirection: current.ocean_current_direction,
    windSpeed: currentWeather.wind_speed_10m,
    windDirection: currentWeather.wind_direction_10m,
    maxWind24h: windSeries.length ? Math.max(...windSeries.filter((v) => typeof v === 'number')) : null,
    maxCurrent24h: currentSeries.length ? Math.max(...currentSeries.filter((v) => typeof v === 'number')) : null,
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
      wind_direction_10m: hourlyWeather.wind_direction_10m || []
    }
  };
}

function renderPointCard(result) {
  const tpl = document.getElementById('cardTemplate');
  const node = tpl.content.cloneNode(true);
  const risk = getRisk({ waveHeight: result.currentWave, currentVelocity: result.currentVelocity, windSpeed: result.windSpeed });

  node.querySelector('.point-name').textContent = result.point.name;
  node.querySelector('.point-coords').textContent = `${result.point.lat.toFixed(3)}, ${result.point.lon.toFixed(3)}`;
  node.querySelector('.point-note').textContent = result.point.note;
  const badge = node.querySelector('.point-badge');
  badge.textContent = risk.label;
  badge.classList.add(risk.key);

  node.querySelector('.wave-now').textContent = formatNumber(result.currentWave, 'м');
  node.querySelector('.wave-max').textContent = formatNumber(result.maxWave24h, 'м');
  node.querySelector('.sea-temp').textContent = formatNumber(result.seaTemp, '°C');
  node.querySelector('.current-speed').textContent = formatNumber(result.currentVelocity, 'км/ч');
  node.querySelector('.current-direction').textContent = `Направление течения: ${directionToText(result.currentDirection)}`;
  node.querySelector('.wind-line').textContent = `Ветер: ${formatNumber(result.windSpeed, 'км/ч')} • ${directionToText(result.windDirection)}`;

  return node;
}

function renderSummary(results) {
  const routeStatus = document.getElementById('routeStatus');
  const routeMetrics = document.getElementById('routeMetrics');
  const routeSummary = document.getElementById('routeSummary');
  const updatedAt = document.getElementById('updatedAt');

  const maxWave = Math.max(...results.map((r) => r.maxWave24h ?? 0));
  const maxCurrent = Math.max(...results.map((r) => r.maxCurrent24h ?? 0));
  const maxWind = Math.max(...results.map((r) => r.maxWind24h ?? 0));
  const avgTemp = results.reduce((acc, r) => acc + (r.seaTemp ?? 0), 0) / Math.max(results.length, 1);
  const risk = getRisk({ waveHeight: maxWave, currentVelocity: maxCurrent, windSpeed: maxWind });

  routeStatus.className = `route-status ${risk.key}`;
  routeStatus.textContent = risk.label;
  routeSummary.textContent = `${getProfile().label}: сводная оценка по району на основе максимальной волны, ветра и течения за 24 часа.`;

  routeMetrics.innerHTML = `
    <div><span>Макс. волна 24ч</span><strong>${formatNumber(maxWave, 'м')}</strong></div>
    <div><span>Макс. ветер 24ч</span><strong>${formatNumber(maxWind, 'км/ч')}</strong></div>
    <div><span>Макс. течение 24ч</span><strong>${formatNumber(maxCurrent, 'км/ч')}</strong></div>
    <div><span>Средняя темп. воды</span><strong>${formatNumber(avgTemp, '°C')}</strong></div>
  `;

  const times = results.map((r) => r.currentTime).filter(Boolean).sort();
  updatedAt.textContent = times.length ? `Обновлено: ${times.at(-1).replace('T', ' ')}` : 'Обновлено';
}

function renderQuickCard(targetId, result) {
  const state = document.getElementById(targetId);
  const metrics = document.getElementById(`${targetId}Metrics`);
  const risk = getRisk({ waveHeight: result.currentWave, currentVelocity: result.currentVelocity, windSpeed: result.windSpeed });
  state.className = `quick-state ${risk.key}`;
  state.textContent = risk.label;
  metrics.innerHTML = `
    <div><span>Волна</span><strong>${formatNumber(result.currentWave, 'м')}</strong></div>
    <div><span>Ветер</span><strong>${formatNumber(result.windSpeed, 'км/ч')}</strong></div>
    <div><span>Течение</span><strong>${formatNumber(result.currentVelocity, 'км/ч')}</strong></div>
  `;
}

function getQuietHours(related) {
  const t = getProfile().thresholds;
  const perHour = [];
  for (let i = 0; i < 24; i += 1) {
    const ok = related.every((r) => {
      const wv = r.marineHourly.wave_height?.[i];
      const wd = r.weatherHourly.wind_speed_10m?.[i];
      const cv = r.marineHourly.ocean_current_velocity?.[i];
      return (wv ?? 999) <= t.goodWave && (wd ?? 999) <= t.goodWind && (cv ?? 999) <= t.goodCurrent;
    });
    perHour.push(ok);
  }
  return perHour.filter(Boolean).length;
}

function renderRoutes(resultsMap) {
  const container = document.getElementById('routeCards');
  container.innerHTML = '';
  const tpl = document.getElementById('routeTemplate');

  routes.forEach((route) => {
    const related = route.pointKeys.map((key) => resultsMap.get(key)).filter(Boolean);
    const maxWave = Math.max(...related.map((r) => r.maxWave24h ?? 0));
    const maxCurrent = Math.max(...related.map((r) => r.maxCurrent24h ?? 0));
    const maxWind = Math.max(...related.map((r) => r.maxWind24h ?? 0));
    const quietHours = getQuietHours(related);
    const risk = getRisk({ waveHeight: maxWave, currentVelocity: maxCurrent, windSpeed: maxWind });

    const node = tpl.content.cloneNode(true);
    node.querySelector('.route-name').textContent = route.name;
    node.querySelector('.route-description').textContent = route.description;
    node.querySelector('.route-wave').textContent = formatNumber(maxWave, 'м');
    node.querySelector('.route-wind').textContent = formatNumber(maxWind, 'км/ч');
    node.querySelector('.route-current').textContent = formatNumber(maxCurrent, 'км/ч');
    node.querySelector('.route-window').textContent = `${quietHours} из 24 ч`;
    const badge = node.querySelector('.route-badge');
    badge.textContent = risk.label;
    badge.classList.add(risk.key);
    container.appendChild(node);
  });
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
  labels.forEach((label, index) => {
    if (index % 3 === 0) ctx.fillText(label, x(index) - 12, cssHeight - 8);
  });

  lines.forEach((line) => {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    line.values.forEach((value, index) => {
      const px = x(index);
      const py = y(value);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
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
    { color: '#6fb1ff', text: 'Синий — волна (м)' },
    { color: '#ffbf5a', text: 'Жёлтый — ветер / 10' }
  ]);
}

function renderHourlyTable(result) {
  const container = document.getElementById('hourlyTable');
  const waves = (result.marineHourly.wave_height || []).slice(0, 6);
  const temps = (result.marineHourly.sea_surface_temperature || []).slice(0, 6);
  const winds = (result.weatherHourly.wind_speed_10m || []).slice(0, 6);
  const currents = (result.marineHourly.ocean_current_velocity || []).slice(0, 6);
  const times = (result.marineHourly.time || []).slice(0, 6);

  container.innerHTML = times.map((time, i) => `
    <div class="hourly-cell">
      <div class="time">${time.replace('T', ' ').slice(5, 16)}</div>
      <strong>${formatNumber(waves[i], 'м')}</strong><span>Волна</span>
      <strong>${formatNumber(winds[i], 'км/ч')}</strong><span>Ветер</span>
      <strong>${formatNumber(currents[i], 'км/ч')}</strong><span>Течение</span>
      <strong>${formatNumber(temps[i], '°C')}</strong><span>Вода</span>
    </div>
  `).join('');
}

function renderHourlyByKey(key) {
  const result = allResults.find((r) => r.point.key === key);
  if (!result) return;
  selectedHourlyKey = key;
  drawHourlyChart(result);
  renderHourlyTable(result);
  document.getElementById('hourlyPointLabel').textContent = `Опорная точка: ${result.point.name}`;
  document.querySelectorAll('.hourly-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.key === key));
}

function updateRefreshNote() {
  const note = document.getElementById('refreshNote');
  const next = new Date(Date.now() + REFRESH_MS);
  note.textContent = `Следующее автообновление около ${next.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistoryEntry(entry) {
  const history = readHistory();
  const filtered = history.filter((item) => item.timestamp !== entry.timestamp);
  filtered.push(entry);
  filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const trimmed = filtered.slice(-HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  return trimmed;
}

function makeHistoryEntry(results) {
  const maxWave = Math.max(...results.map((r) => r.maxWave24h ?? 0));
  const maxWind = Math.max(...results.map((r) => r.maxWind24h ?? 0));
  const maxCurrent = Math.max(...results.map((r) => r.maxCurrent24h ?? 0));
  const risk = getRisk({ waveHeight: maxWave, currentVelocity: maxCurrent, windSpeed: maxWind });
  const pirita = results.find((r) => r.point.key === 'pirita');
  return {
    timestamp: new Date().toISOString(),
    mode: selectedMode,
    regionRisk: risk.key,
    regionLabel: risk.label,
    maxWave,
    maxWind,
    maxCurrent,
    piritaWave: pirita?.currentWave ?? null,
    piritaWind: pirita?.windSpeed ?? null
  };
}

function riskClass(key) {
  return key === 'good' ? 'inline-good' : key === 'warn' ? 'inline-warn' : 'inline-bad';
}

function renderHistory() {
  const history = readHistory().slice(-12).reverse();
  const historyTable = document.getElementById('historyTable');
  const historyMeta = document.getElementById('historyMeta');
  if (!history.length) {
    historyTable.className = 'history-table empty-state';
    historyTable.textContent = 'История ещё не накоплена.';
    historyMeta.textContent = 'Пока истории нет — появится после нескольких обновлений.';
    drawHistoryChart([]);
    return;
  }

  historyTable.className = 'history-table';
  historyTable.innerHTML = history.map((item) => `
    <div class="history-row">
      <div>
        <div class="time">${item.timestamp.replace('T', ' ').slice(0, 16)}</div>
        <strong class="${riskClass(item.regionRisk)}">${item.regionLabel}</strong>
      </div>
      <div><span>Волна</span><strong>${formatNumber(item.maxWave, 'м')}</strong></div>
      <div><span>Ветер</span><strong>${formatNumber(item.maxWind, 'км/ч')}</strong></div>
      <div><span>Pirita</span><strong>${formatNumber(item.piritaWave, 'м')}</strong></div>
    </div>
  `).join('');
  historyMeta.textContent = `Сохранено ${readHistory().length} snapshot(ов) за последние до 72 часов в этом браузере.`;
  drawHistoryChart(readHistory());
}

function drawHistoryChart(history) {
  historyCanvas = historyCanvas || document.getElementById('historyChart');
  if (!history.length) {
    const { ctx, cssWidth, cssHeight } = setupCanvas(historyCanvas, 220);
    ctx.fillStyle = '#9fb2d7';
    ctx.font = '14px sans-serif';
    ctx.fillText('История появится после первого snapshot.', 16, cssHeight / 2);
    return;
  }
  const trimmed = history.slice(-24);
  const labels = trimmed.map((item) => item.timestamp.slice(11, 16));
  drawLineChart(historyCanvas, [
    { color: '#6fb1ff', values: trimmed.map((item) => item.maxWave ?? 0) },
    { color: '#a68cff', values: trimmed.map((item) => (item.maxWind ?? 0) / 10) }
  ], labels, [
    { color: '#6fb1ff', text: 'Синий — max wave' },
    { color: '#a68cff', text: 'Фиолетовый — max wind / 10' }
  ]);
}

function renderWarnings(items, meta = {}) {
  const summary = document.getElementById('warningsSummary');
  const list = document.getElementById('warningsList');
  if (!items.length) {
    summary.textContent = meta.message || 'Предупреждения не найдены. Всё равно проверь официальный сервис перед выходом.';
    list.className = 'warning-list';
    list.innerHTML = `
      <div class="warning-item warning-fallback">
        <h4>Нет активных карточек warnings</h4>
        <p>Открой официальный сервис Transpordiamet и проверь Notices to Mariners перед выходом.</p>
      </div>
    `;
    return;
  }

  const activeCount = items.filter((item) => !item.ended).length;
  summary.textContent = `${meta.source || 'Warnings proxy'}: ${items.length} карточек, активных сейчас — ${activeCount}.`;
  list.className = 'warning-list';
  list.innerHTML = items.map((item) => `
    <div class="warning-item ${item.ended ? '' : 'warning-active'}">
      <h4>${item.title}</h4>
      <div class="warning-meta">${[item.period, item.area].filter(Boolean).join(' • ') || 'Без уточнения периода'}</div>
      <p>${item.text || 'Смотри официальный источник для полной формулировки.'}</p>
    </div>
  `).join('');
}

async function loadWarnings() {
  const list = document.getElementById('warningsList');
  list.className = 'warning-list loading';
  list.textContent = 'Загрузка…';
  try {
    const response = await fetch('/api/warnings');
    if (!response.ok) throw new Error(`Proxy status ${response.status}`);
    const payload = await response.json();
    renderWarnings(payload.items || [], payload.meta || {});
  } catch (error) {
    console.warn('Warnings proxy unavailable', error);
    renderWarnings([], {
      message: 'Serverless-proxy недоступен. На статическом хостинге без backend используй только официальную страницу warnings.'
    });
  }
}

function renderAll(results) {
  allResults = results;
  const cards = document.getElementById('cards');
  cards.innerHTML = '';
  const resultsMap = new Map(results.map((r) => [r.point.key, r]));
  results.forEach((result) => cards.appendChild(renderPointCard(result)));
  renderSummary(results);
  renderRoutes(resultsMap);
  renderQuickCard('piritaQuick', resultsMap.get('pirita'));
  renderQuickCard('oldcityQuick', resultsMap.get('oldcity'));
  renderHourlyByKey(selectedHourlyKey);
  updateRefreshNote();
  saveHistoryEntry(makeHistoryEntry(results));
  renderHistory();
}

async function loadAll() {
  const routeStatus = document.getElementById('routeStatus');
  const routeMetrics = document.getElementById('routeMetrics');
  routeStatus.className = 'route-status loading';
  routeStatus.textContent = 'Собираем прогноз…';
  routeMetrics.innerHTML = '';
  document.getElementById('piritaQuick').className = 'quick-state loading';
  document.getElementById('piritaQuick').textContent = 'Загрузка…';
  document.getElementById('oldcityQuick').className = 'quick-state loading';
  document.getElementById('oldcityQuick').textContent = 'Загрузка…';
  try {
    const results = await Promise.all(points.map(fetchMarinePoint));
    renderAll(results);
  } catch (error) {
    console.error(error);
    routeStatus.className = 'route-status bad';
    routeStatus.textContent = 'Не удалось загрузить marine forecast';
    routeMetrics.innerHTML = `<div><span>Причина</span><strong>Проверь доступность API / сеть / CORS</strong></div>`;
  }
}

function setupAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    loadAll();
    loadWarnings();
  }, REFRESH_MS);
}

function bindUi() {
  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadAll();
    loadWarnings();
  });
  document.querySelectorAll('.hourly-btn').forEach((btn) => {
    btn.addEventListener('click', () => renderHourlyByKey(btn.dataset.key));
  });
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedMode = btn.dataset.mode;
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('vesselHint').textContent = vesselProfiles[selectedMode].hint;
      if (allResults.length) renderAll(allResults);
    });
  });
  window.addEventListener('resize', () => {
    if (allResults.length) renderHourlyByKey(selectedHourlyKey);
    renderHistory();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindUi();
  document.getElementById('vesselHint').textContent = vesselProfiles[selectedMode].hint;
  renderHistory();
  loadAll();
  loadWarnings();
  setupAutoRefresh();
});
