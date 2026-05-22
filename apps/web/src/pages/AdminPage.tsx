import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, EyeOff, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { api, type AdminDashboard, type Asset, type DownloadJob } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MediaPreview } from "@/components/MediaPreview";

export function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState("");

  if (!loggedIn) {
    return <LoginForm onSuccess={() => setLoggedIn(true)} error={error} setError={setError} />;
  }

  return <AdminDashboardPage />;
}

function LoginForm({ onSuccess, error, setError }: { onSuccess: () => void; error: string; setError: (value: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api.login(username, password);
      onSuccess();
    } catch {
      setError("Неверный логин или пароль");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Admin login</CardTitle>
          <CardDescription>Вход в модерацию архива</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
            <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit">Login</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [failedJobs, setFailedJobs] = useState<DownloadJob[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [deleteAsset, setDeleteAsset] = useState<Asset | null>(null);

  async function refresh() {
    const [nextDashboard, nextAssets, nextFailedJobs] = await Promise.all([api.dashboard(), api.assets(), api.failedJobs()]);
    setDashboard(nextDashboard);
    setAssets(nextAssets);
    setFailedJobs(nextFailedJobs);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const cards = useMemo(
    () => [
      ["Stored assets", dashboard?.storedAssets ?? 0],
      ["Failed jobs", dashboard?.failedJobs ?? 0],
      ["Blocked posts", dashboard?.blockedPosts ?? 0],
      ["Downloaded today", formatBytes(dashboard?.bytesToday)],
    ],
    [dashboard],
  );

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Archive Admin</h1>
            <p className="text-sm text-muted-foreground">Модерация, статусы worker’а и физическое удаление ассетов.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => (window.location.hash = "")}>Public</Button>
            <Button onClick={() => void refresh()}>
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5">
        <section className="grid gap-4 md:grid-cols-4">
          {cards.map(([label, value]) => (
            <Card key={label}>
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-2xl">{value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader>
              <CardTitle>Assets</CardTitle>
              <CardDescription>Preview, hide/restore и permanent delete</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Media</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((asset) => {
                    const firstPost = asset.posts?.[0];
                    return (
                      <TableRow key={asset.id}>
                        <TableCell>
                          <button className="max-w-[260px] truncate text-left underline" onClick={() => setSelectedAsset(asset)}>
                            {asset.normalizedUrl}
                          </button>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Badge variant={asset.status === "stored" ? "secondary" : "outline"}>{asset.status}</Badge>
                            <Badge variant={asset.visibility === "hidden" ? "destructive" : "outline"}>{asset.visibility}</Badge>
                          </div>
                        </TableCell>
                        <TableCell>{formatBytes(asset.byteSize)}</TableCell>
                        <TableCell>{firstPost?.authorName ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {asset.visibility === "public" ? (
                              <Button size="icon" variant="outline" title="Hide" onClick={() => void api.hideAsset(asset.id).then(refresh)}>
                                <EyeOff />
                              </Button>
                            ) : (
                              <Button size="icon" variant="outline" title="Restore" onClick={() => void api.restoreAsset(asset.id).then(refresh)}>
                                <RotateCcw />
                              </Button>
                            )}
                            <Button size="icon" variant="destructive" title="Delete permanently" onClick={() => setDeleteAsset(asset)}>
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Streamers</CardTitle>
                <CardDescription>Текущий статус каналов</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {dashboard?.streamers.map((streamer) => (
                  <div key={streamer.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <span>{streamer.displayName}</span>
                    <Badge variant={streamer.lastStatus === "online" ? "default" : "secondary"}>{streamer.lastStatus}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Failed jobs</CardTitle>
                <CardDescription>Ошибки скачивания</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {failedJobs.map((job) => (
                  <div key={job.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <AlertTriangle />
                      <span className="font-medium">{formatDate(job.updatedAt)}</span>
                    </div>
                    <p className="break-all text-muted-foreground">{job.url}</p>
                    <p>{job.lastError}</p>
                    <Button size="sm" variant="outline" onClick={() => void api.retryJob(job.id).then(refresh)}>
                      Retry
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(deleteAsset)}
        title="Удалить ассет физически?"
        destructive
        confirmLabel="Delete permanently"
        onCancel={() => setDeleteAsset(null)}
        onConfirm={() => {
          if (!deleteAsset) return;
          void api.deleteAsset(deleteAsset.id, "moderation").then(() => {
            setDeleteAsset(null);
            void refresh();
          });
        }}
        description={
          deleteAsset ? (
            <div className="flex flex-col gap-2">
              <p>Файл будет удален из S3, а URL/SHA-256 попадут в blocklist.</p>
              <p>Тип: {deleteAsset.mimeType ?? "unknown"}</p>
              <p>Размер: {formatBytes(deleteAsset.byteSize)}</p>
              <p className="break-all">S3 key: {deleteAsset.s3Key ?? "none"}</p>
              <p className="break-all">URL: {deleteAsset.normalizedUrl}</p>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={Boolean(selectedAsset)}
        title="Asset preview"
        confirmLabel="Close"
        onCancel={() => setSelectedAsset(null)}
        onConfirm={() => setSelectedAsset(null)}
        description={selectedAsset ? <MediaPreview asset={selectedAsset} /> : null}
      />
    </main>
  );
}
