import prisma from "../db.server";
import { toGid, fromGid } from "../lib/shopify-ids";

// =============================================================================
// Shopify Customer Sync Service
// =============================================================================
// Syncs CompanyContacts to Shopify Customer records for:
// - Payment method vaulting
// - Order attribution
// - B2B customer management

// Types
interface ShopifyAdmin {
  graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response>;
}

export interface CustomerPaymentMethod {
  id: string;
  instrument: {
    brand: string;
    lastDigits: string;
    expiryMonth: number;
    expiryYear: number;
    name: string | null;
  };
  subscriptionContracts: { totalCount: number };
}

export interface SyncedCustomer {
  id: string;
  shopifyCustomerId: string;
  firstName: string;
  lastName: string;
  email: string;
  paymentMethods: CustomerPaymentMethod[];
}

// GraphQL Mutations & Queries
const CUSTOMER_CREATE_MUTATION = `#graphql
  mutation CustomerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        email
        firstName
        lastName
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_UPDATE_MUTATION = `#graphql
  mutation CustomerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer {
        id
        email
        firstName
        lastName
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_QUERY = `#graphql
  query GetCustomer($id: ID!) {
    customer(id: $id) {
      id
      email
      firstName
      lastName
      phone
      paymentMethods(first: 10) {
        edges {
          node {
            id
            instrument {
              ... on CustomerCreditCard {
                brand
                lastDigits
                expiryMonth
                expiryYear
                name
              }
            }
            subscriptionContracts(first: 1) {
              totalCount
            }
          }
        }
      }
    }
  }
`;

const CUSTOMER_BY_EMAIL_QUERY = `#graphql
  query GetCustomerByEmail($email: String!) {
    customers(first: 1, query: $email) {
      edges {
        node {
          id
          email
          firstName
          lastName
        }
      }
    }
  }
`;

const CUSTOMER_PAYMENT_METHODS_QUERY = `#graphql
  query GetCustomerPaymentMethods($customerId: ID!) {
    customer(id: $customerId) {
      id
      paymentMethods(first: 10, showRevoked: false) {
        edges {
          node {
            id
            instrument {
              ... on CustomerCreditCard {
                brand
                lastDigits
                expiryMonth
                expiryYear
                name
              }
            }
          }
        }
      }
    }
  }
`;

// =============================================================================
// Customer Sync Functions
// =============================================================================

// Sync a contact to Shopify as a Customer
// Creates new customer if doesn't exist, returns existing if found
export async function syncContactToShopifyCustomer(
  contactId: string,
  admin: ShopifyAdmin
): Promise<{ success: true; shopifyCustomerId: string } | { success: false; error: string }> {
  const contact = await prisma.companyContact.findUnique({
    where: { id: contactId },
    include: {
      company: {
        select: { shopId: true },
      },
    },
  });

  if (!contact) {
    return { success: false, error: "Contact not found" };
  }

  // If already synced, verify and return
  if (contact.shopifyCustomerId) {
    // Verify customer still exists in Shopify (convert numeric ID to GID for query)
    const verified = await verifyShopifyCustomer(toGid("Customer", contact.shopifyCustomerId), admin);
    if (verified) {
      return { success: true, shopifyCustomerId: contact.shopifyCustomerId };
    }
    // Customer was deleted from Shopify, need to recreate
  }

  try {
    // Check if customer already exists by email
    const existingCustomer = await findCustomerByEmail(contact.email, admin);

    if (existingCustomer) {
      // Link to existing customer (extract numeric ID from GID)
      const numericCustomerId = fromGid(existingCustomer.id);
      await prisma.companyContact.update({
        where: { id: contactId },
        data: { shopifyCustomerId: numericCustomerId },
      });
      return { success: true, shopifyCustomerId: numericCustomerId };
    }

    // Create new customer
    const response = await admin.graphql(CUSTOMER_CREATE_MUTATION, {
      variables: {
        input: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone || undefined,
        },
      },
    });

    const result: {
      data?: {
        customerCreate?: {
          customer?: { id: string };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    } = await response.json();

    if (result.data?.customerCreate?.userErrors?.length) {
      const errors = result.data.customerCreate.userErrors;
      console.error("Customer create errors:", errors);
      return { success: false, error: errors.map((e) => e.message).join(", ") };
    }

    const shopifyCustomerGid = result.data?.customerCreate?.customer?.id;
    if (!shopifyCustomerGid) {
      return { success: false, error: "Failed to create customer in Shopify" };
    }

    // Extract numeric ID from GID for storage
    const shopifyCustomerId = fromGid(shopifyCustomerGid);

    // Update contact with Shopify customer ID (numeric)
    await prisma.companyContact.update({
      where: { id: contactId },
      data: { shopifyCustomerId },
    });

    console.log(`[Customer Sync] Created Shopify customer ${shopifyCustomerId} for contact ${contactId}`);

    return { success: true, shopifyCustomerId };
  } catch (error) {
    console.error("Error syncing contact to Shopify:", error);
    return { success: false, error: "Failed to sync contact to Shopify" };
  }
}

// Verify a Shopify customer still exists
async function verifyShopifyCustomer(
  shopifyCustomerId: string,
  admin: ShopifyAdmin
): Promise<boolean> {
  try {
    const response = await admin.graphql(CUSTOMER_QUERY, {
      variables: { id: shopifyCustomerId },
    });

    const result: { data?: { customer?: { id: string } } } = await response.json();
    return !!result.data?.customer?.id;
  } catch {
    return false;
  }
}

// Find customer by email
async function findCustomerByEmail(
  email: string,
  admin: ShopifyAdmin
): Promise<{ id: string; email: string } | null> {
  try {
    const response = await admin.graphql(CUSTOMER_BY_EMAIL_QUERY, {
      variables: { email: `email:${email}` },
    });

    const result: {
      data?: {
        customers?: {
          edges?: Array<{ node: { id: string; email: string } }>;
        };
      };
    } = await response.json();

    const customer = result.data?.customers?.edges?.[0]?.node;
    return customer || null;
  } catch {
    return null;
  }
}

// =============================================================================
// Payment Method Functions
// =============================================================================

// Get payment methods for a contact
export async function getContactPaymentMethods(
  contactId: string,
  admin: ShopifyAdmin
): Promise<{ success: true; paymentMethods: CustomerPaymentMethod[] } | { success: false; error: string }> {
  const contact = await prisma.companyContact.findUnique({
    where: { id: contactId },
  });

  if (!contact) {
    return { success: false, error: "Contact not found" };
  }

  if (!contact.shopifyCustomerId) {
    // Contact not synced to Shopify yet, no payment methods
    return { success: true, paymentMethods: [] };
  }

  return getCustomerPaymentMethods(contact.shopifyCustomerId, admin);
}

// Get payment methods for a Shopify customer
export async function getCustomerPaymentMethods(
  shopifyCustomerId: string,
  admin: ShopifyAdmin
): Promise<{ success: true; paymentMethods: CustomerPaymentMethod[] } | { success: false; error: string }> {
  try {
    const response = await admin.graphql(CUSTOMER_PAYMENT_METHODS_QUERY, {
      variables: { customerId: toGid("Customer", shopifyCustomerId) },
    });

    const result: {
      data?: {
        customer?: {
          paymentMethods?: {
            edges?: Array<{
              node: {
                id: string;
                instrument: {
                  brand: string;
                  lastDigits: string;
                  expiryMonth: number;
                  expiryYear: number;
                  name: string | null;
                };
              };
            }>;
          };
        };
      };
    } = await response.json();

    const paymentMethods: CustomerPaymentMethod[] =
      result.data?.customer?.paymentMethods?.edges?.map((edge) => ({
        id: edge.node.id,
        instrument: edge.node.instrument,
        subscriptionContracts: { totalCount: 0 },
      })) || [];

    return { success: true, paymentMethods };
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    return { success: false, error: "Failed to fetch payment methods" };
  }
}

// Get full customer details with payment methods
export async function getCustomerWithPaymentMethods(
  shopifyCustomerId: string,
  admin: ShopifyAdmin
): Promise<SyncedCustomer | null> {
  try {
    const response = await admin.graphql(CUSTOMER_QUERY, {
      variables: { id: toGid("Customer", shopifyCustomerId) },
    });

    const result: {
      data?: {
        customer?: {
          id: string;
          email: string;
          firstName: string;
          lastName: string;
          paymentMethods?: {
            edges?: Array<{
              node: CustomerPaymentMethod;
            }>;
          };
        };
      };
    } = await response.json();

    const customer = result.data?.customer;
    if (!customer) return null;

    return {
      id: customer.id,
      shopifyCustomerId: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      paymentMethods: customer.paymentMethods?.edges?.map((e) => e.node) || [],
    };
  } catch (error) {
    console.error("Error fetching customer:", error);
    return null;
  }
}

// =============================================================================
// Bulk Sync Functions
// =============================================================================

// Sync all contacts for a company to Shopify
export async function syncCompanyContactsToShopify(
  companyId: string,
  admin: ShopifyAdmin
): Promise<{ success: true; synced: number; failed: number } | { success: false; error: string }> {
  const contacts = await prisma.companyContact.findMany({
    where: { companyId, shopifyCustomerId: null },
  });

  let synced = 0;
  let failed = 0;

  for (const contact of contacts) {
    const result = await syncContactToShopifyCustomer(contact.id, admin);
    if (result.success) {
      synced++;
    } else {
      failed++;
      console.error(`Failed to sync contact ${contact.id}:`, result.error);
    }
  }

  return { success: true, synced, failed };
}
