-- CreateEnum
CREATE TYPE "BillingEventType" AS ENUM ('PAID', 'REFUNDED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "QueueJobKind" AS ENUM ('WEBHOOK', 'API', 'FILE_IMPORT', 'ACTION');

-- CreateEnum
CREATE TYPE "QueueJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "LeadFieldType" ADD VALUE 'address';

-- DropIndex
DROP INDEX "shops_app_api_key_idx";

-- AlterTable
ALTER TABLE "catalog_items" ADD COLUMN     "quantity_increment" INTEGER,
ADD COLUMN     "quantity_max" INTEGER,
ADD COLUMN     "quantity_min" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paid_amount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refunded_amount_cents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "catalog_item_price_breaks" (
    "id" TEXT NOT NULL,
    "catalog_item_id" TEXT NOT NULL,
    "minimum_quantity" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_item_price_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_id" TEXT,
    "type" "BillingEventType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "billing_period_id" TEXT,
    "shopify_usage_record_id" TEXT,
    "reported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_jobs" (
    "id" TEXT NOT NULL,
    "kind" "QueueJobKind" NOT NULL,
    "topic" TEXT NOT NULL,
    "shop_id" TEXT,
    "idempotency_key" TEXT,
    "payload" JSONB NOT NULL,
    "status" "QueueJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "source" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "queue_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_item_price_breaks_catalog_item_id_idx" ON "catalog_item_price_breaks"("catalog_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_item_price_breaks_catalog_item_id_minimum_quantity_key" ON "catalog_item_price_breaks"("catalog_item_id", "minimum_quantity");

-- CreateIndex
CREATE INDEX "billing_events_shop_id_occurred_at_idx" ON "billing_events"("shop_id", "occurred_at");

-- CreateIndex
CREATE INDEX "billing_events_shop_id_reported_at_idx" ON "billing_events"("shop_id", "reported_at");

-- CreateIndex
CREATE INDEX "billing_events_billing_period_id_idx" ON "billing_events"("billing_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_shop_id_order_id_type_occurred_at_key" ON "billing_events"("shop_id", "order_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "queue_jobs_status_received_at_idx" ON "queue_jobs"("status", "received_at");

-- CreateIndex
CREATE INDEX "queue_jobs_shop_id_kind_status_idx" ON "queue_jobs"("shop_id", "kind", "status");

-- CreateIndex
CREATE INDEX "queue_jobs_kind_status_idx" ON "queue_jobs"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "queue_jobs_kind_topic_idempotency_key_key" ON "queue_jobs"("kind", "topic", "idempotency_key");

-- AddForeignKey
ALTER TABLE "catalog_item_price_breaks" ADD CONSTRAINT "catalog_item_price_breaks_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_billing_period_id_fkey" FOREIGN KEY ("billing_period_id") REFERENCES "billing_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_jobs" ADD CONSTRAINT "queue_jobs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
