# Twitch Telegram Archive

Telegram-only архиватор медиа из Twitch-чата.

Схема v1:

- `worker` читает Twitch chat, скачивает картинки/видео, дедуплицирует по URL/SHA-256 и сохраняет оригинальное сообщение в приватный Telegram storage-канал.
- `bot` запускает два Telegram-бота: админский для модерации и публичный для просмотра архива.
- `postgres` хранит стримеров, стримы, сообщения, assets, moderation/blocklist.

## Локальный запуск

```bash
pnpm install
cp .env.example .env
pnpm db:generate
docker compose up -d postgres
docker compose run --rm worker pnpm db:migrate
docker compose up --build worker bot
```

В `.env` нужны реальные Twitch и Telegram значения:

```env
DATABASE_URL="postgresql://archive:archive@postgres:5432/archive?schema=public"

TWITCH_CLIENT_ID=""
TWITCH_CLIENT_SECRET=""
TWITCH_EVENTSUB_USER_TOKEN=""
TWITCH_BOT_USERNAME=""
TWITCH_BOT_OAUTH="oauth:"
TWITCH_CHANNELS="streamer_login"

TELEGRAM_BOT_TOKEN=""
TELEGRAM_STORAGE_CHAT_ID="-100..."
TELEGRAM_ALLOWED_USER_IDS="123456789"
TELEGRAM_PUBLIC_BOT_TOKEN=""

MAX_IMAGE_BYTES="31457280"
MAX_VIDEO_BYTES="157286400"
MAX_DAILY_DOWNLOAD_BYTES="10737418240"
MAX_PARALLEL_DOWNLOADS="2"
ALLOW_PRIVATE_MEDIA_HOSTS="false"
```

Админского и публичного Telegram-ботов добавь в приватный storage-канал, чтобы оба могли делать `copyMessage`.

## VPS Deploy

GitHub Actions workflow: `.github/workflows/deploy.yml`.

На push в `main`/`master` он:

1. ставит зависимости;
2. генерирует Prisma client;
3. запускает typecheck/test/build;
4. билдит `worker` и `bot` Docker images;
5. пушит images в GitHub Container Registry;
6. заходит на VPS по SSH;
7. копирует `docker-compose.prod.yml`;
8. пишет `.env` из GitHub secret `PROD_ENV_B64`;
9. логинится в GHCR;
10. тянет свежие images;
11. применяет миграции;
12. поднимает `postgres`, `worker`, `bot`.

На VPS исходники не нужны. Нужны только Docker, папка приложения, `.env` и `docker-compose.prod.yml`, которые workflow подготовит сам.

Нужные GitHub Secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_APP_DIR`, опционально, по умолчанию `/srv/chat-meme-scraper`
- `PROD_ENV_B64`

Сгенерировать `PROD_ENV_B64`:

```bash
base64 -w 0 .env
```

На macOS:

```bash
base64 -i .env | tr -d '\n'
```
