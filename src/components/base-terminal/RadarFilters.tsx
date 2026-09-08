import type { Dispatch, ReactNode, SetStateAction } from "react";
import { cx } from "@/lib/format";
import {
  getRadarOptionLabel,
  getRadarPresetState,
  parseRadarSort,
  RADAR_AGE_OPTIONS,
  RADAR_LIQUIDITY_OPTIONS,
  RADAR_SORT_OPTIONS,
  RADAR_VOLUME_OPTIONS,
  toOptionalNumber,
  type RadarPreset,
  type RadarState
} from "@/lib/base-terminal/radar";

export function RadarFilterPanel({
  state,
  onChange,
  onReset
}: {
  state: RadarState;
  onChange: Dispatch<SetStateAction<RadarState>>;
  onReset: () => void;
}) {
  function patchState(patch: Partial<RadarState>) {
    onChange((current) => ({ ...current, ...patch }));
  }

  function applyPreset(preset: RadarPreset) {
    onChange(getRadarPresetState(preset));
  }

  return (
    <section
      className="min-h-0 overflow-hidden border border-border-subtle bg-surface-panel"
      data-testid="radar-filters"
    >
      <div className="flex min-h-8 items-center justify-between border-b border-border-subtle bg-surface-raised px-2">
        <h2 className="text-meta font-semibold uppercase tracking-eyebrow text-content-primary">
          Radar filters
        </h2>
        <button
          type="button"
          onClick={onReset}
          className="font-mono text-meta uppercase tracking-eyebrow text-content-secondary hover:text-content-primary"
        >
          Reset
        </button>
      </div>

      <div className="space-y-2 p-2">
        <div className="grid grid-cols-5 gap-1">
          {(["fresh", "liquid", "momentum", "volatile", "watched"] as RadarPreset[]).map(
            (preset) => (
              <button
                data-testid={`radar-preset-${preset}`}
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className="h-6 border border-border-subtle bg-surface-interactive px-1 font-mono text-meta uppercase tracking-eyebrow text-content-secondary hover:border-border-strong hover:text-content-primary"
              >
                {preset}
              </button>
            )
          )}
        </div>

        <div className="grid grid-cols-2 gap-1">
          <RadarSelect
            label="Min liq"
            value={String(state.minLiquidityUsd)}
            onChange={(value) => patchState({ minLiquidityUsd: toOptionalNumber(value) ?? 0 })}
          >
            {RADAR_LIQUIDITY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {getRadarOptionLabel(value)}
              </option>
            ))}
          </RadarSelect>

          <RadarSelect
            label="Min vol"
            value={String(state.minVolume24hUsd)}
            onChange={(value) => patchState({ minVolume24hUsd: toOptionalNumber(value) ?? 0 })}
          >
            {RADAR_VOLUME_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {getRadarOptionLabel(value)}
              </option>
            ))}
          </RadarSelect>

          <RadarSelect
            label="Max age"
            value={state.maxAgeMinutes === undefined ? "" : String(state.maxAgeMinutes)}
            onChange={(value) => patchState({ maxAgeMinutes: toOptionalNumber(value) })}
          >
            {RADAR_AGE_OPTIONS.map((option) => (
              <option key={option.label} value={option.value ?? ""}>
                {option.label}
              </option>
            ))}
          </RadarSelect>

          <RadarSelect
            label="Sort"
            value={state.sort}
            onChange={(value) => patchState({ sort: parseRadarSort(value) })}
          >
            {RADAR_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </RadarSelect>
        </div>

        <div className="grid grid-cols-2 gap-1">
          <RadarInput
            label="Min 24h %"
            value={state.minChange24h}
            onChange={(value) => patchState({ minChange24h: value })}
          />
          <RadarInput
            label="Max 24h %"
            value={state.maxChange24h}
            onChange={(value) => patchState({ maxChange24h: value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-1">
          <RadarToggle
            label="Pinned only"
            active={state.onlyPinned}
            onClick={() => patchState({ onlyPinned: !state.onlyPinned })}
          />
          <RadarToggle
            label="Hide stale"
            active={state.hideStale}
            onClick={() => patchState({ hideStale: !state.hideStale })}
          />
        </div>
      </div>
    </section>
  );
}

function RadarSelect({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="grid grid-cols-[58px_minmax(0,1fr)] items-center border border-border-subtle bg-surface-interactive text-meta">
      <span className="border-r border-border-subtle px-1 font-mono uppercase tracking-eyebrow text-content-secondary">
        {label}
      </span>
      <select
        data-testid={`radar-select-${label.toLowerCase().replace(/\s+/g, "-")}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 min-w-0 bg-surface-panel px-1 font-mono text-meta text-content-primary outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function RadarInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="grid grid-cols-[58px_minmax(0,1fr)] items-center border border-border-subtle bg-surface-interactive text-meta">
      <span className="border-r border-border-subtle px-1 font-mono uppercase tracking-eyebrow text-content-secondary">
        {label}
      </span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(toOptionalNumber(event.target.value))}
        placeholder="Any"
        className="h-6 min-w-0 bg-surface-panel px-1 font-mono text-meta text-content-primary outline-none placeholder:text-content-secondary"
      />
    </label>
  );
}

function RadarToggle({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "h-6 border px-1 font-mono text-meta uppercase tracking-eyebrow",
        active
          ? "border-brand-accent/45 bg-brand-accent/10 text-brand-accent"
          : "border-border-subtle bg-surface-interactive text-content-secondary hover:border-border-strong hover:text-content-primary"
      )}
    >
      {label}
    </button>
  );
}
