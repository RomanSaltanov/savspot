CREATE TYPE "ServicePaymentMode" AS ENUM (
  'PAY_AT_VENUE',
  'FULL_ONLINE',
  'DEPOSIT_ONLINE'
);

ALTER TABLE "services"
ADD COLUMN "payment_mode" "ServicePaymentMode" NOT NULL DEFAULT 'PAY_AT_VENUE';
