import { prisma } from "@field-sales/database";
import { toGid, fromGid } from "../lib/shopify-ids";
import { unauthenticated } from "../shopify.server";
import { syncCompanyLocationCatalogs } from "./catalog.server";

/**
 * GraphQL query to fetch full company details including:
 * - Contacts with their linked customers
 * - Locations with payment terms (buyerExperienceConfiguration)
 */
const COMPANY_FULL_DETAILS_QUERY = `#graphql
  query GetCompanyFullDetails($id: ID!) {
    company(id: $id) {
      id
      name
      externalId
      contacts(first: 50) {
        edges {
          node {
            id
            isMainContact
            customer {
              id
              firstName
              lastName
              email
              phone
            }
          }
        }
      }
      locations(first: 50) {
        edges {
          node {
            id
            name
            externalId
            phone
            shippingAddress {
              address1
              address2
              city
              zoneCode
              zip
              countryCode
            }
            billingAddress {
              address1
              address2
              city
              zoneCode
              zip
              countryCode
            }
            buyerExperienceConfiguration {
              paymentTermsTemplate {
                name
                dueInDays
                paymentTermsType
              }
              checkoutToDraft
            }
          }
        }
      }
    }
  }
`;

/**
 * GraphQL query to fetch customer payment methods
 */
const CUSTOMER_PAYMENT_METHODS_QUERY = `#graphql
  query GetCustomerPaymentMethods($customerId: ID!) {
    customer(id: $customerId) {
      id
      paymentMethods(first: 10) {
        edges {
          node {
            id
            revokedAt
            instrument {
              ... on CustomerCreditCard {
                brand
                lastDigits
                expiryMonth
                expiryYear
                isRevocable
              }
              ... on CustomerShopPayAgreement {
                isRevocable
              }
            }
          }
        }
      }
    }
  }
`;

interface CompanyDetailsResponse {
  data: {
    company: {
      id: string;
      name: string;
      externalId: string | null;
      contacts: {
        edges: Array<{
          node: {
            id: string;
            isMainContact: boolean;
            customer: {
              id: string;
              firstName: string | null;
              lastName: string | null;
              email: string | null;
              phone: string | null;
            } | null;
          };
        }>;
      };
      locations: {
        edges: Array<{
          node: {
            id: string;
            name: string;
            externalId: string | null;
            phone: string | null;
            shippingAddress: ShopifyAddress | null;
            billingAddress: ShopifyAddress | null;
            buyerExperienceConfiguration: {
              paymentTermsTemplate: {
                name: string;
                dueInDays: number | null;
                paymentTermsType: string;
              } | null;
              checkoutToDraft: boolean;
            } | null;
          };
        }>;
      };
    } | null;
  };
}

interface ShopifyAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  zoneCode: string | null;
  zip: string | null;
  countryCode: string | null;
}

interface PaymentMethodsResponse {
  data: {
    customer: {
      id: string;
      paymentMethods: {
        edges: Array<{
          node: {
            id: string;
            revokedAt: string | null;
            instrument: {
              brand?: string;
              lastDigits?: string;
              expiryMonth?: number;
              expiryYear?: number;
              isRevocable?: boolean;
            } | null;
          };
        }>;
      };
    } | null;
  };
}

/**
 * Sync full company details including contacts, locations, and payment info
 * Called when company webhook is received
 */
export async function syncCompanyDetails(
  shopDomain: string,
  shopifyCompanyId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
    });

    if (!shop) {
      return { success: false, error: "Shop not found" };
    }

    // Get admin client for this shop
    const { admin } = await unauthenticated.admin(shopDomain);

    // Fetch full company details from Shopify
    const response = await admin.graphql(COMPANY_FULL_DETAILS_QUERY, {
      variables: { id: toGid("Company", shopifyCompanyId) },
    });

    const result = (await response.json()) as CompanyDetailsResponse;
    const companyData = result.data?.company;

    if (!companyData) {
      return { success: false, error: "Company not found in Shopify" };
    }

    // Find or create company in our database
    const company = await prisma.company.upsert({
      where: {
        shopId_shopifyCompanyId: {
          shopId: shop.id,
          shopifyCompanyId,
        },
      },
      create: {
        shopId: shop.id,
        shopifyCompanyId,
        name: companyData.name,
        accountNumber: companyData.externalId,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
        isActive: true,
      },
      update: {
        name: companyData.name,
        accountNumber: companyData.externalId || undefined,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
        isActive: true,
      },
    });

    // Sync contacts
    const existingContacts = await prisma.companyContact.findMany({
      where: { companyId: company.id },
      select: { shopifyContactId: true },
    });
    const existingContactIds = new Set(existingContacts.map((c) => c.shopifyContactId).filter(Boolean));
    const incomingContactIds = new Set<string>();

    for (const edge of companyData.contacts.edges) {
      const contact = edge.node;
      const shopifyContactId = fromGid(contact.id);
      incomingContactIds.add(shopifyContactId);

      const shopifyCustomerId = contact.customer ? fromGid(contact.customer.id) : null;

      await prisma.companyContact.upsert({
        where: {
          companyId_shopifyContactId: {
            companyId: company.id,
            shopifyContactId,
          },
        },
        create: {
          companyId: company.id,
          shopifyContactId,
          shopifyCustomerId,
          firstName: contact.customer?.firstName || "Unknown",
          lastName: contact.customer?.lastName || "",
          email: contact.customer?.email || `contact-${shopifyContactId}@placeholder.local`,
          phone: contact.customer?.phone,
          isPrimary: contact.isMainContact,
        },
        update: {
          shopifyCustomerId,
          firstName: contact.customer?.firstName || "Unknown",
          lastName: contact.customer?.lastName || "",
          email: contact.customer?.email || undefined,
          phone: contact.customer?.phone,
          isPrimary: contact.isMainContact,
        },
      });

      // Sync payment methods for this contact's customer
      if (shopifyCustomerId) {
        await syncCustomerPaymentMethods(admin, shop.id, company.id, shopifyContactId, shopifyCustomerId);
      }
    }

    // Remove contacts that no longer exist in Shopify
    const contactsToDelete = [...existingContactIds].filter(
      (id) => id && !incomingContactIds.has(id)
    );
    if (contactsToDelete.length > 0) {
      await prisma.companyContact.deleteMany({
        where: {
          companyId: company.id,
          shopifyContactId: { in: contactsToDelete as string[] },
        },
      });
    }

    // Sync locations with payment terms
    const existingLocations = await prisma.companyLocation.findMany({
      where: { companyId: company.id },
      select: { shopifyLocationId: true },
    });
    const existingLocationIds = new Set(existingLocations.map((l) => l.shopifyLocationId).filter(Boolean));
    const incomingLocationIds = new Set<string>();

    for (const edge of companyData.locations.edges) {
      const location = edge.node;
      const shopifyLocationId = fromGid(location.id);
      incomingLocationIds.add(shopifyLocationId);

      const address = location.shippingAddress || location.billingAddress;
      const paymentTerms = location.buyerExperienceConfiguration?.paymentTermsTemplate;

      const companyLocation = await prisma.companyLocation.upsert({
        where: {
          companyId_shopifyLocationId: {
            companyId: company.id,
            shopifyLocationId,
          },
        },
        create: {
          companyId: company.id,
          shopifyLocationId,
          name: location.name,
          address1: address?.address1,
          address2: address?.address2,
          city: address?.city,
          province: address?.zoneCode,
          provinceCode: address?.zoneCode,
          zipcode: address?.zip,
          country: address?.countryCode || "US",
          countryCode: address?.countryCode || "US",
          phone: location.phone,
          isShippingAddress: !!location.shippingAddress,
          isBillingAddress: !!location.billingAddress,
          isPrimary: false,
          // Payment terms from Shopify B2B
          paymentTermsType: paymentTerms?.paymentTermsType || null,
          paymentTermsDays: paymentTerms?.dueInDays || null,
          checkoutToDraft: location.buyerExperienceConfiguration?.checkoutToDraft || false,
        },
        update: {
          name: location.name,
          address1: address?.address1,
          address2: address?.address2,
          city: address?.city,
          province: address?.zoneCode,
          provinceCode: address?.zoneCode,
          zipcode: address?.zip,
          country: address?.countryCode || "US",
          countryCode: address?.countryCode || "US",
          phone: location.phone,
          isShippingAddress: !!location.shippingAddress,
          isBillingAddress: !!location.billingAddress,
          // Payment terms from Shopify B2B
          paymentTermsType: paymentTerms?.paymentTermsType || null,
          paymentTermsDays: paymentTerms?.dueInDays || null,
          checkoutToDraft: location.buyerExperienceConfiguration?.checkoutToDraft || false,
        },
      });

      // Sync catalogs for this location (B2B pricing)
      await syncCompanyLocationCatalogs(shop.id, companyLocation.id, shopifyLocationId, admin);
    }

    // Remove locations that no longer exist in Shopify
    const locationsToDelete = [...existingLocationIds].filter(
      (id) => id && !incomingLocationIds.has(id)
    );
    if (locationsToDelete.length > 0) {
      await prisma.companyLocation.deleteMany({
        where: {
          companyId: company.id,
          shopifyLocationId: { in: locationsToDelete as string[] },
        },
      });
    }

    console.log(`[CompanySync] Synced company ${shopifyCompanyId}: ${companyData.contacts.edges.length} contacts, ${companyData.locations.edges.length} locations`);
    return { success: true };
  } catch (error) {
    console.error(`[CompanySync] Error syncing company ${shopifyCompanyId}:`, error);
    return { success: false, error: String(error) };
  }
}

/**
 * Sync payment methods for a customer
 */
async function syncCustomerPaymentMethods(
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
  shopId: string,
  companyId: string,
  shopifyContactId: string,
  shopifyCustomerId: string
): Promise<void> {
  try {
    const response = await admin.graphql(CUSTOMER_PAYMENT_METHODS_QUERY, {
      variables: { customerId: toGid("Customer", shopifyCustomerId) },
    });

    const result = (await response.json()) as PaymentMethodsResponse;
    const paymentMethods = result.data?.customer?.paymentMethods?.edges || [];

    // Get contact ID
    const contact = await prisma.companyContact.findFirst({
      where: {
        companyId,
        shopifyContactId,
      },
      select: { id: true },
    });

    if (!contact) return;

    // Get existing payment methods
    const existingMethods = await prisma.paymentMethod.findMany({
      where: { contactId: contact.id },
      select: { externalMethodId: true },
    });
    const existingMethodIds = new Set(existingMethods.map((m) => m.externalMethodId));
    const incomingMethodIds = new Set<string>();

    for (const edge of paymentMethods) {
      const method = edge.node;
      const externalMethodId = fromGid(method.id);
      incomingMethodIds.add(externalMethodId);

      // Skip revoked payment methods
      if (method.revokedAt) continue;

      const instrument = method.instrument;
      if (!instrument) continue;

      await prisma.paymentMethod.upsert({
        where: {
          shopId_companyId_externalMethodId: {
            shopId,
            companyId,
            externalMethodId,
          },
        },
        create: {
          shopId,
          companyId,
          contactId: contact.id,
          provider: "SHOPIFY_VAULT",
          externalMethodId,
          brand: instrument.brand || null,
          last4: instrument.lastDigits || null,
          expiryMonth: instrument.expiryMonth || null,
          expiryYear: instrument.expiryYear || null,
          isDefault: false,
          isActive: true,
        },
        update: {
          brand: instrument.brand || null,
          last4: instrument.lastDigits || null,
          expiryMonth: instrument.expiryMonth || null,
          expiryYear: instrument.expiryYear || null,
          isActive: true,
        },
      });
    }

    // Mark removed/revoked payment methods as inactive
    const methodsToDeactivate = [...existingMethodIds].filter(
      (id) => !incomingMethodIds.has(id)
    );
    if (methodsToDeactivate.length > 0) {
      await prisma.paymentMethod.updateMany({
        where: {
          contactId: contact.id,
          externalMethodId: { in: methodsToDeactivate },
        },
        data: { isActive: false },
      });
    }
  } catch (error) {
    console.error(`[CompanySync] Error syncing payment methods for customer ${shopifyCustomerId}:`, error);
  }
}

/**
 * Sync a single contact when company_contacts webhook is received
 */
export async function syncCompanyContact(
  shopDomain: string,
  shopifyCompanyId: string,
  shopifyContactId: string
): Promise<{ success: boolean; error?: string }> {
  // For simplicity, re-sync the entire company to ensure consistency
  return syncCompanyDetails(shopDomain, shopifyCompanyId);
}

/**
 * Handle customer_payment_methods webhook
 * Finds the contact linked to this customer and syncs their payment methods
 */
export async function syncCustomerPaymentMethodsWebhook(
  shopDomain: string,
  shopifyCustomerId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
    });

    if (!shop) {
      return { success: false, error: "Shop not found" };
    }

    // Find contacts linked to this customer
    const contacts = await prisma.companyContact.findMany({
      where: {
        shopifyCustomerId,
        company: { shopId: shop.id },
      },
      include: {
        company: { select: { id: true, shopifyCompanyId: true } },
      },
    });

    if (contacts.length === 0) {
      console.log(`[PaymentMethodSync] No contacts found for customer ${shopifyCustomerId}`);
      return { success: true };
    }

    // Get admin client
    const { admin } = await unauthenticated.admin(shopDomain);

    // Sync payment methods for each contact
    for (const contact of contacts) {
      if (contact.shopifyContactId) {
        await syncCustomerPaymentMethods(
          admin,
          shop.id,
          contact.company.id,
          contact.shopifyContactId,
          shopifyCustomerId
        );
      }
    }

    console.log(`[PaymentMethodSync] Synced payment methods for customer ${shopifyCustomerId}`);
    return { success: true };
  } catch (error) {
    console.error(`[PaymentMethodSync] Error:`, error);
    return { success: false, error: String(error) };
  }
}
