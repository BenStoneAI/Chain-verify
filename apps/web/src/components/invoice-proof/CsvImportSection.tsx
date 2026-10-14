'use client';

import { useId } from 'react';

export interface CsvImportSectionProps {
  title: string;
  placeholder: string;
  buttonLabel: string;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onImport: () => void;
}

export function CsvImportSection({
  title,
  placeholder,
  buttonLabel,
  value,
  busy,
  onChange,
  onImport,
}: CsvImportSectionProps) {
  const id = useId();

  return (
    <section className="ipa-card ipa-field">
      <label className="ipa-label" htmlFor={id}>
        {title}
      </label>
      <textarea
        id={id}
        className="ipa-textarea"
        rows={6}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="ipa-actions">
        <button
          type="button"
          className="ipa-btn ipa-btn-primary"
          disabled={busy || !value.trim()}
          onClick={onImport}
        >
          {busy ? 'Importing...' : buttonLabel}
        </button>
      </div>
    </section>
  );
}
