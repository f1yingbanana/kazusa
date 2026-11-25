import { cx } from "./cx";

/**
 * A decorative picture filling its box, cropped to cover it. It fades in once
 * it has arrived, over whatever the box shows meanwhile (a tint holds its
 * place).
 */
export function Picture({
  src,
  position,
  className,
}: {
  src: string;
  /** What to keep in view when it's cropped, as `object-position`. */
  position?: string;
  className?: string;
}) {
  return (
    <div className={cx("overflow-hidden bg-ui-tint", className)}>
      <img
        key={src}
        src={src}
        alt=""
        draggable={false}
        onLoad={(event) => {
          event.currentTarget.dataset.loaded = "";
        }}
        style={{ objectPosition: position }}
        className="size-full object-cover opacity-0 transition-opacity duration-300 select-none data-loaded:opacity-100 motion-reduce:transition-none"
      />
    </div>
  );
}
