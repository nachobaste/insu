'use server'

export async function createHedgerPaymentIntent(
  tierId: string,
): Promise<{ clientSecret: string } | { error: string }> {
  // TODO: implement with Stripe
  void tierId
  return { error: 'Not implemented' }
}

export async function createProviderPaymentIntent(
  tierId: string,
  amountUsd: number,
): Promise<{ clientSecret: string } | { error: string }> {
  // TODO: implement with Stripe
  void tierId
  void amountUsd
  return { error: 'Not implemented' }
}
