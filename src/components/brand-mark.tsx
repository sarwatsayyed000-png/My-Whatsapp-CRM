import { cn } from "@/lib/utils";

/**
 * Speedy Way Travels brand mark — the "D" rocket logo from
 * `public/logo-mark.png`, shown on a white rounded tile.
 *
 * The logo's inner details (ring, plane) are transparent cut-outs, so
 * the white tile keeps them visible in dark mode as well as light.
 * To change the logo, replace `public/logo-mark.png` (transparent PNG,
 * roughly 3:2, logo in brand maroon).
 */
export const BRAND_MAROON = "#A42547";
export const BRAND_NAVY = "#242F65";

export function BrandMark({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-black/10",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo; next/image adds nothing here */}
      <img
        src="/logo-mark.png"
        alt=""
        className={cn("h-auto w-[82%] object-contain", iconClassName)}
      />
    </div>
  );
}
