import type { Asset } from "@/lib/api";

export function MediaPreview({ asset }: { asset: Asset }) {
  if (!asset.publicUrl) return <div className="flex aspect-video items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">No media</div>;

  if (asset.mediaType === "image") {
    return <img src={asset.publicUrl} alt="" loading="lazy" className="max-h-[560px] w-full rounded-md object-contain" />;
  }

  if (asset.mediaType === "video" && (asset.mimeType?.includes("mp4") || asset.mimeType?.includes("webm") || asset.publicUrl.match(/\.(mp4|webm)(?:$|\?)/i))) {
    return <video src={asset.publicUrl} controls preload="metadata" className="max-h-[560px] w-full rounded-md bg-muted" />;
  }

  return (
    <a href={asset.publicUrl} className="flex aspect-video items-center justify-center rounded-md border bg-muted text-sm underline" target="_blank" rel="noreferrer">
      Open media
    </a>
  );
}
