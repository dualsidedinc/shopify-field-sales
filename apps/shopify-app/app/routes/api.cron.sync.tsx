import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { prisma } from "@field-sales/database";
import {
  syncShop,
  syncAllShops,
  type SyncObjectType,
  type SyncResult,
  type AllShopsSyncResult,
} from "../services/sync.server";

// Secret key to protect internal endpoints
const APP_SECRET = process.env.APP_SECRET;

/**
 * Sync API endpoint for reconciliation
 *
 * Run nightly via GitHub Actions or manually via admin UI.
 *
 * Endpoints:
 * - POST /api/cron/sync - Sync all shops
 * - POST /api/cron/sync?shopId=xxx - Sync specific shop
 * - POST /api/cron/sync?objects=products,catalogs - Sync specific object types
 *
 * Headers:
 * - x-app-secret: <APP_SECRET>
 *
 * Query Parameters:
 * - shopId: Specific shop ID to sync (optional, syncs all shops if omitted)
 * - objects: Comma-separated list of object types (companies, products, catalogs, all)
 * - force: Set to "true" to force sync even if recently synced
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Verify app secret
  const secret = request.headers.get("x-app-secret");
  if (APP_SECRET && secret !== APP_SECRET) {
    console.log("[Sync API] Unauthorized request");
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId");
  const objectsParam = url.searchParams.get("objects");
  const force = url.searchParams.get("force") === "true";

  // Parse objects to sync
  const objects: SyncObjectType[] = objectsParam
    ? (objectsParam.split(",").map((o) => o.trim()) as SyncObjectType[])
    : ["all"];

  const now = new Date();
  console.log(`[Sync API] Starting sync at ${now.toISOString()}`);
  console.log(`[Sync API] Options:`, { shopId: shopId || "all", objects, force });

  let result: SyncResult | AllShopsSyncResult;

  if (shopId) {
    // Sync specific shop
    result = await syncShop(shopId, { objects, force });
    console.log(`[Sync API] Shop sync completed in ${result.duration}ms`);
  } else {
    // Sync all shops
    result = await syncAllShops({ objects, force });
    console.log(`[Sync API] All shops sync completed in ${result.duration}ms`);
  }

  return Response.json({
    timestamp: now.toISOString(),
    ...result,
  });
};

/**
 * GET endpoint for status check and manual trigger info
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (APP_SECRET && secret !== APP_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Get shop counts
  const totalShops = await prisma.shop.count({
    where: { isActive: true, accessToken: { not: "" } },
  });

  // Get sync status counts
  const productCount = await prisma.product.count();
  const companyCount = await prisma.company.count();
  const catalogCount = await prisma.catalog.count();

  // Get last sync times
  const lastProductSync = await prisma.product.findFirst({
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });

  const lastCompanySync = await prisma.company.findFirst({
    orderBy: { lastSyncedAt: "desc" },
    select: { lastSyncedAt: true },
  });

  const lastCatalogSync = await prisma.catalog.findFirst({
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });

  return Response.json({
    message: "Sync API endpoint. POST to trigger sync.",
    usage: {
      syncAll: "POST /api/cron/sync",
      syncShop: "POST /api/cron/sync?shopId=xxx",
      syncObjects: "POST /api/cron/sync?objects=products,catalogs",
      headers: { "x-app-secret": "required" },
    },
    objectTypes: ["companies", "products", "catalogs", "all"],
    status: {
      activeShops: totalShops,
      products: productCount,
      companies: companyCount,
      catalogs: catalogCount,
      lastSync: {
        products: lastProductSync?.syncedAt || null,
        companies: lastCompanySync?.lastSyncedAt || null,
        catalogs: lastCatalogSync?.syncedAt || null,
      },
    },
  });
};
