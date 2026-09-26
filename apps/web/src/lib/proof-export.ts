type ExportFormat = 'pdf' | 'json';

export async function downloadProofExport(options: {
  proofId: string;
  format: ExportFormat;
  apiBase: string;
  filenamePrefix: string;
  headers?: Record<string, string>;
}) {
  const { proofId, format, apiBase, filenamePrefix, headers } = options;
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/proof/${encodeURIComponent(proofId)}/export?format=${format}`, { headers });
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filenamePrefix}-${proofId}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
