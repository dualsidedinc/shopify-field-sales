import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface CreateTerritoryRequest {
  name: string;
  description?: string | null;
  zipcodes?: string[];
}

/**
 * POST /api/internal/territories — create a territory (with optional zipcodes).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });
  }

  let auth;
  try {
    auth = await requireInternalAuth(request);
  } catch (res) {
    return res as Response;
  }

  if (auth.role !== "ADMIN" && auth.role !== "MANAGER") {
    return jsonResponse(403, { data: null, error: { code: "FORBIDDEN", message: "Admin or manager required" } });
  }

  const body = (await request.json().catch(() => ({}))) as CreateTerritoryRequest;
  if (!body.name?.trim()) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Territory name is required" } });
  }

  const existing = await prisma.territory.findFirst({
    where: { shopId: auth.shopId, name: { equals: body.name.trim(), mode: "insensitive" } },
  });
  if (existing) {
    return jsonResponse(409, { data: null, error: { code: "CONFLICT", message: "A territory with this name already exists" } });
  }

  const territory = await prisma.territory.create({
    data: {
      shopId: auth.shopId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      isActive: true,
      ...(body.zipcodes?.length && {
        zipcodes: {
          create: body.zipcodes.map((z) => ({ zipcode: z.trim() })),
        },
      }),
    },
    include: { zipcodes: true },
  });

  return jsonResponse(201, {
    data: {
      id: territory.id,
      shopId: territory.shopId,
      name: territory.name,
      description: territory.description,
      isActive: territory.isActive,
      createdAt: territory.createdAt,
      updatedAt: territory.updatedAt,
      zipcodes: territory.zipcodes.map((z) => z.zipcode),
    },
    error: null,
  });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
