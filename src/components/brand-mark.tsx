import { cn } from "@/lib/utils";

/**
 * Speedy Way Travels brand mark — maroon→navy tile with a paper-plane
 * glyph (from the brand's line-art icon set).
 *
 * LOGO SLOT: to use the real Speedy Way logo instead, drop the file at
 * `public/logo.png` and replace the <svg> below with:
 *   <img src="/logo.png" alt="" className="h-full w-full object-contain" />
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
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, ${BRAND_MAROON}, ${BRAND_NAVY})`,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("h-4 w-4", iconClassName)}
      >
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22l-4-9-9-4 20-7z" />
      </svg>
    </div>
  );
}
