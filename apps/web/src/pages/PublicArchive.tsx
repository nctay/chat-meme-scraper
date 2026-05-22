import { useEffect, useMemo, useState } from "react";
import { Filter, Radio, Video } from "lucide-react";
import { api, type StreamSession, type Streamer, type TimelinePost } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaPreview } from "@/components/MediaPreview";

export function PublicArchive() {
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [streams, setStreams] = useState<StreamSession[]>([]);
  const [timeline, setTimeline] = useState<TimelinePost[]>([]);
  const [selectedStreamer, setSelectedStreamer] = useState<string>("");
  const [selectedStream, setSelectedStream] = useState<string>("");
  const [type, setType] = useState<string>("");

  useEffect(() => {
    void api.streamers().then(setStreamers);
  }, []);

  useEffect(() => {
    void api.streams(selectedStreamer || undefined).then((items) => {
      setStreams(items);
      setSelectedStream((current) => current || items[0]?.id || "");
    });
  }, [selectedStreamer]);

  useEffect(() => {
    if (!selectedStream) return;
    void api.timeline(selectedStream, type || undefined).then(setTimeline);
  }, [selectedStream, type]);

  const selected = useMemo(() => streams.find((stream) => stream.id === selectedStream), [selectedStream, streams]);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Twitch Media Archive</h1>
            <p className="text-sm text-muted-foreground">Публичная лента картинок и видео, сохраненных из чата.</p>
          </div>
          <Button variant="outline" onClick={() => (window.location.hash = "admin")}>
            <Radio data-icon="inline-start" />
            Admin
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[320px_1fr]">
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Стримеры</CardTitle>
              <CardDescription>Фильтр по каналам</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant={selectedStreamer === "" ? "default" : "outline"} onClick={() => setSelectedStreamer("")}>
                Все
              </Button>
              {streamers.map((streamer) => (
                <Button key={streamer.id} variant={selectedStreamer === streamer.id ? "default" : "outline"} onClick={() => setSelectedStreamer(streamer.id)}>
                  {streamer.displayName}
                  <Badge variant="secondary">{streamer.lastStatus}</Badge>
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Стримы</CardTitle>
              <CardDescription>Последние 100 сессий</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {streams.map((stream) => (
                <Button key={stream.id} variant={selectedStream === stream.id ? "default" : "outline"} onClick={() => setSelectedStream(stream.id)} className="justify-start">
                  {formatDate(stream.startedAt)}
                </Button>
              ))}
            </CardContent>
          </Card>
        </aside>

        <section className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>{selected ? `${selected.streamer.displayName} · ${formatDate(selected.startedAt)}` : "Лента"}</CardTitle>
                <CardDescription>{timeline.length} медиа-постов</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant={type === "" ? "default" : "outline"} size="sm" onClick={() => setType("")}>
                  <Filter data-icon="inline-start" />
                  Все
                </Button>
                <Button variant={type === "image" ? "default" : "outline"} size="sm" onClick={() => setType("image")}>
                  Images
                </Button>
                <Button variant={type === "video" ? "default" : "outline"} size="sm" onClick={() => setType("video")}>
                  <Video data-icon="inline-start" />
                  Videos
                </Button>
              </div>
            </CardHeader>
          </Card>

          {timeline.map((post) => (
            <Card key={post.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{post.authorName}</CardTitle>
                  <Badge variant="outline">{formatDate(post.postedAt)}</Badge>
                  <Badge variant="secondary">{post.asset.mediaType}</Badge>
                </div>
                <CardDescription className="break-all">{post.originalUrl}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <MediaPreview asset={post.asset} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => window.open(post.originalUrl, "_blank")}>Original</Button>
                  {post.asset.publicUrl && <Button variant="outline" size="sm" onClick={() => window.open(post.asset.publicUrl!, "_blank")}>S3</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
