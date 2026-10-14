import type { ErpConnection } from '@/lib/invoice-proof/types';

export interface ErpProviderRowProps {
  label: string;
  statusText: string;
  connection?: ErpConnection;
  canConnect: boolean;
  onConnect: () => void;
}

export function ErpProviderRow({ label, statusText, connection, canConnect, onConnect }: ErpProviderRowProps) {
  const syncStatus = connection?.lastSyncStatus ?? null;
  const pendingImport = !syncStatus || syncStatus === 'SANDBOX_PENDING' || syncStatus === 'SCHEDULED';
  const failed = Boolean(syncStatus && syncStatus.startsWith('ERROR'));

  return (
    <li className="ipa-card ipa-row">
      <div>
        <strong>{label}</strong>
        <p className="ipa-faint">{statusText}</p>
        {connection && pendingImport ? <p className="ipa-faint">Authorized. Data import is not live yet.</p> : null}
        {connection && failed ? <p className="ipa-faint">{syncStatus}</p> : null}
      </div>
      <div className="ipa-actions">
        {canConnect ? (
          <button type="button" className="ipa-btn ipa-btn-sm" onClick={onConnect}>
            {connection ? 'Re-authorize' : 'Authorize'}
          </button>
        ) : (
          <span className="ipa-faint">Not available</span>
        )}
        {connection ? (
          <button
            type="button"
            className="ipa-btn ipa-btn-sm"
            disabled
            title="Data import is not live yet, so no records will be imported."
          >
            Sync (pending)
          </button>
        ) : null}
      </div>
    </li>
  );
}
