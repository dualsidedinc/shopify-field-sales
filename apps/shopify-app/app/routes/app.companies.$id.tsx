import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useActionData, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { toGid } from "../lib/shopify-ids";

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
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  isPrimary: boolean;
  shopifyCustomerId: string | null;
}

interface SalesRep {
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
  territoryRepName: string | null; // Rep derived from territory assignment
  isActive: boolean;
  isShopifyManaged: boolean;
  shopifyCompanyId: string | null;
  locations: Location[];
  contacts: Contact[];
}

interface LoaderData {
  company: CompanyData | null;
  reps: SalesRep[];
  shopId: string | null;
}

interface ActionData {
  success?: boolean;
  error?: string;
  deleted?: boolean;
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

  const [company, reps] = await Promise.all([
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
          orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }],
        },
      },
    }),
    prisma.salesRep.findMany({
      where: { shopId: shop.id, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  if (!company) {
    return { company: null, reps: [], shopId: shop.id };
  }

  // Derive rep from territory if no direct assignment
  // Use the primary location (first in list since sorted by isPrimary desc)
  let territoryRepName: string | null = null;
  const primaryLocation = company.locations[0];
  if (primaryLocation?.territory?.repTerritories?.[0]?.rep) {
    const rep = primaryLocation.territory.repTerritories[0].rep;
    territoryRepName = `${rep.firstName} ${rep.lastName}`;
  }

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
      territoryRepName,
      isActive: company.isActive,
      isShopifyManaged: company.shopifyCompanyId !== null,
      shopifyCompanyId: company.shopifyCompanyId,
      locations: company.locations.map((l) => ({
        id: l.id,
        name: l.name,
        address1: l.address1,
        city: l.city,
        provinceCode: l.provinceCode,
        zipcode: l.zipcode,
        isPrimary: l.isPrimary,
        territoryId: l.territoryId,
        territoryName: l.territory?.name || null,
      })),
      contacts: company.contacts.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        isPrimary: c.isPrimary,
        shopifyCustomerId: c.shopifyCustomerId,
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
    <s-page heading={company.name}>
      <s-link slot="secondary-actions" href={isShopifyManaged ? `shopify://admin/companies/${company.shopifyCompanyId}` : `/app/companies/${company.id}`}>
        Edit Company
      </s-link>
      {/* Status Banner */}
      {isShopifyManaged && (
        <s-section>
          <s-banner tone="info">
            This company is managed in Shopify Admin. You can only update territory and rep assignments here.
          </s-banner>
        </s-section>
      )}

      <s-section>
        {actionData?.error && (
          <s-banner tone="critical">{actionData.error}</s-banner>
        )}
        {actionData?.success && (
          <s-banner tone="success">Company updated successfully</s-banner>
        )}

        {isShopifyManaged ? (
          /* Shopify-Managed Company: Read-only info + assignment form */
          <s-stack gap="base">
            <s-heading>Company Information</s-heading>

            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="base">
                <s-stack gap="none">
                  <s-text color="subdued">Company Name</s-text>
                  <s-text>{company.name}</s-text>
                </s-stack>
                {company.accountNumber && (
                  <s-stack gap="none">
                    <s-text color="subdued">Account Number</s-text>
                    <s-text>{company.accountNumber}</s-text>
                  </s-stack>
                )}
                <s-stack gap="none">
                  <s-text color="subdued">Payment Terms</s-text>
                  <s-text>{company.shopifyPaymentTerms || company.paymentTerms.replace(/_/g, ' ')}</s-text>
                </s-stack>
              </s-stack>
            </s-box>

            <s-divider />

            <s-heading>Rep Assignment</s-heading>
            {/* Show territory-derived rep if no direct assignment */}
            {!company.assignedRepId && company.territoryRepName && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="none">
                  <s-text color="subdued">Assigned via Territory</s-text>
                  <s-text>{company.territoryRepName}</s-text>
                </s-stack>
              </s-box>
            )}
            {!company.assignedRepId && !company.territoryRepName && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-text color="subdued">No rep assigned (no territory match or no rep on territory)</s-text>
              </s-box>
            )}
            <Form method="post">
              <input type="hidden" name="_action" value="assign" />
              <s-stack gap="base">
                {reps.length > 0 && (
                  <s-select label="Override Rep Assignment" name="assignedRepId" value={company.assignedRepId || ""}>
                    <s-option value="">{company.territoryRepName ? "Use territory rep" : "No assigned rep"}</s-option>
                    {reps.map((r) => (
                      <s-option key={r.id} value={r.id}>{r.name}</s-option>
                    ))}
                  </s-select>
                )}

                <s-button-group>
                  <s-button type="submit">Save Assignment</s-button>
                  <s-button variant="secondary" onClick={() => navigate("/app/companies")}>
                    Back to Companies
                  </s-button>
                </s-button-group>
              </s-stack>
            </Form>
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

              {/* Show territory-derived rep if no direct assignment */}
              {!company.assignedRepId && company.territoryRepName && (
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-stack gap="none">
                    <s-text color="subdued">Rep via Territory</s-text>
                    <s-text>{company.territoryRepName}</s-text>
                  </s-stack>
                </s-box>
              )}

              {reps.length > 0 && (
                <s-select label={company.territoryRepName ? "Override Rep Assignment" : "Assigned Rep"} name="assignedRepId" value={company.assignedRepId || ""}>
                  <s-option value="">{company.territoryRepName ? "Use territory rep" : "No assigned rep"}</s-option>
                  {reps.map((r) => (
                    <s-option key={r.id} value={r.id}>{r.name}</s-option>
                  ))}
                </s-select>
              )}

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
      <s-section>
        <s-stack gap="base">
          <s-stack gap="base">
            <s-heading>Locations ({company.locations.length})</s-heading>
            <s-paragraph>
              Manage shipping and billing addresses for this company.
            </s-paragraph>
          </s-stack>

          {company.locations.length === 0 ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>No locations added yet.</s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header>
                <s-table-row>
                  <s-table-cell>Name</s-table-cell>
                  <s-table-cell>Address</s-table-cell>
                  <s-table-cell>ZIP</s-table-cell>
                  <s-table-cell>Primary</s-table-cell>
                </s-table-row>
              </s-table-header>
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
      <s-section>
        <s-stack gap="base">
          <s-stack gap="base">
            <s-heading>Contacts ({company.contacts.length})</s-heading>
            <s-paragraph>
              Contacts are synced to Shopify as customers for billing and orders.
            </s-paragraph>
          </s-stack>

          {company.contacts.length === 0 ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>No contacts added yet.</s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header>
                <s-table-row>
                  <s-table-cell>Name</s-table-cell>
                  <s-table-cell>Email</s-table-cell>
                  <s-table-cell>Phone</s-table-cell>
                  <s-table-cell>Status</s-table-cell>
                </s-table-row>
              </s-table-header>
              <s-table-body>
                {company.contacts.map((contact) => (
                  <s-table-row key={contact.id}>
                    <s-table-cell>
                      {contact.firstName} {contact.lastName}
                      {contact.isPrimary && <s-badge tone="info">Primary</s-badge>}
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
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
