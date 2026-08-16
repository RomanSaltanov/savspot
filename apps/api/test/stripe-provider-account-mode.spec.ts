import { describe, it, expect, vi } from 'vitest';
import { StripeProvider } from '@/payments/providers/stripe.provider';

function makeProvider() {
  const config = { get: vi.fn(() => undefined) };
  const circuitBreaker = {
    canSend: vi.fn().mockResolvedValue(true),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const provider = new StripeProvider(config as never, circuitBreaker as never);
  const paymentIntentsCreate = vi.fn().mockResolvedValue({
    id: 'pi_123',
    client_secret: 'secret_123',
    status: 'requires_payment_method',
    amount: 1000,
    currency: 'gbp',
  });
  const refundsCreate = vi.fn().mockResolvedValue({
    id: 're_123',
    amount: 1000,
    status: 'succeeded',
  });

  (provider as unknown as { stripe: unknown }).stripe = {
    paymentIntents: { create: paymentIntentsCreate },
    refunds: { create: refundsCreate },
  };

  return { provider, paymentIntentsCreate, refundsCreate };
}

describe('StripeProvider account modes', () => {
  it('omits Connect-only PaymentIntent fields in direct mode', async () => {
    const { provider, paymentIntentsCreate } = makeProvider();

    await provider.createPaymentIntent({
      amount: 1000,
      currency: 'gbp',
      metadata: { stripeAccountMode: 'direct' },
    });

    expect(paymentIntentsCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        application_fee_amount: expect.anything(),
        transfer_data: expect.anything(),
      }),
    );
  });

  it('includes Connect fields for connected-account payments', async () => {
    const { provider, paymentIntentsCreate } = makeProvider();

    await provider.createPaymentIntent({
      amount: 1000,
      currency: 'gbp',
      connectedAccountId: 'acct_123',
      platformFeeAmount: 100,
      metadata: { stripeAccountMode: 'connect' },
    });

    expect(paymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        application_fee_amount: 100,
        transfer_data: { destination: 'acct_123' },
      }),
    );
  });

  it('omits Connect-only refund flags for direct payments', async () => {
    const { provider, refundsCreate } = makeProvider();

    await provider.createRefund({
      paymentIntentId: 'pi_123',
      connectedAccountPayment: false,
      refundApplicationFee: false,
    });

    expect(refundsCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        reverse_transfer: expect.anything(),
        refund_application_fee: expect.anything(),
      }),
    );
  });

  it('includes Connect refund flags for connected-account payments', async () => {
    const { provider, refundsCreate } = makeProvider();

    await provider.createRefund({
      paymentIntentId: 'pi_123',
      connectedAccountPayment: true,
      refundApplicationFee: true,
    });

    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        reverse_transfer: true,
        refund_application_fee: true,
      }),
    );
  });
});
