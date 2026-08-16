import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookingWizard } from '../booking-wizard';
import type { BookingSession, TenantData } from '../booking-types';

vi.mock('@savspot/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/motion', () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  StepTransition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../booking-progress', () => ({ BookingProgress: () => null }));
vi.mock('../booking-price-bar', () => ({ BookingPriceBar: () => null }));
vi.mock('../service-selection-step', () => ({
  ServiceSelectionStep: ({
    onSelect,
  }: {
    onSelect: (data: { serviceId: string; paymentMode: string }) => Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() =>
        void onSelect({
          serviceId: 'service-online',
          paymentMode: 'FULL_ONLINE',
        })
      }
    >
      Select online service
    </button>
  ),
}));
vi.mock('../date-time-picker-step', () => ({ DateTimePickerStep: () => null }));
vi.mock('../guest-count-step', () => ({ GuestCountStep: () => null }));
vi.mock('../questionnaire-step', () => ({ QuestionnaireStep: () => null }));
vi.mock('../addon-selection-step', () => ({ AddonSelectionStep: () => null }));
vi.mock('../pricing-summary-step', () => ({ PricingSummaryStep: () => null }));
vi.mock('../payment-step', () => ({
  PaymentStep: ({ onPaymentComplete }: { onPaymentComplete: () => Promise<void> }) => (
    <button type="button" onClick={() => void onPaymentComplete()}>
      Complete payment
    </button>
  ),
}));
vi.mock('../staff-selection-step', () => ({ StaffSelectionStep: () => null }));
vi.mock('../guest-info-step', () => ({
  GuestInfoStep: ({
    onContinue,
  }: {
    onContinue: (data: { guestName: string; guestEmail: string }) => Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() =>
        void onContinue({
          guestName: 'Test Client',
          guestEmail: 'client@example.com',
        })
      }
    >
      Submit details
    </button>
  ),
}));
vi.mock('../confirmation-step', () => ({
  ConfirmationStep: () => <div>Booking confirmed</div>,
}));

const tenant: TenantData = {
  id: 'tenant-1',
  name: 'Test Salon',
  slug: 'test-salon',
  description: null,
  logoUrl: null,
  coverPhotoUrl: null,
  brandColor: null,
  timezone: 'Europe/London',
  currency: 'GBP',
  address: null,
  contactEmail: null,
  contactPhone: null,
  category: 'SALON',
  categoryLabel: 'Salon',
  services: [],
};

const initialSession: BookingSession = {
  id: 'session-1',
  serviceId: 'service-1',
  status: 'IN_PROGRESS',
  currentStep: 0,
  data: {},
  resolvedSteps: [
    { type: 'CLIENT_INFO', label: 'Your Details', order: 0 },
    { type: 'CONFIRMATION', label: 'Confirmation', order: 1 },
  ],
};

function BookingWizardHarness({
  isPreview = false,
  initial = initialSession,
}: {
  isPreview?: boolean;
  initial?: BookingSession;
}) {
  const [session, setSession] = useState(initial);

  return (
    <BookingWizard
      session={session}
      tenant={tenant}
      onSessionUpdate={setSession}
      onExit={() => undefined}
      isPreview={isPreview}
    />
  );
}

describe('BookingWizard completion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a booking before showing confirmation when payment is absent', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            ...initialSession,
            data: {
              guestName: 'Test Client',
              guestEmail: 'client@example.com',
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: 'booking-1' } }),
      } as Response);

    render(<BookingWizardHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Submit details' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3001/api/booking-sessions/session-1',
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      'http://localhost:3001/api/booking-sessions/session-1/complete',
      { method: 'POST' },
    ]);
    expect(await screen.findByText('Booking confirmed')).toBeInTheDocument();
  });

  it('does not show confirmation when booking creation fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: initialSession }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        text: async () => 'Reservation expired',
      } as Response);

    render(<BookingWizardHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Submit details' }));

    expect(await screen.findByText('Reservation expired')).toBeInTheDocument();
    expect(screen.queryByText('Booking confirmed')).not.toBeInTheDocument();
  });

  it('keeps preview mode free of real booking creation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { ...initialSession, currentStep: 1 },
      }),
    } as Response);

    render(<BookingWizardHarness isPreview />);
    await userEvent.click(screen.getByRole('button', { name: 'Submit details' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/complete');
    expect(await screen.findByText('Booking confirmed')).toBeInTheDocument();
  });

  it('does not use the unpaid completion endpoint when payment is required', async () => {
    const paymentSession: BookingSession = {
      ...initialSession,
      resolvedSteps: [
        { type: 'CLIENT_INFO', label: 'Your Details', order: 0 },
        { type: 'PAYMENT', label: 'Payment', order: 1 },
        { type: 'CONFIRMATION', label: 'Confirmation', order: 2 },
      ],
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { ...paymentSession, currentStep: 1 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { ...paymentSession, currentStep: 2 },
        }),
      } as Response);

    render(<BookingWizardHarness initial={paymentSession} />);
    await userEvent.click(screen.getByRole('button', { name: 'Submit details' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Complete payment' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.every(([url]) => !String(url).endsWith('/complete'))).toBe(true);
    expect(await screen.findByText('Booking confirmed')).toBeInTheDocument();
  });

  it('re-resolves the flow after selecting a service with its payment mode', async () => {
    const selectionSession: BookingSession = {
      ...initialSession,
      serviceId: null,
      resolvedSteps: [{ type: 'SERVICE_SELECTION', label: 'Service', order: 0 }],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          ...selectionSession,
          serviceId: 'service-online',
          data: {
            serviceId: 'service-online',
            paymentMode: 'FULL_ONLINE',
          },
          resolvedSteps: [
            { type: 'DATE_TIME_PICKER', label: 'Date', order: 0 },
            { type: 'PAYMENT', label: 'Payment', order: 1 },
            { type: 'CONFIRMATION', label: 'Confirmation', order: 2 },
          ],
        },
      }),
    } as Response);

    render(<BookingWizardHarness initial={selectionSession} />);
    await userEvent.click(screen.getByRole('button', { name: 'Select online service' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      serviceId: 'service-online',
      data: {
        serviceId: 'service-online',
        paymentMode: 'FULL_ONLINE',
      },
    });
  });
});
