import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "@field-sales/database";
import { authenticate } from "../shopify.server";
import { fromGid } from "../lib/shopify-ids";

/**
 * App Proxy endpoint for the Company Admin Block extension.
 * Returns territory and sales rep information for a company.
 *
 * GET /apps/fsm/company-block/:id
 */

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const companyIdParam = params.id;
  if (!companyIdParam) {
    return Response.json({ error: "Company ID required" }, { status: 400 });
  }

  // Handle both GID and numeric ID formats
  const shopifyCompanyId = companyIdParam.startsWith("gid://")
    ? fromGid(companyIdParam)
    : companyIdParam;

  // Get shop
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }

  // Find company by Shopify ID
  const company = await prisma.company.findFirst({
    where: {
      shopId: shop.id,
      shopifyCompanyId,
    },
    select: {
      id: true,
      name: true,
      territory: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      assignedRep: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          externalId: true,
          email: true,
        },
      },
      locations: {
        select: {
          territory: {
            select: {
              id: true,
              name: true,
              code: true,
              repTerritories: {
                where: { rep: { isActive: true } },
                select: {
                  isPrimary: true,
                  rep: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      externalId: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!company) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  // Collect unique territories with their primary rep
  const territoriesMap = new Map<string, {
    id: string;
    name: string;
    code: string | null;
    rep: { name: string; externalId: string | null } | null;
  }>();

  // Add company-level territory with assigned rep
  if (company.territory) {
    territoriesMap.set(company.territory.id, {
      id: company.territory.id,
      name: company.territory.name,
      code: company.territory.code,
      rep: company.assignedRep
        ? {
            name: `${company.assignedRep.firstName} ${company.assignedRep.lastName}`.trim(),
            externalId: company.assignedRep.externalId,
          }
        : null,
    });
  }

  // Add location territories with their primary rep
  for (const location of company.locations) {
    if (location.territory && !territoriesMap.has(location.territory.id)) {
      const primaryRepTerritory = location.territory.repTerritories.find(rt => rt.isPrimary);
      const rep = primaryRepTerritory?.rep;

      territoriesMap.set(location.territory.id, {
        id: location.territory.id,
        name: location.territory.name,
        code: location.territory.code,
        rep: rep
          ? {
              name: `${rep.firstName} ${rep.lastName}`.trim(),
              externalId: rep.externalId,
            }
          : null,
      });
    }
  }

  const data = {
    companyId: company.id,
    companyName: company.name,
    territories: Array.from(territoriesMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  };

  return Response.json(data);
};
