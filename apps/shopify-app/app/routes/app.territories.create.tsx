import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useCallback, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopOrNull } from "../services/shop.server";
import { createTerritory, US_STATES } from "../services/territory.server";
import { TerritoryForm, type TerritoryFormData } from "../components/TerritoryForm";
import { prisma } from "@field-sales/database";

interface StateOption {
  code: string;
  name: string;
}

interface LoaderData {
  shopId: string | null;
  states: readonly StateOption[];
}

interface ActionData {
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await getShopOrNull(request);

  if (!shop) {
    return { shopId: null, states: US_STATES };
  }

  return {
    shopId: shop.id,
    states: US_STATES,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Use redirect from authenticate.admin for embedded app compatibility
  const { session, redirect } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return { error: "Shop not found" };
  }

  const formData = await request.formData();
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

  const result = await createTerritory({
    shopId: shop.id,
    name,
    code: code || null,
    description: description || null,
    stateCodes,
    zipcodes,
    repIds: [], // No reps assigned on create
  });

  if (result.success) {
    // Use Shopify's redirect for embedded app compatibility
    throw redirect(`/app/territories/${result.territoryId}`);
  }

  return { error: result.error };
};

export default function NewTerritoryPage() {
  const { shopId, states } = useLoaderData<LoaderData>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<ActionData>();

  useEffect(() => {
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

  if (!shopId) {
    return (
      <s-page heading="Add Territory">
        <s-link slot="breadcrumb-actions" href="/app/territories">
          Territories
        </s-link>
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
    <s-page heading="Add Territory">
      <s-link slot="breadcrumb-actions" href="/app/territories">
        Territories
      </s-link>
      <TerritoryForm
        states={states}
        onSubmit={handleSubmit}
        onCancel={() => navigate("/app/territories")}
        actionError={fetcher.data?.error}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
