# Twitch Media Archive

Архиватор картинок и коротких видео из Twitch-чата: Node.js worker читает чат, скачивает разрешенные media URL, дедуплицирует по URL и SHA-256, кладет файлы в SpaceWeb S3 и показывает публичную ленту на React.

## Быстрый старт

```bash
pnpm install
cp .env.example .env
node scripts/hash-admin-password.js "your-password"
pnpm db:generate
docker compose up -d postgres
pnpm db:dev
pnpm dev:api
pnpm dev:worker
pnpm dev
```

Frontend: `http://127.0.0.1:3000`  
API health: `http://127.0.0.1:3000/api/health`

## Локальный запуск с реальным Twitch-чатом

Этот режим использует реальные Twitch API/IRC и локальный MinIO вместо SpaceWeb S3.

1. Создай Twitch app в Developer Console и заполни:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`

2. Получи user access token для bot-аккаунта со scope `chat:read`.
   В `.env` для IRC он должен быть в формате `oauth:<token>`.

3. Для EventSub WebSocket можно использовать user access token без префикса `oauth:`:
   - `TWITCH_EVENTSUB_USER_TOKEN="<token>"`

4. Подготовь env:

```bash
cp .env.twitch-local.example .env
node scripts/hash-admin-password.js "admin-password"
```

Вставь hash в `ADMIN_PASSWORD_HASH`, затем заполни Twitch-поля и `TWITCH_CHANNELS`.

5. Подними локальное хранилище и приложение:

```bash
pnpm install
pnpm db:generate
docker compose up -d postgres minio
docker compose run --rm api pnpm db:migrate
pnpm s3:local
docker compose up -d --build api worker web
```

6. Открой:

- App: `http://127.0.0.1:3000`
- Admin: `http://127.0.0.1:3000/#admin`
- API: `http://127.0.0.1:3000/api/health`
- MinIO: `http://127.0.0.1:9001`

7. Смотри worker logs:

```bash
docker compose logs -f worker
```

Проверить данные:

```bash
docker compose exec postgres psql -U archive -d archive -c "select status, visibility, \"publicUrl\" from assets;"
```

Важно: streamer должен быть live или в чате должны появляться сообщения со ссылками на поддерживаемые media URL. Реальные Discord/IBB/direct media ссылки будут скачиваться worker’ом, хешироваться, заливаться в MinIO и появляться во фронте.

## Продакшен

На VPS хранится `.env`, GitHub Actions по SSH делает:

```bash
git pull --ff-only
docker compose build
docker compose run --rm api pnpm db:migrate
docker compose up -d
```

Медиа раздается напрямую из публичного SpaceWeb S3, не через VPS.

## Модерация

Админка доступна по `/#admin`. Действие `Delete permanently` удаляет объект из S3, ставит `assets.status = deleted`, очищает `publicUrl` и добавляет `normalizedUrl`/`sha256` в `blocked_media`, чтобы тот же контент не загрузился повторно.
