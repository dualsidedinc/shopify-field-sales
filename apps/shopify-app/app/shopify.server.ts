import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "@field-sales/database";

const prismaSessionStorage = new PrismaSessionStorage(prisma);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: prismaSessionStorage,
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  webhooks: {
    // App lifecycle webhooks
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    APP_SCOPES_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/scopes_update",
    },
    // Company webhooks (for managed companies sync)
    COMPANIES_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/companies",
    },
    COMPANIES_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/companies",
    },
    COMPANIES_DELETE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/companies",
    },
    COMPANY_LOCATIONS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/company-locations",
    },
    COMPANY_LOCATIONS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/company-locations",
    },
    COMPANY_LOCATIONS_DELETE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/company-locations",
    },
    // Order webhooks (for payment status sync)
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders",
    },
    ORDERS_PAID: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders",
    },
    ORDERS_UPDATED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders",
    },
    ORDERS_CANCELLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders",
    },
    // Draft order webhooks (for draft -> order conversion)
    DRAFT_ORDERS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/draft-orders",
    },
    // Billing webhooks (for usage billing)
    APP_SUBSCRIPTIONS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/billing",
    },
    SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/billing",
    },
    SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/billing",
    },
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // Provision or update shop on successful OAuth
      console.log(`[Shop Provisioning] Processing auth for shop: ${session.shop}`);

      if (!session.accessToken) {
        console.error(`[Shop Provisioning] No access token for ${session.shop}`);
        return;
      }

      try {
        // Query shop info and plan details from Shopify
        const { shopData, hasManagedCompanies, planName } = await detectShopCapabilities(admin, {
          shop: session.shop,
          accessToken: session.accessToken,
        });

        // Upsert shop record
        await prisma.shop.upsert({
          where: { shopifyDomain: session.shop },
          update: {
            accessToken: session.accessToken!,
            scopes: session.scope || "",
            shopName: shopData?.name || session.shop,
            hasManagedCompanies,
            shopifyPlan: planName,
            planDetectedAt: new Date(),
            isActive: true,
          },
          create: {
            shopifyDomain: session.shop,
            accessToken: session.accessToken!,
            scopes: session.scope || "",
            shopName: shopData?.name || session.shop,
            hasManagedCompanies,
            shopifyPlan: planName,
            planDetectedAt: new Date(),
            isActive: true,
          },
        });

        console.log(`[Shop Provisioning] Successfully provisioned shop for: ${session.shop} (hasManagedCompanies: ${hasManagedCompanies}, plan: ${planName})`);

        // Register webhooks for company sync, orders, etc.
        // This will be expanded in Sprint 2
      } catch (error) {
        console.error(`[Shop Provisioning] Failed for ${session.shop}:`, error);
        // Don't throw - allow the auth flow to continue
        // The shop can be provisioned later
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

// GraphQL query to detect shop plan and existing companies
const SHOP_CAPABILITIES_QUERY = `#graphql
  query ShopCapabilities {
    shop {
      name
      email
      myshopifyDomain
      plan {
        displayName
        shopifyPlus
      }
    }
    companies(first: 1) {
      edges {
        node {
          id
        }
      }
    }
  }
`;

interface ShopCapabilitiesResult {
  shopData: { name: string; email: string; domain: string } | null;
  hasManagedCompanies: boolean;
  planName: string | null;
}

// Detect shop capabilities including plan and managed companies
async function detectShopCapabilities(
  admin: { graphql: (query: string) => Promise<Response> },
  session: { shop: string; accessToken: string }
): Promise<ShopCapabilitiesResult> {
  try {
    const response = await admin.graphql(SHOP_CAPABILITIES_QUERY);
    const { data } = await response.json();

    const shop = data?.shop;
    const planInfo = shop?.plan;
    const hasExistingCompanies = (data?.companies?.edges?.length || 0) > 0;

    // Shop has managed companies if:
    // 1. It's Shopify Plus (shopifyPlus flag is true), OR
    // 2. It already has companies in Shopify (even if not Plus)
    const hasManagedCompanies = planInfo?.shopifyPlus || hasExistingCompanies;

    console.log(`[Shop Capabilities] Plan: ${planInfo?.displayName}, Plus: ${planInfo?.shopifyPlus}, Has Companies: ${hasExistingCompanies}`);

    return {
      shopData: shop ? {
        name: shop.name,
        email: shop.email,
        domain: shop.myshopifyDomain,
      } : null,
      hasManagedCompanies,
      planName: planInfo?.displayName || null,
    };
  } catch (error) {
    console.error("Error detecting shop capabilities:", error);
    // Fall back to REST API for basic shop data
    const shopData = await fetchShopDataREST(session);
    return {
      shopData,
      hasManagedCompanies: false, // Default to internal companies if detection fails
      planName: null,
    };
  }
}

// Fallback: Fetch shop name from Shopify REST API
async function fetchShopDataREST(session: { shop: string; accessToken: string }) {
  try {
    const response = await fetch(
      `https://${session.shop}/admin/api/2026-01/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch shop data: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.shop as { name: string; email: string; domain: string };
  } catch (error) {
    console.error("Error fetching shop data:", error);
    return null;
  }
}

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
