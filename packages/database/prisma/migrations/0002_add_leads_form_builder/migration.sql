-- CreateEnum
CREATE TYPE "LeadFieldType" AS ENUM ('text', 'select', 'checkbox', 'textarea');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'reviewed', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "lead_form_fields" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "LeadFieldType" NOT NULL,
    "placeholder" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "form_data" JSONB NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "review_notes" TEXT,
    "converted_company_id" TEXT,
    "converted_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_form_fields_shop_id_is_active_position_idx" ON "lead_form_fields"("shop_id", "is_active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lead_form_fields_shop_id_name_key" ON "lead_form_fields"("shop_id", "name");

-- CreateIndex
CREATE INDEX "leads_shop_id_status_idx" ON "leads"("shop_id", "status");

-- CreateIndex
CREATE INDEX "leads_shop_id_submitted_at_idx" ON "leads"("shop_id", "submitted_at");

-- AddForeignKey
ALTER TABLE "lead_form_fields" ADD CONSTRAINT "lead_form_fields_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
