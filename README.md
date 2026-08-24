# swagPlayer

A music streaming web app with a beautiful LRC lyrics player — the core feature. Upload tracks, sync lyrics line by line and watch them highlight in real time as the song plays.

Includes a Telegram bot for quick login and playlist access from your phone.

## Features

- **LRC lyrics player** — synchronized lyrics with real-time line highlighting
- **HTTP Range audio streaming** — partial requests (206) instead of serving whole files, so seek/duration work correctly in every browser and mobile WebView
- **Signed media URLs** — track links are HMAC-signed with an expiry and browser fingerprint, so files can't be hot-linked or guessed
- **Telegram Login Widget verification** — `initData` is validated server-side via HMAC (with replay protection); bot deep-link login uses short-lived one-time tokens
- **Rate limiting** — per-IP sliding-window limits on auth, playback and admin login endpoints
- **Hardened sessions** — HttpOnly / SameSite / Secure cookies, ProxyFix behind nginx
- MP3 upload and streaming
- Album and playlist management
- Cover art support
- Metadata editor (title, artist, album, year)
- Telegram bot with deep link login
- Admin panel
- PWA-ready

## Stack

![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-000000?style=flat&logo=flask&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)

## Setup

```bash
pip install -r requirements.txt
```

Set environment variables:
```
SECRET_KEY=change-me-in-production
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_TELEGRAM_IDS=123456789            # comma-separated IDs allowed into the app panel
ADMIN_PASSWORD=your_admin_password      # admin panel login
SSO_CLIENT_SECRET=your_sso_secret       # if using dreamID auth
```

```bash
python app.py
```

## Contact

Telegram: [@dreamcatch_r](https://t.me/dreamcatch_r)

---

# swagPlayer (RU)

Веб-приложение для стриминга музыки с красивым плеером LRC-текстов — ключевой особенностью проекта. Загружайте треки, синхронизируйте текст построчно и смотрите, как строки подсвечиваются в реальном времени во время воспроизведения.

Включает Telegram-бота для быстрого входа и доступа к плейлистам с телефона.

## Возможности

- **LRC-плеер** — синхронизированный текст песен с подсветкой строк в реальном времени
- **HTTP Range-стриминг аудио** — частичные запросы (206) вместо отдачи файлов целиком, поэтому перемотка и длительность корректно работают в любом браузере и мобильном WebView
- **Подписанные медиа-ссылки** — ссылки на треки подписаны HMAC с ограничением срока действия и отпечатком браузера, так что файлы нельзя угадать или использовать в обход
- **Проверка Telegram Login Widget** — `initData` валидируется на сервере через HMAC (с защитой от повторов); вход по deep-link бота использует короткоживущие одноразовые токены
- **Ограничение частоты запросов** — скользящие лимиты на IP для эндпоинтов авторизации, воспроизведения и входа в админку
- **Усиленные сессии** — cookie HttpOnly / SameSite / Secure, ProxyFix за nginx
- Загрузка и стриминг MP3
- Управление альбомами и плейлистами
- Поддержка обложек
- Редактор метаданных (название, исполнитель, альбом, год)
- Telegram-бот со входом по deep link
- Админ-панель
- Готовность к PWA

## Стек

![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-000000?style=flat&logo=flask&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)

## Установка

```bash
pip install -r requirements.txt
```

Задайте переменные окружения:
```
SECRET_KEY=change-me-in-production
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_TELEGRAM_IDS=123456789            # ID через запятую для доступа к панели
ADMIN_PASSWORD=your_admin_password      # пароль админ-панели
SSO_CLIENT_SECRET=your_sso_secret       # если используется авторизация dreamID
```

```bash
python app.py
```

## Контакты

Telegram: [@dreamcatch_r](https://t.me/dreamcatch_r)
