'use client';

import { createContext, useContext } from 'react';

export interface InvoiceProofSession {
  /** The customer's Chain Verify API key. */
  apiKey: string;
  /** Clears the stored key and returns to the key form, optionally explaining why. */
  signOut: (reason?: string) => void;
}

export const InvoiceProofSessionContext = createContext<InvoiceProofSession | null>(null);

export function useInvoiceProofSession(): InvoiceProofSession {
  const session = useContext(InvoiceProofSessionContext);
  if (!session) {
    throw new Error('useInvoiceProofSession must be used inside <InvoiceProofKeyGate>.');
  }
  return session;
}
