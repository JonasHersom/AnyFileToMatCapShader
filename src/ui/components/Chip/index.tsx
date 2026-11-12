import "./index.css";

interface ChipProps {
  label: string;
  icon?: preact.ComponentChildren;
  selected?: boolean;
  onClick?: () => void;
  tabIndex?: number;
  onFocus?: () => void;
}

export default function Chip({
  label,
  icon,
  selected = false,
  onClick,
  tabIndex,
  onFocus,
}: ChipProps) {
  return (
    <button
      className={`chip ${selected ? "chip-active" : ""}`}
      onClick={onClick}
      type="button"
      aria-pressed={selected}
      tabIndex={tabIndex}
      onFocus={onFocus}
    >
      {icon && <span className="chip-icon">{icon}</span>}
      <span className="chip-label">{label}</span>
    </button>
  );
}
