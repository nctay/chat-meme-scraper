import tmi from "tmi.js";
import WebSocket from "ws";
import { extractUrls, isSupportedMediaUrl, normalizeUrl } from "@archive/core";
import { prisma } from "../prisma.js";
import { env } from "../env.js";

type TwitchStream = {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  started_at: string;
};

let appToken: { value: string; expiresAt: number } | null = null;
let chatClient: InstanceType<typeof tmi.Client> | null = null;
let chatConnecting = false;
let eventSubSocket: WebSocket | null = null;

export async function pollTwitchStreams(): Promise<void> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || channelLogins().length === 0) return;
  const token = await getAppToken();
  await syncConfiguredStreamers(token);
  const params = new URLSearchParams();
  for (const login of channelLogins()) params.append("user_login", login);
  const response = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
    headers: { "Client-ID": env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Twitch streams failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { data: TwitchStream[] };
  const liveLogins = new Set(body.data.map((stream) => stream.user_login.toLowerCase()));
  console.log(`[twitch] poll channels=${channelLogins().join(",")} live=${[...liveLogins].join(",") || "none"}`);

  for (const stream of body.data) {
    await upsertLiveStreamer(stream);
  }

  for (const login of channelLogins()) {
    if (!liveLogins.has(login)) {
      const streamerUpdate = await prisma.streamer.updateMany({
        where: { login },
        data: { lastStatus: "offline", lastCheckedAt: new Date() },
      });
      const sessionUpdate = await prisma.streamSession.updateMany({
        where: { streamer: { login }, status: "live" },
        data: { status: "ended", endedAt: new Date() },
      });
      console.log(`[twitch] offline login=${login} streamers=${streamerUpdate.count} sessions=${sessionUpdate.count}`);
    }
  }
}

export function ensureEventSubConnected(): void {
  if (eventSubSocket || !env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || channelLogins().length === 0) return;

  console.log("[eventsub] connecting websocket");
  eventSubSocket = new WebSocket("wss://eventsub.wss.twitch.tv/ws");
  eventSubSocket.on("message", (raw) => {
    void handleEventSubMessage(String(raw)).catch((error) => console.error("EventSub error", error));
  });
  eventSubSocket.on("close", () => {
    console.log("[eventsub] websocket closed");
    eventSubSocket = null;
    setTimeout(ensureEventSubConnected, 10_000);
  });
  eventSubSocket.on("error", (error) => {
    console.error("EventSub socket error", error);
    eventSubSocket?.close();
  });
}

export async function ensureChatConnected(): Promise<void> {
  const channels = channelLogins();
  if (chatClient || chatConnecting || channels.length === 0 || !env.TWITCH_BOT_USERNAME || !env.TWITCH_BOT_OAUTH) return;

  chatConnecting = true;
  console.log(`[chat] connecting channels=${channels.join(",")}`);
  chatClient = new tmi.Client({
    identity: { username: env.TWITCH_BOT_USERNAME, password: env.TWITCH_BOT_OAUTH },
    channels: [...channels],
    connection: { reconnect: true, secure: true },
  });

  chatClient.on("message", async (channel: string, tags: Record<string, string | undefined>, message: string, self: boolean) => {
    const login = channel.replace(/^#/, "").toLowerCase();
    const authorName = tags["display-name"] ?? tags.username ?? "unknown";
    const urls = extractUrls(message);
    const mediaUrls = urls.filter(isSupportedMediaUrl);
    if (urls.length > 0) {
      const preview = message.replace(/\s+/g, " ").slice(0, 200);
      console.log(`[chat] message channel=${login} author=${authorName} self=${self} urls=${urls.length} media=${mediaUrls.length} text=${JSON.stringify(preview)}`);
    }

    try {
      await ingestChatMessage({
        streamerLogin: login,
        twitchMessageId: tags.id,
        authorTwitchId: tags["user-id"],
        authorName,
        messageText: message,
        postedAt: new Date(),
      });
    } catch (error) {
      console.error("Failed to ingest chat message", error);
    }
  });
  const chatEvents = chatClient as unknown as {
    on(event: "disconnected", handler: (reason: string) => void): void;
    on(event: "reconnect", handler: () => void): void;
    on(event: "notice", handler: (channel: string, msgid: string, message: string) => void): void;
  };
  chatEvents.on("disconnected", (reason: string) => console.warn(`[chat] disconnected reason=${reason}`));
  chatEvents.on("reconnect", () => console.warn("[chat] reconnecting"));
  chatEvents.on("notice", (channel: string, msgid: string, message: string) => {
    console.warn(`[chat] notice channel=${channel} msgid=${msgid} message=${message}`);
  });

  try {
    await chatClient.connect();
    console.log("[chat] connected");
  } catch (error) {
    chatClient = null;
    console.error("[chat] connect failed", error);
    throw error;
  } finally {
    chatConnecting = false;
  }
}

async function handleEventSubMessage(raw: string): Promise<void> {
  const message = JSON.parse(raw) as {
    metadata: { message_type: string; subscription_type?: string };
    payload: {
      session?: { id: string };
      event?: { broadcaster_user_id: string; broadcaster_user_login: string; broadcaster_user_name: string; id?: string; title?: string; started_at?: string };
    };
  };

  if (message.metadata.message_type === "session_welcome" && message.payload.session?.id) {
    console.log("[eventsub] session welcome");
    await subscribeEventSub(message.payload.session.id);
    return;
  }

  if (message.metadata.message_type !== "notification" || !message.payload.event) return;
  const event = message.payload.event;
  const login = event.broadcaster_user_login.toLowerCase();

  if (message.metadata.subscription_type === "stream.online") {
    console.log(`[eventsub] stream.online ${login}`);
    const streamer = await prisma.streamer.upsert({
      where: { login },
      create: {
        twitchUserId: event.broadcaster_user_id,
        login,
        displayName: event.broadcaster_user_name,
        lastStatus: "online",
        lastCheckedAt: new Date(),
      },
      update: { lastStatus: "online", lastCheckedAt: new Date(), displayName: event.broadcaster_user_name },
    });
    const active = await prisma.streamSession.findFirst({ where: { streamerId: streamer.id, status: "live" } });
    if (!active) {
      await prisma.streamSession.create({
        data: {
          streamerId: streamer.id,
          twitchStreamId: event.id,
          title: event.title,
          startedAt: event.started_at ? new Date(event.started_at) : new Date(),
          status: "live",
        },
      });
    }
  }

  if (message.metadata.subscription_type === "stream.offline") {
    console.log(`[eventsub] stream.offline ${login}`);
    await prisma.streamer.updateMany({ where: { login }, data: { lastStatus: "offline", lastCheckedAt: new Date() } });
    await prisma.streamSession.updateMany({
      where: { streamer: { login }, status: "live" },
      data: { status: "ended", endedAt: new Date() },
    });
  }
}

async function subscribeEventSub(sessionId: string): Promise<void> {
  const token = env.TWITCH_EVENTSUB_USER_TOKEN || (await getAppToken());
  const streamers = await prisma.streamer.findMany({ where: { enabled: true, login: { in: channelLogins() } } });
  const responses = await Promise.all(
    streamers.flatMap((streamer) =>
      ["stream.online", "stream.offline"].map((type) =>
        fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
          method: "POST",
          headers: {
            "Client-ID": env.TWITCH_CLIENT_ID ?? "",
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            type,
            version: "1",
            condition: { broadcaster_user_id: streamer.twitchUserId },
            transport: { method: "websocket", session_id: sessionId },
          }),
        }),
      ),
    ),
  );
  const failed = responses.filter((response) => !response.ok);
  console.log(`[eventsub] subscriptions requested=${responses.length} failed=${failed.length}`);
}

export async function ingestChatMessage(input: {
  streamerLogin: string;
  twitchMessageId?: string;
  authorTwitchId?: string;
  authorName: string;
  messageText: string;
  postedAt: Date;
}): Promise<void> {
  const urls = extractUrls(input.messageText).filter(isSupportedMediaUrl);
  if (urls.length === 0) return;

  const streamer = await prisma.streamer.findUnique({ where: { login: input.streamerLogin } });
  if (!streamer) {
    console.warn(`[chat] ignored unknown-streamer login=${input.streamerLogin}`);
    return;
  }

  const session = await getOrCreateSession(streamer.id, input.streamerLogin, input.postedAt);

  for (const rawUrl of urls) {
    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl) continue;
    console.log(`[chat] media-url author=${input.authorName} url=${rawUrl} normalized=${normalizedUrl}`);

    const blocked = await prisma.blockedMedia.findUnique({ where: { normalizedUrl } });
    if (blocked) {
      await prisma.chatPost.create({
        data: {
          streamSessionId: session.id,
          twitchMessageId: input.twitchMessageId ? `${input.twitchMessageId}:${normalizedUrl}` : undefined,
          authorTwitchId: input.authorTwitchId,
          authorName: input.authorName,
          messageText: input.messageText,
          originalUrl: rawUrl,
          normalizedUrl,
          postedAt: input.postedAt,
          status: "blocked",
        },
      });
      continue;
    }

    const existingAsset = await prisma.asset.findUnique({ where: { normalizedUrl } });
    const post = await prisma.chatPost.create({
      data: {
        streamSessionId: session.id,
        twitchMessageId: input.twitchMessageId ? `${input.twitchMessageId}:${normalizedUrl}` : undefined,
        authorTwitchId: input.authorTwitchId,
        authorName: input.authorName,
        messageText: input.messageText,
        originalUrl: rawUrl,
        normalizedUrl,
        postedAt: input.postedAt,
        assetId: existingAsset?.status === "stored" ? existingAsset.id : undefined,
        status: existingAsset?.status === "stored" ? "stored" : "pending",
      },
    });

    if (!existingAsset || existingAsset.status !== "stored") {
      const asset =
        existingAsset ??
        (await prisma.asset.create({
          data: {
            originalUrl: rawUrl,
            normalizedUrl,
            mediaType: "other",
            status: "pending",
          },
        }));

      await prisma.downloadJob.create({
        data: {
          assetId: asset.id,
          chatPostId: post.id,
          url: rawUrl,
          status: "pending",
        },
      });
      console.log(`[download] queued chatPost=${post.id} asset=${asset.id}`);
    } else {
      console.log(`[download] reused asset=${existingAsset.id} chatPost=${post.id}`);
    }
  }
}

async function syncConfiguredStreamers(token: string): Promise<void> {
  const params = new URLSearchParams();
  const logins = channelLogins();
  for (const login of logins) params.append("login", login);
  const response = await fetch(`https://api.twitch.tv/helix/users?${params}`, {
    headers: { "Client-ID": env.TWITCH_CLIENT_ID ?? "", Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Twitch users failed: ${response.status} channels=${logins.join(",")} body=${await response.text()}`);
  const body = (await response.json()) as { data: Array<{ id: string; login: string; display_name: string }> };
  console.log(`[twitch] synced users=${body.data.map((user) => user.login).join(",") || "none"}`);
  for (const user of body.data) {
    await prisma.streamer.upsert({
      where: { login: user.login.toLowerCase() },
      create: {
        twitchUserId: user.id,
        login: user.login.toLowerCase(),
        displayName: user.display_name,
        lastStatus: "unknown",
        lastCheckedAt: new Date(),
      },
      update: {
        twitchUserId: user.id,
        displayName: user.display_name,
      },
    });
  }
}

function channelLogins(): string[] {
  return env.TWITCH_CHANNELS.split(",")
    .map((login) => login.trim().toLowerCase().replace(/^#+/, ""))
    .filter(Boolean);
}

async function getOrCreateSession(streamerId: string, _streamerLogin: string, seenAt: Date) {
  const active = await prisma.streamSession.findFirst({
    where: { streamerId, status: "live" },
    orderBy: { startedAt: "desc" },
  });
  if (active) return active;

  return prisma.streamSession.create({
    data: {
      streamerId,
      startedAt: seenAt,
      status: "live",
    },
  });
}

async function upsertLiveStreamer(stream: TwitchStream): Promise<void> {
  const streamer = await prisma.streamer.upsert({
    where: { login: stream.user_login.toLowerCase() },
    create: {
      twitchUserId: stream.user_id,
      login: stream.user_login.toLowerCase(),
      displayName: stream.user_name,
      lastStatus: "online",
      lastCheckedAt: new Date(),
    },
    update: {
      twitchUserId: stream.user_id,
      displayName: stream.user_name,
      lastStatus: "online",
      lastCheckedAt: new Date(),
    },
  });

  const active = await prisma.streamSession.findFirst({
    where: { streamerId: streamer.id, status: "live" },
    orderBy: { startedAt: "desc" },
  });

  if (active?.twitchStreamId && active.twitchStreamId !== stream.id) {
    await prisma.streamSession.update({
      where: { id: active.id },
      data: { status: "ended", endedAt: new Date(stream.started_at) },
    });
  }

  if (active && (!active.twitchStreamId || active.twitchStreamId === stream.id)) {
    await prisma.streamSession.update({
      where: { id: active.id },
      data: {
        twitchStreamId: active.twitchStreamId ?? stream.id,
        title: stream.title,
        startedAt: active.twitchStreamId ? active.startedAt : new Date(stream.started_at),
      },
    });
    return;
  }

  await prisma.streamSession.create({
    data: {
      streamerId: streamer.id,
      twitchStreamId: stream.id,
      title: stream.title,
      startedAt: new Date(stream.started_at),
      status: "live",
    },
  });
}

async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.value;
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID ?? "",
      client_secret: env.TWITCH_CLIENT_SECRET ?? "",
      grant_type: "client_credentials",
    }),
  });
  if (!response.ok) throw new Error(`Twitch token failed: ${response.status}`);
  const body = (await response.json()) as { access_token: string; expires_in: number };
  appToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return appToken.value;
}
