import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  createBillingSubscription,
  getBillingStatus,
  PLAN_CONFIGS,
  TRIAL_DAYS,
  type PlanConfig,
} from "../services/billing.server";
import type { BillingPlan } from "@prisma/client";
import { getAuthenticatedShop } from "../services/shop.server";

interface LoaderData {
  currentPlan: BillingPlan | null;
  isActive: boolean;
  allPlans: Array<{ key: BillingPlan } & PlanConfig>;
  shopId: string | null;
  trialDays: number;
}

interface ActionData {
  success?: boolean;
  confirmationUrl?: string;
  error?: string;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);

  try {
    const { shop } = await getAuthenticatedShop(request);
    const billingStatus = await getBillingStatus(shop.id);

    return {
      currentPlan: billingStatus.plan,
      isActive: billingStatus.isActive,
      allPlans: Object.entries(PLAN_CONFIGS).map(([key, config]) => ({
        key: key as BillingPlan,
        ...config,
      })),
      shopId: shop.id,
      trialDays: TRIAL_DAYS,
    };
  } catch {
    throw redirect("/app");
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const { shop } = await getAuthenticatedShop(request);

  if (!shop) {
    return { success: false, error: "Shop not found" };
  }

  const formData = await request.formData();
  const plan = formData.get("plan") as BillingPlan;

  if (!plan || !(plan in PLAN_CONFIGS)) {
    return { success: false, error: "Invalid plan selected" };
  }

  // For embedded apps, return URL must go through Shopify admin to maintain session
  const storeName = session.shop.replace(".myshopify.com", "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "field-sales-manager";
  const returnUrl = `https://admin.shopify.com/store/${storeName}/apps/${appHandle}/app/billing/callback?plan=${plan}`;
  const isTest = process.env.NODE_ENV !== "production";

  const result = await createBillingSubscription(
    shop.id,
    plan,
    admin,
    returnUrl,
    isTest
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    confirmationUrl: result.confirmationUrl,
  };
};

function PlanCard({
  plan,
  isCurrentPlan,
  isSubmitting,
  submittingPlan,
  fetcher,
}: {
  plan: { key: BillingPlan } & PlanConfig;
  isCurrentPlan: boolean;
  isSubmitting: boolean;
  submittingPlan: string | null;
  fetcher: ReturnType<typeof useFetcher<ActionData>>;
}) {
  const isThisPlanSubmitting = isSubmitting && submittingPlan === plan.key;

  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="base"
    >
      <s-stack gap="base">
        {/* Plan Name */}
        <s-stack direction="inline" justifyContent="space-between" gap="small-100">
          <s-heading>{plan.name}</s-heading>
          {isCurrentPlan && <s-badge tone="success">Selected</s-badge>}
        </s-stack>

        {/* Price */}
        <s-stack direction="inline" gap="small-300">
          <s-heading>{formatCents(plan.basePriceCents)}</s-heading>
          <s-text color="subdued">base per month</s-text>
        </s-stack>

        {/* Features */}
        <s-unordered-list>
          <s-list-item>{plan.includedReps} sales reps</s-list-item>
          <s-list-item>{formatCents(plan.perRepCents)}/rep after</s-list-item>
          <s-list-item>{plan.revenueSharePercent}% revenue share</s-list-item>
        </s-unordered-list>

        {/* Action Button */}
        {isCurrentPlan ? (
          <s-button variant="secondary" disabled>
            Current Plan
          </s-button>
        ) : (
          <fetcher.Form method="POST">
            <input type="hidden" name="plan" value={plan.key} />
            <s-button
              variant="secondary"
              type="submit"
              disabled={isSubmitting}
            >
              {isThisPlanSubmitting ? "Processing..." : "Select Plan"}
            </s-button>
          </fetcher.Form>
        )}
      </s-stack>
    </s-box>
  );
}

export default function BillingSubscribePage() {
  const { currentPlan, isActive, allPlans, shopId, trialDays } =
    useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.confirmationUrl) {
      // Redirect to Shopify billing approval page
      window.top!.location.href = fetcher.data.confirmationUrl;
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  if (!shopId) {
    return (
      <s-page heading="Choose a Plan">
        <s-section>
          <s-banner tone="warning">
            Your store needs to complete setup before subscribing.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  // Keep loading state until redirect completes
  const isPending = fetcher.state !== "idle";
  const isRedirecting = !!(fetcher.data?.success && fetcher.data?.confirmationUrl);
  const isSubmitting = isPending || isRedirecting;
  const submittingPlan = isPending ? (fetcher.formData?.get("plan") as string | null) : null;

  return (
    <s-page heading="Choose a Plan">
        <s-stack gap="base">
          <s-paragraph>
            {isActive
              ? "Select a different plan to change your subscription."
              : `Start with a ${trialDays}-day free trial. No charges until your trial ends.`}
          </s-paragraph>

          {/* Responsive Plan Cards Grid */}
          <s-grid gap="base" gridTemplateColumns="repeat(auto-fill, minmax(215px, 1fr))">
            {allPlans.map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                isCurrentPlan={isActive && plan.key === currentPlan}
                isSubmitting={isSubmitting}
                submittingPlan={submittingPlan}
                fetcher={fetcher}
              />
            ))}
          </s-grid>

          <s-text color="subdued">
            {isActive
              ? "Changing plans will take effect immediately. You can cancel anytime from your Shopify admin."
              : `By selecting a plan, you'll start a ${trialDays}-day free trial. You can cancel anytime from your Shopify admin.`}
          </s-text>
        </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
