# swagPlayer

A music streaming web app with a beautiful LRC lyrics player — the core feature. Upload tracks, sync lyrics line by line and watch them highlight in real time as the song plays.

Includes a Telegram bot for quick login and playlist access from your phone.

## Features

- **LRC lyrics player** — synchronized lyrics with real-time line highlighting
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
BOT_TOKEN=your_bot_token
SSO_CLIENT_SECRET=your_sso_secret  # if using dreamID auth
```

```bash
python app.py
```

## Contact

Telegram: [@dreamcatch_r](https://t.me/dreamcatch_r)
