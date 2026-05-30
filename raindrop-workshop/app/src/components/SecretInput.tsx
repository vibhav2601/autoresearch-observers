import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { C } from "../utils/colors";

export function SecretInput({
  label,
  description,
  placeholder,
  value,
  onChange,
  saved,
  getKeyUrl,
  getKeyLabel,
}: {
  label: string;
  description?: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  saved: boolean;
  /** External console where the user can generate this key. Renders a small link next to the description. */
  getKeyUrl?: string;
  /** Override link label. Defaults to "Get a key →". */
  getKeyLabel?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="py-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px]" style={{ color: C.fg3 }}>{label}</span>
        {saved && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: C.green, background: "rgba(96,227,109,0.08)" }}>
            saved
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        <input
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md text-[12px] font-mono outline-none transition-colors focus:ring-1 focus:ring-white/20"
          style={{ background: "rgba(255,255,255,0.05)", color: C.fg3, border: `1px solid ${C.border}` }}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <button
          type="button"
          className="px-2 py-1.5 rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.fg1 }}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
      </div>
      {(description || getKeyUrl) && (
        <div className="flex items-baseline justify-between gap-3 mt-1.5">
          {description && <div className="text-[11px]" style={{ color: C.fg0 }}>{description}</div>}
          {getKeyUrl && (
            <a
              href={getKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium whitespace-nowrap hover:underline flex-shrink-0"
              style={{ color: C.fg3 }}
            >
              {getKeyLabel ?? "Get a key \u2192"}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
