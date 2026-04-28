import { prisma } from "@field-sales/database";
import { unauthenticated } from "../shopify.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables: Record<string, unknown> }
  ) => Promise<Response>;
};

export interface DuePaymentsResult {
  processed: number;
  successful: number;
  charged: number;
  invoiced: number;
  results: Array<{
    orderId: string;
    orderNumber: string;
    shop: string;
    action: "charged" | "invoice_sent" | "skipped";
    success: boolean;
    error?: string;
  }>;
}

/**
 * Sweeps PENDING orders that need payment processing and either charges the
 * vaulted card (if one is on the order) or emails an invoice. Idempotent:
 * status flips to PAID after a successful charge so a re-run skips it.
 *
 * Picks up:
 *   - Orders with `paymentDueDate <= now` (NET_X terms hitting due)
 *   - DUE_ON_ORDER orders with no card and no invoice yet (rep approved
 *     without picking a card; default-card resolution failed at approval)
 */
export async function processDuePayments(now: Date = new Date()): Promise<DuePaymentsResult> {
  const dueOrders = await prisma.order.findMany({
    where: {
      status: "PENDING",
      paidAt: null,
      OR: [
        { paymentDueDate: { lte: now } },
        {
          paymentTerms: "DUE_ON_ORDER",
          paymentMethodId: null,
          shopifyInvoiceId: null,
        },
      ],
    },
    include: {
      shop: { select: { id: true, shopifyDomain: true } },
      contact: { select: { email: true } },
    },
  });

  const results: DuePaymentsResult["results"] = [];

  // Group by shop so we authenticate once per tenant.
  const ordersByShop = dueOrders.reduce((acc, order) => {
    const domain = order.shop.shopifyDomain;
    if (!acc[domain]) acc[domain] = [];
    acc[domain].push(order);
    return acc;
  }, {} as Record<string, typeof dueOrders>);

  for (const [shopDomain, orders] of Object.entries(ordersByShop)) {
    let admin: ShopifyAdmin;
    try {
      ({ admin } = await unauthenticated.admin(shopDomain));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      for (const order of orders) {
        results.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          shop: shopDomain,
          action: "skipped",
          success: false,
          error: `Failed to authenticate shop: ${message}`,
        });
      }
      continue;
    }

    for (const order of orders) {
      try {
        if (order.paymentMethodId) {
          const chargeResult = await chargeVaultedCard(
            admin,
            order.shopifyOrderId!,
            order.paymentMethodId
          );

          if (chargeResult.success) {
            await prisma.order.update({
              where: { id: order.id },
              data: { status: "PAID", paidAt: new Date() },
            });
            results.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              shop: shopDomain,
              action: "charged",
              success: true,
            });
          } else {
            // Card charge failed — invoice as fallback so the merchant still
            // gets paid through Shopify's hosted checkout.
            const invoiceResult = await sendPaymentInvoice(
              admin,
              order.shopifyDraftOrderId!,
              order.contact?.email
            );
            await prisma.order.update({
              where: { id: order.id },
              data: { shopifyInvoiceId: invoiceResult.invoiceId },
            });
            results.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              shop: shopDomain,
              action: "invoice_sent",
              success: true,
              error: `Card charge failed: ${chargeResult.error}. Invoice sent as fallback.`,
            });
          }
        } else {
          if (!order.contact?.email) {
            results.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              shop: shopDomain,
              action: "skipped",
              success: false,
              error: "No contact email for invoice",
            });
            continue;
          }

          const invoiceResult = await sendPaymentInvoice(
            admin,
            order.shopifyDraftOrderId!,
            order.contact.email
          );
          if (invoiceResult.success) {
            await prisma.order.update({
              where: { id: order.id },
              data: { shopifyInvoiceId: invoiceResult.invoiceId },
            });
            results.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              shop: shopDomain,
              action: "invoice_sent",
              success: true,
            });
          } else {
            results.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              shop: shopDomain,
              action: "invoice_sent",
              success: false,
              error: invoiceResult.error,
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`[processDuePayments] order ${order.orderNumber}:`, error);
        results.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          shop: shopDomain,
          action: "skipped",
          success: false,
          error: message,
        });
      }
    }
  }

  const successful = results.filter((r) => r.success).length;
  const charged = results.filter((r) => r.action === "charged" && r.success).length;
  const invoiced = results.filter((r) => r.action === "invoice_sent" && r.success).length;

  return { processed: dueOrders.length, successful, charged, invoiced, results };
}

async function chargeVaultedCard(
  admin: ShopifyAdmin,
  shopifyOrderId: string,
  paymentMethodId: string
): Promise<{ success: boolean; error?: string }> {
  const paymentMethod = await prisma.paymentMethod.findUnique({
    where: { id: paymentMethodId },
    select: { externalMethodId: true, isActive: true },
  });

  if (!paymentMethod) return { success: false, error: "Payment method not found" };
  if (!paymentMethod.isActive) return { success: false, error: "Payment method is no longer active" };

  try {
    const idempotencyKey = `cron_${shopifyOrderId}_${Date.now()}`;

    const response = await admin.graphql(
      `
      mutation OrderCreateMandatePayment(
        $id: ID!
        $paymentMethodId: ID!
        $idempotencyKey: String!
        $autoCapture: Boolean
      ) {
        orderCreateMandatePayment(
          id: $id
          paymentMethodId: $paymentMethodId
          idempotencyKey: $idempotencyKey
          autoCapture: $autoCapture
        ) {
          job { id done }
          paymentReferenceId
          userErrors { field message code }
        }
      }
      `,
      {
        variables: {
          id: `gid://shopify/Order/${shopifyOrderId}`,
          paymentMethodId: `gid://shopify/CustomerPaymentMethod/${paymentMethod.externalMethodId}`,
          idempotencyKey,
          autoCapture: true,
        },
      }
    );

    const data = (await response.json()) as {
      data?: {
        orderCreateMandatePayment?: {
          paymentReferenceId?: string;
          job?: { id: string };
          userErrors?: Array<{ message: string }>;
        };
      };
    };
    const result = data.data?.orderCreateMandatePayment;

    if (result?.userErrors?.length) {
      return {
        success: false,
        error: result.userErrors.map((e) => e.message).join(", "),
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function sendPaymentInvoice(
  admin: ShopifyAdmin,
  shopifyDraftOrderId: string,
  email?: string | null
): Promise<{ success: boolean; invoiceId?: string; error?: string }> {
  if (!shopifyDraftOrderId) {
    return { success: false, error: "No draft order ID for invoice" };
  }

  try {
    const response = await admin.graphql(
      `
      mutation draftOrderInvoiceSend($id: ID!, $email: EmailInput) {
        draftOrderInvoiceSend(id: $id, email: $email) {
          draftOrder { id invoiceUrl }
          userErrors { field message }
        }
      }
      `,
      {
        variables: {
          id: `gid://shopify/DraftOrder/${shopifyDraftOrderId}`,
          email: email ? { to: email } : undefined,
        },
      }
    );

    const data = (await response.json()) as {
      data?: {
        draftOrderInvoiceSend?: {
          draftOrder?: { invoiceUrl?: string };
          userErrors?: Array<{ message: string }>;
        };
      };
    };
    const result = data.data?.draftOrderInvoiceSend;

    if (result?.userErrors?.length) {
      return {
        success: false,
        error: result.userErrors.map((e) => e.message).join(", "),
      };
    }

    return { success: true, invoiceId: result?.draftOrder?.invoiceUrl };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
