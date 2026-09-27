import CheckoutWelcome from '@/components/proof/CheckoutWelcome';

export default function WelcomePage({
  searchParams,
}: {
  searchParams: { plan?: string; session_id?: string };
}) {
  return (
    <CheckoutWelcome
      product="audit-proof"
      plan={searchParams.plan}
      sessionId={searchParams.session_id}
    />
  );
}
