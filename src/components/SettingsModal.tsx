import type { ReactNode } from 'react';
import { ACCENTS, PROSE_FONTS } from '../lib/settings-config';
import type { Settings } from '../types';
import { IconAuto, IconCheck, IconClose, IconMoon, IconSun } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (next: Settings) => void;
  onReset: () => void;
}

export function SettingsModal({ open, onClose, settings, onChange, onReset }: Props) {
  if (!open) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onChange({ ...settings, [k]: v });

  const seg = <K extends keyof Settings>(
    key: K,
    options: ReadonlyArray<readonly [Settings[K], string, ReactNode?]>
  ) => (
    <div className="seg" role="radiogroup">
      {options.map(([v, l, icon]) => (
        <button
          key={String(v)}
          className={'seg-btn' + (settings[key] === v ? ' on' : '')}
          onClick={() => set(key, v)}
          role="radio"
          aria-checked={settings[key] === v}
        >
          {icon}
          <span>{l}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h3>Settings</h3>
          <button className="btn btn-icon" onClick={onClose} title="Close" aria-label="Close">
            <IconClose />
          </button>
        </div>
        <p className="modal-sub">
          Personal preferences — stored on this device only. Nothing here is shared by the link.
        </p>

        <div className="settings-section">
          <div className="settings-label">Theme</div>
          {seg('theme', [
            ['auto', 'System', <IconAuto key="auto" />],
            ['light', 'Light', <IconSun key="light" />],
            ['dark', 'Dark', <IconMoon key="dark" />],
          ])}
        </div>

        <div className="settings-section">
          <div className="settings-label">Prose font</div>
          <div className="font-grid">
            {PROSE_FONTS.map((o) => (
              <button
                key={o.value}
                className={'font-card' + (settings.proseFont === o.value ? ' on' : '')}
                onClick={() => set('proseFont', o.value)}
              >
                <span className="font-card-preview" style={{ fontFamily: o.stack }}>
                  Aa
                </span>
                <span className="font-card-label">
                  <span>{o.label}</span>
                  <span className="font-card-hint">{o.hint}</span>
                </span>
                {settings.proseFont === o.value && (
                  <span className="font-card-check">
                    <IconCheck />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section split">
          <div>
            <div className="settings-label">Text size</div>
            {seg('proseSize', [
              ['small', 'Small'],
              ['default', 'Default'],
              ['large', 'Large'],
            ])}
          </div>
          <div>
            <div className="settings-label">Density</div>
            {seg('density', [
              ['comfortable', 'Comfortable'],
              ['compact', 'Compact'],
            ])}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Editor width</div>
          {seg('editorWidth', [
            ['narrow', 'Narrow'],
            ['default', 'Default'],
            ['wide', 'Wide'],
          ])}
        </div>

        <div className="settings-section">
          <div className="settings-label">Accent</div>
          <div className="swatch-row">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                className={'swatch' + (settings.accent === a.value ? ' on' : '')}
                onClick={() => set('accent', a.value)}
                title={a.label}
                aria-label={a.label}
              >
                <span className="swatch-dot" style={{ background: a.swatch }}>
                  {settings.accent === a.value && <IconCheck />}
                </span>
                <span className="swatch-name">{a.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-quiet" onClick={onReset}>
            Reset to defaults
          </button>
          <div className="spacer" />
          <button className="btn btn-ghost-bordered" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
