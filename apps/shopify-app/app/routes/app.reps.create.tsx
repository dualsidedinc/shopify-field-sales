import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import type { RepRole } from "@prisma/client";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useCallback, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getAuthenticatedShop, getShopOrNull } from "../services/shop.server";
import { getActiveTerritories } from "../services/territory.server";
import { createSalesRep } from "../services/salesRep.server";
import { SalesRepForm, type SalesRepFormData } from "../components/SalesRepForm";

interface Territory {
  id: string;
  name: string;
}

interface LoaderData {
  shopId: string | null;
  territories: Territory[];
}

interface ActionData {
  success?: boolean;
  repId?: string;
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await getShopOrNull(request);

  if (!shop) {
    return { shopId: null, territories: [] };
  }

  const territories = await getActiveTerritories(shop.id);

  return {
    shopId: shop.id,
    territories,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await getAuthenticatedShop(request);

  const formData = await request.formData();
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;
  const email = formData.get("email") as string;
  const phone = formData.get("phone") as string | null;
  const externalId = formData.get("externalId") as string | null;
  const role = formData.get("role") as string | null;
  const territoryIdsStr = formData.get("territoryIds") as string | null;
  const requiresOrderApproval = formData.get("requiresOrderApproval") === "true";
  const approvalThresholdDollars = formData.get("approvalThresholdDollars") as string | null;

  const territoryIds = territoryIdsStr ? JSON.parse(territoryIdsStr) : [];

  // Convert form values to approvalThresholdCents
  // If approval not required, set to null (trusted rep)
  // Otherwise, convert dollars to cents
  const approvalThresholdCents = requiresOrderApproval
    ? Math.round(parseFloat(approvalThresholdDollars || "0") * 100)
    : null;

  if (!firstName || !lastName || !email) {
    return { error: "First name, last name, and email are required" };
  }

  const result = await createSalesRep({
    shopId: shop.id,
    firstName,
    lastName,
    email,
    phone: phone || null,
    externalId: externalId || null,
    role: (role as RepRole) || "REP",
    territoryIds,
    approvalThresholdCents,
  });

  if (result.success) {
    return { success: true, repId: result.repId };
  }
  return { error: result.error };
};

export default function NewSalesRepPage() {
  const { shopId, territories } = useLoaderData<LoaderData>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<ActionData>();

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.saveBar.hide("sales-rep-form-save-bar");
      shopify.toast.show("Sales rep created");
      navigate("/app/reps");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify, navigate]);

  const handleSubmit = useCallback((data: SalesRepFormData) => {
    fetcher.submit(
      {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone || "",
        externalId: data.externalId || "",
        role: data.role,
        territoryIds: JSON.stringify(data.territoryIds),
        requiresOrderApproval: data.requiresOrderApproval.toString(),
        approvalThresholdDollars: data.approvalThresholdDollars,
      },
      { method: "POST" }
    );
  }, [fetcher]);

  if (!shopId) {
    return (
      <s-page heading="Add Sales Rep">
        <s-section>
          <s-stack gap="base">
            <s-paragraph>Your store needs to complete setup first.</s-paragraph>
            <s-button onClick={() => navigate("/app")}>Back to Dashboard</s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Add Sales Rep">
      <s-section>
        <SalesRepForm
          territories={territories}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/app/reps")}
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
