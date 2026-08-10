/**
 * A framed screenshot of the running app — the site's way of showing the real
 * product rather than an illustration of it. Same window chrome as
 * `CodeWindow` so artifacts and screenshots read as one family; the image is
 * statically sized by its intrinsic dimensions to avoid layout shift.
 */
export function AppWindow({
  src,
  alt,
  title,
  width,
  height,
}: {
  src: string;
  alt: string;
  title: string;
  width: number;
  height: number;
}) {
  return (
    <figure className="overflow-hidden rounded-sm border border-rule">
      <figcaption className="flex items-center border-rule border-b bg-paper-2 px-4 py-2.5">
        <span className="font-mono text-xs text-ink-faint tracking-wide">{title}</span>
      </figcaption>
      <img src={src} alt={alt} width={width} height={height} className="block h-auto w-full" />
    </figure>
  );
}
