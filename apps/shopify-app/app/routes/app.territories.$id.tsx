import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getAuthenticatedShop, getShopOrNull } from "../services/shop.server";
import {
  getTerritoryById,
  updateTerritory,
  updateTerritoryReps,
  deactivateTerritory,
  activateTerritory,
  deleteTerritory,
  US_STATES,
  type TerritoryDetail,
} from "../services/territory.server";
import { getActiveSalesReps } from "../services/salesRep.server";
import { TerritoryForm, type TerritoryFormData } from "../components/TerritoryForm";
import { picker } from "../utils/shopify-ui";
import { Modal, ModalTrigger } from "../components/Modal";

interface SalesRep {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface StateOption {
  code: string;
  name: string;
}

interface LoaderData {
  territory: TerritoryDetail | null;
  allReps: SalesRep[];
  states: readonly StateOption[];
  shopId: string | null;
}

interface ActionData {
  success?: boolean;
  error?: string;
  deactivated?: boolean;
  activated?: boolean;
  repsUpdated?: boolean;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await getShopOrNull(request);
  const territoryId = params.id;

  if (!shop || !territoryId) {
    return { territory: null, allReps: [], states: US_STATES, shopId: null };
  }

  const [territory, allReps] = await Promise.all([
    getTerritoryById(shop.id, territoryId),
    getActiveSalesReps(shop.id),
  ]);

  return {
    territory,
    allReps,
    states: US_STATES,
    shopId: shop.id,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, redirect } = await getAuthenticatedShop(request);
  const territoryId = params.id;

  if (!territoryId) {
    return { error: "Invalid request" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string | null;

  // Handle deactivate/activate actions
  if (actionType === "delete") {
    const result = await deactivateTerritory(shop.id, territoryId);
    if (result.success) return { deactivated: true };
    return { error: result.error };
  }

  if (actionType === "activate") {
    const result = await activateTerritory(shop.id, territoryId);
    if (result.success) return { activated: true };
    return { error: result.error };
  }

  // Handle permanent deletion
  if (actionType === "permanentlyDelete") {
    const result = await deleteTerritory(shop.id, territoryId);
    if (result.success) {
      throw redirect("/app/territories");
    }
    return { error: result.error };
  }

  // Handle rep assignment update
  if (actionType === "updateReps") {
    const repIdsStr = formData.get("repIds") as string | null;
    const repIds = repIdsStr ? JSON.parse(repIdsStr) : [];

    const result = await updateTerritoryReps(shop.id, territoryId, repIds);
    if (result.success) return { repsUpdated: true };
    return { error: result.error };
  }

  // Handle form update (territory details only)
  const name = formData.get("name") as string;
  const code = formData.get("code") as string | null;
  const description = formData.get("description") as string | null;
  const stateCodesStr = formData.get("stateCodes") as string | null;
  const zipcodesStr = formData.get("zipcodes") as string | null;

  const stateCodes = stateCodesStr ? JSON.parse(stateCodesStr) : [];
  const zipcodes = zipcodesStr ? JSON.parse(zipcodesStr) : [];

  if (!name) {
    return { error: "Territory name is required" };
  }

  const result = await updateTerritory(shop.id, territoryId, {
    name,
    code: code || null,
    description: description || null,
    stateCodes,
    zipcodes,
  });

  if (result.success) return { success: true };
  return { error: result.error };
};

export default function TerritoryDetailPage() {
  const { territory, allReps, states, shopId } = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<ActionData>();

  // Track selected rep IDs locally for optimistic UI
  const [selectedRepIds, setSelectedRepIds] = useState<string[]>(
    territory?.repIds || []
  );

  // Sync with server data when it changes
  useEffect(() => {
    if (territory?.repIds) {
      setSelectedRepIds(territory.repIds);
    }
  }, [territory?.repIds]);

  useEffect(() => {
    if (fetcher.data?.deactivated) {
      shopify.toast.show("Territory deactivated");
    }
    if (fetcher.data?.activated) {
      shopify.toast.show("Territory activated");
    }
    if (fetcher.data?.success) {
      shopify.saveBar.hide("territory-form-save-bar");
      shopify.toast.show("Territory updated");
    }
    if (fetcher.data?.repsUpdated) {
      shopify.toast.show("Sales reps updated");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleSubmit = useCallback((data: TerritoryFormData) => {
    fetcher.submit(
      {
        name: data.name,
        code: data.code || "",
        description: data.description || "",
        stateCodes: JSON.stringify(data.stateCodes),
        zipcodes: JSON.stringify(data.zipcodes),
      },
      { method: "POST" }
    );
  }, [fetcher]);

  // Open picker for rep selection
  const openRepPicker = useCallback(async () => {
    const selectedIds = await picker.open({
      heading: "Select Sales Reps",
      multiple: true,
      headers: [
        { content: "Name" },
        { content: "Email" },
        { content: "Role" },
      ],
      items: allReps.map((rep) => ({
        id: rep.id,
        heading: rep.name,
        data: [rep.email || "—", rep.role || "—"],
        selected: selectedRepIds.includes(rep.id),
      })),
    });

    if (selectedIds !== undefined) {
      // Optimistically update UI
      setSelectedRepIds(selectedIds);

      // Submit to server
      fetcher.submit(
        {
          _action: "updateReps",
          repIds: JSON.stringify(selectedIds),
        },
        { method: "POST" }
      );
    }
  }, [allReps, selectedRepIds, fetcher]);

  // Get selected rep objects for display
  const selectedReps = allReps.filter((r) => selectedRepIds.includes(r.id));

  if (!shopId || !territory) {
    return (
      <s-page heading="Territory Not Found">
        <s-section>
          <s-stack gap="base">
            <s-paragraph>This territory was not found or you don't have access.</s-paragraph>
            <s-button onClick={() => navigate("/app/territories")}>Back to Territories</s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={territory.name}>
      <s-link slot="breadcrumb-actions" href="/app/territories">
        Territories
      </s-link>

      <s-stack gap="base">
        {!territory.isActive && (
          <s-section>
            <s-stack gap="base">
              <s-banner tone="warning">
                This territory is inactive. Companies in this territory will not be accessible by reps.
              </s-banner>
              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  onClick={() => fetcher.submit({ _action: "activate" }, { method: "POST" })}
                >
                  Reactivate Territory
                </s-button>
                <ModalTrigger modalId="delete-territory-modal" variant="tertiary" tone="critical" icon="delete">
                  Delete Territory Permanently
                </ModalTrigger>
              </s-stack>
              <Modal
                id="delete-territory-modal"
                heading="Delete Territory"
                size="small"
                primaryAction={{
                  content: "Delete",
                  tone: "critical",
                  onAction: () => {
                    fetcher.submit(
                      { _action: "permanentlyDelete" },
                      { method: "POST" }
                    );
                  },
                }}
                secondaryActions={[{ content: "Cancel" }]}
              >
                <s-stack gap="base">
                  <s-text>
                    Are you sure you want to permanently delete "{territory.name}"?
                  </s-text>
                  <s-text color="subdued">
                    This action cannot be undone. All territory settings will be removed.
                  </s-text>
                </s-stack>
              </Modal>
            </s-stack>
          </s-section>
        )}

        <TerritoryForm
          territory={territory}
          states={states}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/app/territories")}
          actionError={fetcher.data?.error}
        />

        {/* Sales Reps Section */}
        <s-section>
          <s-stack gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
              <s-heading>Assigned Sales Reps ({selectedReps.length})</s-heading>
              <s-button variant="secondary" onClick={openRepPicker}>
                {selectedReps.length > 0 ? "Manage Reps" : "Add Reps"}
              </s-button>
            </s-grid>
            <s-paragraph>Reps who can access companies in this territory.</s-paragraph>

            {selectedReps.length === 0 ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-paragraph>No sales reps assigned.</s-paragraph>
              </s-box>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Name</s-table-header>
                  <s-table-header>Email</s-table-header>
                  <s-table-header>Role</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {selectedReps.map((rep) => (
                    <s-table-row key={rep.id} clickDelegate={`rep-link-${rep.id}`}>
                      <s-table-cell>
                        <s-link
                          id={`rep-link-${rep.id}`}
                          onClick={() => navigate(`/app/reps/${rep.id}`)}
                        >
                          {rep.name}
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>
                        <s-text color="subdued">{rep.email}</s-text>
                      </s-table-cell>
                      <s-table-cell>
                        <s-text>{rep.role}</s-text>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        </s-section>

        {/* Locations Section */}
        <s-section>
          <s-stack gap="base">
            <s-heading>Locations ({territory.locations.length})</s-heading>
            <s-paragraph>Company locations assigned to this territory.</s-paragraph>

            {territory.locations.length === 0 ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-paragraph>No locations in this territory.</s-paragraph>
              </s-box>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Location</s-table-header>
                  <s-table-header>Company</s-table-header>
                  <s-table-header>Account #</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {territory.locations.map((location) => (
                    <s-table-row key={location.id} clickDelegate={`company-link-${location.companyId}`}>
                      <s-table-cell>
                        <s-text>{location.name}</s-text>
                      </s-table-cell>
                      <s-table-cell>
                        <s-link
                          id={`company-link-${location.companyId}`}
                          onClick={() => navigate(`/app/companies/${location.companyId}`)}
                        >
                          {location.companyName}
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>
                        <s-text color="subdued">{location.accountNumber || "—"}</s-text>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        </s-section>

        {/* Danger Zone */}
        {territory.isActive && (
          <s-box>
            <s-button
              variant="tertiary"
              tone="critical"
              onClick={() => fetcher.submit({ _action: "delete" }, { method: "POST" })}
            >
              Deactivate Territory
            </s-button>
          </s-box>
        )}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
