import { prisma } from "@field-sales/database";
import { unauthenticated } from "../../../shopify.server";
import { processOrderWebhook, processDraftOrderWebhook } from "../../order.server";
import { handleSubscriptionUpdate, recordBillingEvent, cancelBilling } from "../../billing.server";
import {
  processCompanyWebhook,
  processCompanyLocationWebhook,
  processProductWebhook,
} from "../../webhook.server";
import { syncCompanyDetails, syncCustomerPaymentMethodsWebhook } from "../../companySync.server";
import { registerHandler, type JobHandler } from "../registry.server";

/**
 * Handlers for QueueJobKind.WEBHOOK. Each handler reads the QueueJob payload
 * (the original Shopify webhook payload + metadata), resolves the shop, and
 * delegates to the corresponding domain processor.
 *
 * Throws on failure → BullMQ retries per the WEBHOOK profile (5 attempts,
 * 1s exponential backoff). Permanent failures land in the FAILED bucket.
 */

interface WebhookJobPayload {
  shopDomain: string;
  topic: string;
  payload: Record<string, unknown>;
}

// ---- orders/* topics ----

const handleOrdersWebhook: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const result = await processOrderWebhook(
    data.shopDomain,
    data.topic,
    data.payload as unknown as Parameters<typeof processOrderWebhook>[2]
  );
  if (!result.success) {
    throw new Error(`processOrderWebhook failed: ${result.error}`);
  }
};

// ---- refunds/create ----

const handleRefundsCreate: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const refund = data.payload as {
    id?: number;
    order_id?: number;
    created_at?: string;
    transactions?: Array<{ amount?: string; kind?: string; status?: string }>;
  };

  if (!refund.order_id) return; // nothing to bill against

  const successfulRefunds = (refund.transactions ?? []).filter(
    (tx) => tx.kind === "refund" && tx.status === "success"
  );
  const refundDollars = successfulRefunds.reduce(
    (sum, tx) => sum + parseFloat(tx.amount ?? "0"),
    0
  );
  const refundCents = Math.round(refundDollars * 100);
  if (refundCents <= 0) return;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: data.shopDomain },
    select: { id: true },
  });
  if (!shop) return;

  const order = await prisma.order.findFirst({
    where: { shopId: shop.id, shopifyOrderId: String(refund.order_id) },
    select: { id: true },
  });
  if (!order) {
    // Shopify-native order — out of scope for our billing.
    return;
  }

  const occurredAt = refund.created_at ? new Date(refund.created_at) : new Date();
  await recordBillingEvent({
    shopId: shop.id,
    orderId: order.id,
    type: "REFUNDED",
    amountCents: refundCents,
    occurredAt,
    source: "webhook:refunds/create",
  });
};

// ---- draft_orders/update ----

const handleDraftOrderUpdate: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const result = await processDraftOrderWebhook(
    data.shopDomain,
    data.topic,
    data.payload as unknown as Parameters<typeof processDraftOrderWebhook>[2]
  );
  if (!result.success) {
    throw new Error(`processDraftOrderWebhook failed: ${result.error}`);
  }
};

// ---- app_subscriptions/* + app/uninstalled ----

const handleAppSubscriptionUpdate: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const result = await handleSubscriptionUpdate(
    data.shopDomain,
    data.payload as Parameters<typeof handleSubscriptionUpdate>[1]
  );
  if (!result.success) {
    throw new Error(`handleSubscriptionUpdate failed: ${result.error}`);
  }

  // Sync the usage line item id if the inline webhook handler used to do it.
  // Kept here to preserve behavior parity with the old inline path.
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: data.shopDomain },
    select: { id: true, usageLineItemId: true },
  });
  if (shop && !shop.usageLineItemId) {
    const { admin } = await unauthenticated.admin(data.shopDomain);
    const { syncUsageLineItemId } = await import("../../billing.server");
    await syncUsageLineItemId(admin, shop.id);
  }
};

const handleApproachingCap: JobHandler = async (job) => {
  // Just log for now — TODO: notify merchant + auto-bump cap.
  const data = job.payload as unknown as WebhookJobPayload;
  const sub = (data.payload as { app_subscription?: { capped_amount?: string; balance_used?: string } })
    .app_subscription;
  console.log(
    `[QueueWorker] Usage approaching cap for ${data.shopDomain}: ${sub?.balance_used} / ${sub?.capped_amount}`
  );
};

const handleAppUninstalled: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: data.shopDomain },
  });
  if (shop) {
    await cancelBilling(shop.id);
  }
};

// ---- companies/* ----

const handleCompanyWebhook: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const result = await processCompanyWebhook(data.shopDomain, data.topic, data.payload);
  if (!result.success) {
    throw new Error(`processCompanyWebhook failed: ${result.error}`);
  }
};

// ---- company_locations/* ----

const handleCompanyLocationWebhook: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const locationPayload = data.payload as { id?: number; company_id?: number };

  if (data.topic === "company_locations/delete") {
    const result = await processCompanyLocationWebhook(data.shopDomain, data.topic, data.payload);
    if (!result.success) {
      throw new Error(`processCompanyLocationWebhook failed: ${result.error}`);
    }
    return;
  }

  // Create/update — sync the entire company so we pick up payment terms etc.
  if (!locationPayload.company_id) {
    throw new Error("company_locations webhook missing company_id");
  }
  const result = await syncCompanyDetails(data.shopDomain, String(locationPayload.company_id));
  if (!result.success) {
    throw new Error(`syncCompanyDetails failed: ${result.error}`);
  }
};

// ---- company_contacts/* ----

const handleCompanyContactWebhook: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const contactPayload = data.payload as { id?: number; company_id?: number };
  const shopifyCompanyId = String(contactPayload.company_id ?? "");
  const shopifyContactId = String(contactPayload.id ?? "");

  if (data.topic === "company_contacts/delete") {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: data.shopDomain },
    });
    if (!shop) return;

    const company = await prisma.company.findFirst({
      where: { shopId: shop.id, shopifyCompanyId },
    });
    if (!company) return;

    await prisma.companyContact.deleteMany({
      where: { companyId: company.id, shopifyContactId },
    });
    return;
  }

  // Create/update — sync the entire company for full contact details.
  if (!shopifyCompanyId) {
    throw new Error("company_contacts webhook missing company_id");
  }
  const result = await syncCompanyDetails(data.shopDomain, shopifyCompanyId);
  if (!result.success) {
    throw new Error(`syncCompanyDetails failed: ${result.error}`);
  }
};

// ---- customer_payment_methods/* ----

const handleCustomerPaymentMethodWebhook: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const methodPayload = data.payload as { admin_graphql_api_customer_id?: string };
  const customerGid = methodPayload.admin_graphql_api_customer_id;
  const shopifyCustomerId = customerGid?.split("/").pop() || "";

  if (!shopifyCustomerId) {
    throw new Error("customer_payment_methods webhook missing customer id");
  }

  const result = await syncCustomerPaymentMethodsWebhook(data.shopDomain, shopifyCustomerId);
  if (!result.success) {
    throw new Error(`syncCustomerPaymentMethodsWebhook failed: ${result.error}`);
  }
};

// ---- products/* ----

const handleProductWebhook: JobHandler = async (job) => {
  const data = job.payload as unknown as WebhookJobPayload;
  const result = await processProductWebhook(data.shopDomain, data.topic, data.payload);
  if (!result.success) {
    throw new Error(`processProductWebhook failed: ${result.error}`);
  }
};

/**
 * Register every WEBHOOK topic handler. Called once at worker startup.
 */
export function registerWebhookHandlers(): void {
  // Orders
  registerHandler("WEBHOOK", "orders/paid", handleOrdersWebhook);
  registerHandler("WEBHOOK", "orders/cancelled", handleOrdersWebhook);
  registerHandler("WEBHOOK", "orders/updated", handleOrdersWebhook);
  registerHandler("WEBHOOK", "orders/create", handleOrdersWebhook);

  // Refunds
  registerHandler("WEBHOOK", "refunds/create", handleRefundsCreate);

  // Draft orders
  registerHandler("WEBHOOK", "draft_orders/update", handleDraftOrderUpdate);

  // Billing
  registerHandler("WEBHOOK", "app_subscriptions/update", handleAppSubscriptionUpdate);
  registerHandler("WEBHOOK", "app_subscriptions/approaching_capped_amount", handleApproachingCap);
  registerHandler("WEBHOOK", "app/uninstalled", handleAppUninstalled);

  // Companies
  registerHandler("WEBHOOK", "companies/create", handleCompanyWebhook);
  registerHandler("WEBHOOK", "companies/update", handleCompanyWebhook);
  registerHandler("WEBHOOK", "companies/delete", handleCompanyWebhook);

  // Company locations
  registerHandler("WEBHOOK", "company_locations/create", handleCompanyLocationWebhook);
  registerHandler("WEBHOOK", "company_locations/update", handleCompanyLocationWebhook);
  registerHandler("WEBHOOK", "company_locations/delete", handleCompanyLocationWebhook);

  // Company contacts
  registerHandler("WEBHOOK", "company_contacts/create", handleCompanyContactWebhook);
  registerHandler("WEBHOOK", "company_contacts/update", handleCompanyContactWebhook);
  registerHandler("WEBHOOK", "company_contacts/delete", handleCompanyContactWebhook);

  // Customer payment methods
  registerHandler("WEBHOOK", "customer_payment_methods/create", handleCustomerPaymentMethodWebhook);
  registerHandler("WEBHOOK", "customer_payment_methods/update", handleCustomerPaymentMethodWebhook);
  registerHandler("WEBHOOK", "customer_payment_methods/revoke", handleCustomerPaymentMethodWebhook);

  // Products
  registerHandler("WEBHOOK", "products/create", handleProductWebhook);
  registerHandler("WEBHOOK", "products/update", handleProductWebhook);
  registerHandler("WEBHOOK", "products/delete", handleProductWebhook);
}
