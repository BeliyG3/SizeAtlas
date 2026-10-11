import { ICONS, type IconName } from "./paths";
import "./icons.css";

interface Props {
  name: IconName;
  className?: string;
  /** Names the icon to assistive technology; without it the icon is decorative. */
  title?: string;
  /** Stroke color; by default the text color. */
  color?: string;
}

/** A 16 px line icon in the current text color (see paths.ts). */
export function Icon({ name, className, title, color }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={color ? { color } : undefined}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d={ICONS[name]} />
    </svg>
  );
}
