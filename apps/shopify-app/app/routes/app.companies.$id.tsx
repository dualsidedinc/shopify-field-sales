import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useActionData, Form, useFetcher } from "react-router";
import { useState, useCallback, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { prisma } from "@field-sales/database";
import { toGid } from "../lib/shopify-ids";
import { SalesRepPicker, type SalesRep, type TerritoryRep } from "../components/SalesRepPicker";
import { Modal } from "../components/Modal";

interface Location {
  id: string;
  name: string;
  address1: string | null;
  city: string | null;
  provinceCode: string | null;
  zipcode: string | null;
  isPrimary: boolean;
  territoryId: string | null;
  territoryName: string | null;
  territoryRepName: string | null;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  isPrimary: boolean;
  shopifyCustomerId: string | null;
  hasPaymentMethods: boolean;
}

interface PaymentMethod {
  id: string;
  contactId: string;
  contactName: string;
  contactEmail: string;
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
  isActive: boolean;
}

interface LoaderSalesRep {
  id: string;
  name: string;
}

interface CompanyData {
  id: string;
  name: string;
  accountNumber: string | null;
  paymentTerms: string;
  shopifyPaymentTerms: string | null; // Payment terms from Shopify for managed companies
  assignedRepId: string | null;
  assignedRepName: string | null;
  territoryReps: TerritoryRep[]; // Reps derived from location/territory assignments
  isActive: boolean;
  isShopifyManaged: boolean;
  shopifyCompanyId: string | null;
  locations: Location[];
  contacts: Contact[];
  paymentMethods: PaymentMethod[];
}

interface LoaderData {
  company: CompanyData | null;
  reps: LoaderSalesRep[];
  shopId: string | null;
}

interface ActionData {
  success?: boolean;
  error?: string;
  deleted?: boolean;
  paymentMethodRemoved?: boolean;
  paymentMethodEmailSent?: boolean;
  accountActivationUrl?: string;
  contactName?: string;
}

// GraphQL mutation to generate customer account activation URL
// This gives customers access to their account where they can add payment methods
const CUSTOMER_ACCOUNT_ACTIVATION_URL_MUTATION = `#graphql
  mutation customerGenerateAccountActivationUrl($customerId: ID!) {
    customerGenerateAccountActivationUrl(customerId: $customerId) {
      accountActivationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

interface CustomerAccountActivationUrlResponse {
  data: {
    customerGenerateAccountActivationUrl: {
      accountActivationUrl: string | null;
      userErrors: Array<{ field: string; message: string }>;
    } | null;
  };
}


// GraphQL query to fetch payment terms from Shopify company
const COMPANY_PAYMENT_TERMS_QUERY = `#graphql
  query GetCompanyPaymentTerms($id: ID!) {
    company(id: $id) {
      id
      locations(first: 1) {
        edges {
          node {
            buyerExperienceConfiguration {
              paymentTermsTemplate {
                name
                dueInDays
                paymentTermsType
              }
            }
          }
        }
      }
    }
  }
`;

interface ShopifyPaymentTermsResponse {
  data: {
    company: {
      id: string;
      locations: {
        edges: Array<{
          node: {
            buyerExperienceConfiguration: {
              paymentTermsTemplate: {
                name: string;
                dueInDays: number | null;
                paymentTermsType: string;
              } | null;
            } | null;
          };
        }>;
      };
    } | null;
  };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const companyId = params.id;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop || !companyId) {
    return { company: null, territories: [], reps: [], shopId: null };
  }

  const [company, reps, paymentMethods] = await Promise.all([
    prisma.company.findFirst({
      where: {
        id: companyId,
        shopId: shop.id,
      },
      include: {
        assignedRep: { select: { firstName: true, lastName: true } },
        locations: {
          include: {
            territory: {
              select: {
                id: true,
                name: true,
                repTerritories: {
                  where: { isPrimary: true },
                  include: {
                    rep: { select: { firstName: true, lastName: true } },
                  },
                  take: 1,
                },
              },
            },
          },
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        },
        contacts: {
          include: {
            paymentMethods: {
              where: { isActive: true },
              select: { id: true },
              take: 1,
            },
          },
          orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }],
        },
      },
    }),
    prisma.salesRep.findMany({
      where: { shopId: shop.id, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    // Fetch all payment methods for contacts in this company
    prisma.paymentMethod.findMany({
      where: {
        companyId,
        isActive: true,
      },
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  if (!company) {
    return { company: null, reps: [], shopId: shop.id };
  }

  // Build territory reps array from all locations with territory assignments
  const territoryReps: TerritoryRep[] = company.locations
    .filter((l) => l.territory?.repTerritories?.[0]?.rep)
    .map((l) => {
      const rep = l.territory!.repTerritories[0].rep;
      return {
        repName: `${rep.firstName} ${rep.lastName}`,
        territoryName: l.territory!.name,
        locationName: l.name,
      };
    });

  // Fetch payment terms from Shopify for Shopify-managed companies
  let shopifyPaymentTerms: string | null = null;
  if (company.shopifyCompanyId) {
    try {
      const response = await admin.graphql(COMPANY_PAYMENT_TERMS_QUERY, {
        variables: { id: toGid("Company", company.shopifyCompanyId) },
      });
      const result = (await response.json()) as ShopifyPaymentTermsResponse;
      const paymentTermsTemplate =
        result.data?.company?.locations?.edges?.[0]?.node?.buyerExperienceConfiguration?.paymentTermsTemplate;
      if (paymentTermsTemplate) {
        shopifyPaymentTerms = paymentTermsTemplate.name;
      }
    } catch (error) {
      console.error("Error fetching Shopify payment terms:", error);
    }
  }

  return {
    company: {
      id: company.id,
      name: company.name,
      accountNumber: company.accountNumber,
      paymentTerms: company.paymentTerms,
      shopifyPaymentTerms,
      assignedRepId: company.assignedRepId,
      assignedRepName: company.assignedRep
        ? `${company.assignedRep.firstName} ${company.assignedRep.lastName}`
        : null,
      territoryReps,
      isActive: company.isActive,
      isShopifyManaged: company.shopifyCompanyId !== null,
      shopifyCompanyId: company.shopifyCompanyId,
      locations: company.locations.map((l) => {
        const rep = l.territory?.repTerritories?.[0]?.rep;
        return {
          id: l.id,
          name: l.name,
          address1: l.address1,
          city: l.city,
          provinceCode: l.provinceCode,
          zipcode: l.zipcode,
          isPrimary: l.isPrimary,
          territoryId: l.territoryId,
          territoryName: l.territory?.name || null,
          territoryRepName: rep ? `${rep.firstName} ${rep.lastName}` : null,
        };
      }),
      contacts: company.contacts.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        isPrimary: c.isPrimary,
        shopifyCustomerId: c.shopifyCustomerId,
        hasPaymentMethods: c.paymentMethods.length > 0,
      })),
      paymentMethods: paymentMethods.map((pm) => ({
        id: pm.id,
        contactId: pm.contactId || "",
        contactName: pm.contact ? `${pm.contact.firstName} ${pm.contact.lastName}` : "Unknown",
        contactEmail: pm.contact?.email || "",
        brand: pm.brand,
        last4: pm.last4,
        expiryMonth: pm.expiryMonth,
        expiryYear: pm.expiryYear,
        isDefault: pm.isDefault,
        isActive: pm.isActive,
      })),
    },
    reps: reps.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` })),
    shopId: shop.id,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const companyId = params.id;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop || !companyId) {
    return { error: "Invalid request" };
  }

  // Get company to check if it's Shopify-managed
  const company = await prisma.company.findFirst({
    where: { id: companyId, shopId: shop.id },
  });

  if (!company) {
    return { error: "Company not found" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // Handle payment method actions (allowed for all companies)
  if (actionType === "removePaymentMethod") {
    const paymentMethodId = formData.get("paymentMethodId") as string;
    if (!paymentMethodId) {
      return { error: "Payment method ID required" };
    }

    // Soft delete - mark as inactive
    await prisma.paymentMethod.update({
      where: { id: paymentMethodId },
      data: { isActive: false },
    });

    return { paymentMethodRemoved: true };
  }

  if (actionType === "generateAccountActivationUrl") {
    const { admin } = await authenticate.admin(request);
    const contactId = formData.get("contactId") as string;
    if (!contactId) {
      return { error: "Contact ID required" };
    }

    // Get the contact's Shopify customer ID
    const contact = await prisma.companyContact.findUnique({
      where: { id: contactId },
      select: { shopifyCustomerId: true, firstName: true, lastName: true, email: true },
    });

    if (!contact) {
      return { error: "Contact not found" };
    }

    if (!contact.shopifyCustomerId) {
      return { error: "Contact is not synced to Shopify yet. Please wait for sync to complete." };
    }

    // Generate customer account activation URL
    const response = await admin.graphql(CUSTOMER_ACCOUNT_ACTIVATION_URL_MUTATION, {
      variables: { customerId: toGid("Customer", contact.shopifyCustomerId) },
    });

    const result = (await response.json()) as CustomerAccountActivationUrlResponse;
    const urlResult = result.data?.customerGenerateAccountActivationUrl;

    if (urlResult?.userErrors?.length) {
      return { error: urlResult.userErrors.map((e) => e.message).join(", ") };
    }

    if (!urlResult?.accountActivationUrl) {
      return { error: "Failed to generate account activation URL" };
    }

    console.log(`[PaymentMethod] Generated account activation URL for ${contact.firstName} ${contact.lastName}`);
    return {
      accountActivationUrl: urlResult.accountActivationUrl,
      contactName: `${contact.firstName} ${contact.lastName}`,
    };
  }

  // For Shopify-managed companies, only allow rep assignment
  if (company.shopifyCompanyId !== null) {
    if (actionType === "assign") {
      const assignedRepId = formData.get("assignedRepId") as string | null;

      await prisma.company.update({
        where: { id: companyId },
        data: {
          assignedRepId: assignedRepId || null,
        },
      });
      return { success: true };
    }
    return { error: "Shopify-managed companies can only have rep assignments updated" };
  }

  // Internal company actions
  if (actionType === "delete") {
    await prisma.company.update({
      where: { id: companyId },
      data: { isActive: false },
    });
    return { deleted: true };
  }

  // Update internal company
  const name = formData.get("name") as string;
  const accountNumber = formData.get("accountNumber") as string | null;
  const paymentTerms = formData.get("paymentTerms") as string;
  const assignedRepId = formData.get("assignedRepId") as string | null;

  if (!name?.trim()) {
    return { error: "Company name is required" };
  }

  // Check for duplicate name (excluding current company)
  const existing = await prisma.company.findFirst({
    where: {
      shopId: shop.id,
      name: { equals: name.trim(), mode: "insensitive" },
      NOT: { id: companyId },
    },
  });

  if (existing) {
    return { error: "A company with this name already exists" };
  }

  try {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        name: name.trim(),
        accountNumber: accountNumber?.trim() || null,
        paymentTerms: paymentTerms as "DUE_ON_ORDER" | "NET_15" | "NET_30" | "NET_45" | "NET_60",
        assignedRepId: assignedRepId || null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating company:", error);
    return { error: "Failed to update company" };
  }
};

export default function CompanyDetailPage() {
  const { company, reps, shopId } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<ActionData>();

  const SAVE_BAR_ID = "company-rep-save-bar";

  // Modal state for adding payment method
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);

  // Initialize selected rep from loader data
  const initialRepId = company?.assignedRepId || null;
  const initialRep = initialRepId
    ? reps.find((r) => r.id === initialRepId) || null
    : null;
  const [selectedRep, setSelectedRep] = useState<SalesRep | null>(
    initialRep ? { id: initialRep.id, name: initialRep.name } : null
  );

  // Track if rep selection has changed (dirty state)
  // Use || null to normalize undefined to null for comparison
  const isDirty = (selectedRep?.id || null) !== initialRepId;

  // Show/hide SaveBar based on dirty state
  useEffect(() => {
    if (isDirty) {
      shopify.saveBar.show(SAVE_BAR_ID);
    } else {
      shopify.saveBar.hide(SAVE_BAR_ID);
    }
  }, [isDirty, shopify]);

  // Hide SaveBar and show toast on successful save
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      shopify.saveBar.hide(SAVE_BAR_ID);
      shopify.toast.show("Rep assignment saved");
    }
    if (fetcher.state === "idle" && fetcher.data?.paymentMethodRemoved) {
      shopify.toast.show("Payment method removed");
    }
    if (fetcher.state === "idle" && fetcher.data?.accountActivationUrl) {
      // Copy URL to clipboard
      navigator.clipboard.writeText(fetcher.data.accountActivationUrl);
      shopify.toast.show(`Activation link copied! Share with ${fetcher.data.contactName}`);
    }
  }, [fetcher.state, fetcher.data, shopify]);

  // Handle save
  const handleSave = useCallback(() => {
    if (!company) return;
    fetcher.submit(
      {
        _action: "assign",
        assignedRepId: selectedRep?.id || "",
      },
      { method: "post" }
    );
  }, [fetcher, company, selectedRep]);

  // Handle discard - reset to initial value
  const handleDiscard = useCallback(() => {
    setSelectedRep(initialRep ? { id: initialRep.id, name: initialRep.name } : null);
  }, [initialRep]);

  // Load reps from API for the picker
  const loadReps = useCallback(async (): Promise<SalesRep[]> => {
    const response = await fetch("/api/reps");
    const data = await response.json();
    return data.reps || [];
  }, []);

  // Redirect after delete
  if (actionData?.deleted) {
    navigate("/app/companies");
    return null;
  }

  if (!shopId || !company) {
    return (
      <s-page heading="Company Not Found">
        <s-section>
          <s-stack gap="base">
            <s-paragraph>This company was not found or you don't have access.</s-paragraph>
            <s-button onClick={() => navigate("/app/companies")}>Back to Companies</s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const isShopifyManaged = company.isShopifyManaged;

  return (
    <>
      {/* SaveBar for rep assignment changes */}
      <ui-save-bar id={SAVE_BAR_ID}>
        <button variant="primary" onClick={handleSave} disabled={fetcher.state !== "idle"}>
          {fetcher.state !== "idle" ? "Saving..." : "Save"}
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </ui-save-bar>

      <s-page heading={company.name}>
        <s-link slot="secondary-actions" href={isShopifyManaged ? `shopify://admin/companies/${company.shopifyCompanyId}` : `/app/companies/${company.id}`}>
          Edit Company
        </s-link>

        <s-section heading="Company Information">

        {/* Status Banner */}
        {isShopifyManaged && (
          <s-banner tone="info">
            Managed by Shopify B2B. We extend companies with territory and rep assignments here but you'll be able to manage the company in Shopify.
          </s-banner>
        )}

        {actionData?.error && (
          <s-banner tone="critical">{actionData.error}</s-banner>
        )}
        {actionData?.success && (
          <s-banner tone="success">Company updated successfully</s-banner>
        )}

        {isShopifyManaged ? (
          /* Shopify-Managed Company: Read-only info + assignment form */
          <s-stack gap="base">

            <s-grid gridTemplateColumns="1fr 1fr auto" gap="base" alignItems="end">
              <s-text-field
                label="Company Name"
                readOnly={true}
                value={company.name}
              />
              <s-text-field
                label="Payment Terms"
                readOnly={true}
                value={company.shopifyPaymentTerms || company.paymentTerms.replace(/_/g, ' ')}
              />
              <s-button variant="tertiary" href={`shopify://admin/companies/${company.shopifyCompanyId}`} icon="external">
                View In Shopify
              </s-button>
            </s-grid>

            <s-divider />

            <s-heading>Rep Assignment</s-heading>
            <SalesRepPicker
              heading="Select sales rep"
              selectedRep={selectedRep}
              territoryReps={company.territoryReps}
              onSelect={setSelectedRep}
              onLoadReps={loadReps}
            />
          </s-stack>
        ) : (
          /* Internal Company: Full edit form */
          <Form method="post">
            <s-stack gap="base">
              <s-heading>Company Information</s-heading>

              <s-text-field
                label="Company Name"
                name="name"
                defaultValue={company.name}
                required
              />

              <s-text-field
                label="Account Number"
                name="accountNumber"
                defaultValue={company.accountNumber || ""}
              />

              <s-select label="Payment Terms" name="paymentTerms" value={company.paymentTerms}>
                <s-option value="DUE_ON_ORDER">Due on Order</s-option>
                <s-option value="NET_15">Net 15</s-option>
                <s-option value="NET_30">Net 30</s-option>
                <s-option value="NET_45">Net 45</s-option>
                <s-option value="NET_60">Net 60</s-option>
              </s-select>

              <input type="hidden" name="assignedRepId" value={selectedRep?.id || ""} />
              <SalesRepPicker
                heading="Select sales rep"
                selectedRep={selectedRep}
                territoryReps={company.territoryReps}
                onSelect={setSelectedRep}
                onLoadReps={loadReps}
              />

              <s-button-group>
                <s-button type="submit">Save Changes</s-button>
                <s-button variant="secondary" onClick={() => navigate("/app/companies")}>
                  Cancel
                </s-button>
              </s-button-group>
            </s-stack>
          </Form>
        )}
      </s-section>

      {/* Locations Section */}
      <s-section heading="Locations">
        <s-stack gap="base">
          <s-paragraph>
            Locations assocaited to this company. These are managed in Shopify
          </s-paragraph>

          {company.locations.length === 0 ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>No locations added yet.</s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Name</s-table-header>
                <s-table-header>Address</s-table-header>
                <s-table-header>ZIP</s-table-header>
                <s-table-header>Primary</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {company.locations.map((loc) => (
                  <s-table-row key={loc.id}>
                    <s-table-cell>{loc.name}</s-table-cell>
                    <s-table-cell>
                      {[loc.address1, loc.city, loc.provinceCode].filter(Boolean).join(", ") || "—"}
                    </s-table-cell>
                    <s-table-cell>{loc.zipcode || "—"}</s-table-cell>
                    <s-table-cell>
                      {loc.isPrimary && <s-badge tone="success">Primary</s-badge>}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      {/* Contacts Section */}
      <s-section heading="Contacts">
        <s-stack gap="base">
          <s-paragraph>
            Contacts assocaited to this company. These are managed in Shopify
          </s-paragraph>

          {company.contacts.length === 0 ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>No contacts added yet.</s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Name</s-table-header>
                <s-table-header>Email</s-table-header>
                <s-table-header>Phone</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {company.contacts.map((contact) => (
                  <s-table-row key={contact.id}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        {contact.firstName} {contact.lastName}
                        {contact.isPrimary && <s-badge tone="info">Primary</s-badge>}
                        {contact.hasPaymentMethods && <s-badge tone="success" icon="check-circle">Saved payment</s-badge>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{contact.email}</s-table-cell>
                    <s-table-cell>{contact.phone || "—"}</s-table-cell>
                    <s-table-cell>
                      {contact.shopifyCustomerId ? (
                        <s-badge tone="success">Synced</s-badge>
                      ) : (
                        <s-badge tone="warning">Pending</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      {/* Payment Methods Section
      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
            <s-heading>Payment Methods</s-heading>
            <s-button variant="secondary" onClick={() => setShowAddPaymentModal(true)}>
              Add Payment Method
            </s-button>
          </s-stack>

          <s-paragraph>
            Saved payment methods can be used for automatic billing on orders.
          </s-paragraph>

          {company.paymentMethods.length === 0 ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>No payment methods on file. Add one to enable automatic billing.</s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Card</s-table-header>
                <s-table-header>Contact</s-table-header>
                <s-table-header>Expires</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {company.paymentMethods.map((pm) => (
                  <s-table-row key={pm.id}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <strong>{pm.brand || "Card"} •••• {pm.last4 || "****"}</strong>
                        {pm.isDefault && <s-badge tone="info">Default</s-badge>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack gap="none">
                        <span>{pm.contactName}</span>
                        <span style={{ color: "var(--p-color-text-subdued)" }}>{pm.contactEmail}</span>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {pm.expiryMonth && pm.expiryYear
                        ? `${String(pm.expiryMonth).padStart(2, "0")}/${String(pm.expiryYear).slice(-2)}`
                        : "—"}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone="success">Active</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <fetcher.Form method="post">
                        <input type="hidden" name="_action" value="removePaymentMethod" />
                        <input type="hidden" name="paymentMethodId" value={pm.id} />
                        <s-button variant="tertiary" tone="critical" type="submit">
                          Remove
                        </s-button>
                      </fetcher.Form>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>
     */}

      {/* Danger Zone - only for internal companies */}
      {!isShopifyManaged && (
        <s-section>
          <s-stack gap="base">
            <s-heading>Danger Zone</s-heading>
            <Form method="post">
              <input type="hidden" name="_action" value="delete" />
              <s-button variant="primary" type="submit">
                Deactivate Company
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      )}
      </s-page>

      {/* Add Payment Method Modal */}
      <Modal
        id="add-payment-modal"
        heading="Add Payment Method"
        open={showAddPaymentModal}
        onClose={() => {
          setShowAddPaymentModal(false);
        }}
        secondaryActions={[
          { content: "Close", onAction: () => setShowAddPaymentModal(false) },
        ]}
      >
        <s-box padding="base">
          <s-stack gap="base">
            {/* Show activation URL if generated */}
            {fetcher.data?.accountActivationUrl ? (
              <>
                <s-banner tone="success">
                  Account activation link generated for {fetcher.data.contactName}!
                </s-banner>
                <s-paragraph>
                  The link has been copied to your clipboard. Share this secure link with the contact
                  so they can access their account and add a payment method.
                </s-paragraph>
                <s-text-field
                  label="Activation Link"
                  value={fetcher.data.accountActivationUrl}
                  readOnly
                />
                <s-button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(fetcher.data!.accountActivationUrl!);
                    shopify.toast.show("Link copied to clipboard");
                  }}
                >
                  Copy Link Again
                </s-button>
              </>
            ) : (
              <>
                <s-paragraph>
                  Generate a secure account activation link for a contact. They can use this link to
                  access their Shopify customer account and add a payment method.
                </s-paragraph>

                {company.contacts.filter((c) => c.shopifyCustomerId).length === 0 ? (
                  <s-banner tone="warning">
                    No synced contacts available. Contacts must be synced to Shopify before they can add payment methods.
                  </s-banner>
                ) : (
                  <fetcher.Form method="post">
                    <input type="hidden" name="_action" value="generateAccountActivationUrl" />
                    <s-stack gap="base">
                      <s-select label="Contact" name="contactId" required>
                        <s-option value="">Select a contact...</s-option>
                        {company.contacts
                          .filter((c) => c.shopifyCustomerId)
                          .map((contact) => (
                            <s-option key={contact.id} value={contact.id}>
                              {contact.firstName} {contact.lastName} ({contact.email})
                            </s-option>
                          ))}
                      </s-select>

                      <s-button type="submit" variant="primary" disabled={fetcher.state !== "idle"}>
                        {fetcher.state !== "idle" ? "Generating..." : "Generate Activation Link"}
                      </s-button>
                    </s-stack>
                  </fetcher.Form>
                )}
              </>
            )}
          </s-stack>
        </s-box>
      </Modal>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
