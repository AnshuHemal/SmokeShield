/**
 * The SmokeShield mark. It renders public/favicon.svg itself, so the browser-tab icon and the in-app logo
 * are always the same artwork: change that one file and both update.
 */
export function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/favicon.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`shrink-0 select-none ${className}`}
    />
  );
}
