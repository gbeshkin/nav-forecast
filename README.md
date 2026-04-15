# Tallinn Bay Nav Forecast v4

Версия 4 добавляет:
- блок навигационных предупреждений через serverless proxy (`/api/warnings`)
- локальную историю snapshot-ов за последние 72 часа в `localStorage`
- отдельный history chart
- больше почасовых опорных точек
- более готовую структуру для деплоя на Vercel

## Что важно

В этой версии есть **два режима деплоя**:

### 1) Полный режим — рекомендован
Разворачивай на **Vercel**.

Плюсы:
- фронт остаётся статическим
- `/api/warnings` работает как serverless proxy
- warnings можно показывать прямо на сайте
- позже легко добавить cron, историю на сервере и Telegram-алерты

### 2) Упрощённый режим
Разворачивай на **Cloudflare Pages** или **GitHub Pages**.

Что будет:
- marine forecast, карта, маршруты, hourly, история в браузере
- warnings-блок покажет fallback и ссылку на официальный сервис

## Запуск локально

```bash
cd nav-forecast-site-v4
python3 -m http.server 8080
```

Открыть:

```bash
http://localhost:8080
```

Важно: при локальном запуске через обычный static server `/api/warnings` не заработает.
Это нормально. Для него нужен Vercel.

## Как задеплоить на Vercel

1. Создай новый GitHub repo
2. Загрузи содержимое папки `nav-forecast-site-v4`
3. Подключи репозиторий в Vercel
4. Deploy

Никаких env vars для базовой версии не требуется.

## Что обновляется каждый час

- marine forecast из Open-Meteo Marine API
- wind forecast из Open-Meteo Forecast API
- warnings через `/api/warnings`, если сайт работает на Vercel

## Что хранится локально

В `localStorage` сохраняются snapshots по району:
- timestamp
- общий статус района
- max wave / max wind / max current
- Pirita current wave

Лимит — до 72 записей.

## Хороший следующий шаг для v5

- история не только в браузере, но и на сервере
- реальные geo-фильтры warnings по району Tallinn Bay
- Telegram / email alerts
- языки RU / ET / EN
- пользовательские пороги под конкретное судно
