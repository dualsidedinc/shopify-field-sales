import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface UpdateTerritoryRequest {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  zipcodes?: string[];
}

/**
 * PUT  /api/internal/territories/:id — update name/description/zipcodes.
 * DELETE /api/internal/territories/:id — hard delete (blocked if has companies/reps).
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  let auth;
  try {
    auth = await requireInternalAuth(request);
  } catch (res) {
    return res as Response;
  }

  const territoryId = params.id;
  if (!territoryId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Territory id required" } });
  }

  if (request.method === "DELETE") {
    if (auth.role !== "ADMIN") {
      return jsonResponse(403, { data: null, error: { code: "FORBIDDEN", message: "Admin required" } });
    }
    return handleDelete(auth.shopId, territoryId);
  }

  if (request.method !== "PUT") {
    return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT or DELETE only" } });
  }

  if (auth.role !== "ADMIN" && auth.role !== "MANAGER") {
    return jsonResponse(403, { data: null, error: { code: "FORBIDDEN", message: "Admin or manager required" } });
  }

  return handleUpdate(auth.shopId, territoryId, request);
};

async function handleUpdate(shopId: string, territoryId: string, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as UpdateTerritoryRequest;

  const existing = await prisma.territory.findFirst({ where: { id: territoryId, shopId } });
  if (!existing) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Territory not found" } });
  }

  if (body.name && body.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await prisma.territory.findFirst({
      where: {
        shopId,
        name: { equals: body.name.trim(), mode: "insensitive" },
        NOT: { id: territoryId },
      },
    });
    if (dup) {
      return jsonResponse(409, { data: null, error: { code: "CONFLICT", message: "A territory with this name already exists" } });
    }
  }

  const territory = await prisma.$transaction(async (tx) => {
    if (body.zipcodes !== undefined) {
      await tx.territoryZipcode.deleteMany({ where: { territoryId } });
      if (body.zipcodes.length > 0) {
        await tx.territoryZipcode.createMany({
          data: body.zipcodes.map((z) => ({ territoryId, zipcode: z.trim() })),
        });
      }
    }
    return tx.territory.update({
      where: { id: territoryId },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description?.trim() || null }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
      include: { zipcodes: true },
    });
  });

  return jsonResponse(200, {
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
}

async function handleDelete(shopId: string, territoryId: string): Promise<Response> {
  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, shopId },
    include: { _count: { select: { companies: true, repTerritories: true } } },
  });

  if (!territory) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Territory not found" } });
  }

  if (territory._count.companies > 0) {
    return jsonResponse(409, {
      data: null,
      error: {
        code: "CONFLICT",
        message: `Cannot delete territory with ${territory._count.companies} assigned companies. Remove companies first.`,
      },
    });
  }
  if (territory._count.repTerritories > 0) {
    return jsonResponse(409, {
      data: null,
      error: {
        code: "CONFLICT",
        message: `Cannot delete territory with ${territory._count.repTerritories} assigned reps. Remove reps first.`,
      },
    });
  }

  await prisma.territory.delete({ where: { id: territoryId } });
  return jsonResponse(200, { data: { success: true }, error: null });
}

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT or DELETE only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
