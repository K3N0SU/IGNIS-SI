import type { CSSProperties, ReactNode } from "react";

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClassName = "",
  highlight = false,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  highlight?: boolean;
}) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col rounded-md border bg-panel transition-colors duration-300 ${
        highlight ? "border-fg/60" : "border-line"
      } ${className}`}
    >
      <header className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <h2 className="label truncate">{title}</h2>
        {right}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  testId,
}: {
  value: T;
  options: { value: T; label: string; accent?: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  testId?: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-inset p-px" role="radiogroup" data-testid={testId}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-[5px] font-medium tracking-wide transition-colors ${
              size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
            } ${active ? "bg-line-strong text-fg" : "text-muted hover:text-fg"}`}
            style={active && o.accent ? { color: o.accent } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  unit,
  value,
  min,
  max,
  step,
  digits,
  onChange,
  accent,
  note,
  testId,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits: number;
  onChange: (value: number) => void;
  accent?: string;
  note?: string;
  testId?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  const style = { "--fill": `${fill}%`, "--track-fill": accent ?? "#F3F4F6" } as CSSProperties;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[11px] text-muted" htmlFor={testId}>
          {label}
        </label>
        <span className="num text-[12px] text-fg">
          {value.toFixed(digits)}
          <span className="ml-1 text-[10px] text-faint">{unit}</span>
        </span>
      </div>
      <input
        id={testId}
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={style}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="num -mt-0.5 flex justify-between text-[9px] text-faint">
        <span>{min.toFixed(digits)}</span>
        {note ? <span className="font-sans">{note}</span> : null}
        <span>{max.toFixed(digits)}</span>
      </div>
    </div>
  );
}

export function Readout({
  label,
  value,
  unit,
  color,
  align = "left",
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="label">{label}</div>
      <div className="num text-[13px] leading-5" style={{ color }}>
        {value}
        {unit ? <span className="ml-1 text-[10px] text-faint">{unit}</span> : null}
      </div>
    </div>
  );
}

export function Tag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px text-[10px] font-semibold tracking-wider"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}12` }}
    >
      <span className="h-1.5 w-1.5 rounded-[1px]" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}
