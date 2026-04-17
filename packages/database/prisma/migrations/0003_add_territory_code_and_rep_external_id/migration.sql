-- Add optional territory code field
ALTER TABLE "territories" ADD COLUMN "code" TEXT;

-- Add optional external ID field for sales reps
ALTER TABLE "sales_reps" ADD COLUMN "external_id" TEXT;

-- Add metafields setup tracking for shops
ALTER TABLE "shops" ADD COLUMN "metafields_setup_at" TIMESTAMP(3);
