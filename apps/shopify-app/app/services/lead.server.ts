import prisma from "../db.server";
import { Prisma } from "@field-sales/database";
import type { Lead, LeadFormField, LeadFieldType, LeadStatus } from "@field-sales/database";

export type { Lead, LeadFormField, LeadFieldType, LeadStatus };

// ============================================
// LEAD FORM FIELD TYPES
// ============================================

export interface CreateLeadFormFieldInput {
  shopId: string;
  name: string;
  label: string;
  fieldType: LeadFieldType;
  placeholder?: string;
  options?: string[];
  isRequired?: boolean;
}

export interface UpdateLeadFormFieldInput {
  name?: string;
  label?: string;
  fieldType?: LeadFieldType;
  placeholder?: string | null;
  options?: string[];
  isRequired?: boolean;
  isActive?: boolean;
  position?: number;
}

// ============================================
// LEAD FORM FIELD FUNCTIONS
// ============================================

/**
 * Get all form fields for a shop (including inactive for admin)
 */
export async function getLeadFormFields(shopId: string): Promise<LeadFormField[]> {
  return prisma.leadFormField.findMany({
    where: { shopId },
    orderBy: { position: "asc" },
  });
}

/**
 * Get active form fields for a shop (for rendering the public form)
 */
export async function getActiveLeadFormFields(shopId: string): Promise<LeadFormField[]> {
  return prisma.leadFormField.findMany({
    where: { shopId, isActive: true },
    orderBy: { position: "asc" },
  });
}

/**
 * Get a single form field by ID
 */
export async function getLeadFormField(id: string): Promise<LeadFormField | null> {
  return prisma.leadFormField.findUnique({
    where: { id },
  });
}

/**
 * Create a new form field
 */
export async function createLeadFormField(
  input: CreateLeadFormFieldInput
): Promise<LeadFormField> {
  // Get the max position to add new field at the end
  const maxPosition = await prisma.leadFormField.aggregate({
    where: { shopId: input.shopId },
    _max: { position: true },
  });

  return prisma.leadFormField.create({
    data: {
      shopId: input.shopId,
      name: input.name,
      label: input.label,
      fieldType: input.fieldType,
      placeholder: input.placeholder,
      options: input.options ?? [],
      isRequired: input.isRequired ?? false,
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });
}

/**
 * Update a form field
 */
export async function updateLeadFormField(
  id: string,
  input: UpdateLeadFormFieldInput
): Promise<LeadFormField> {
  return prisma.leadFormField.update({
    where: { id },
    data: input,
  });
}

/**
 * Delete a form field (soft delete by setting isActive to false)
 */
export async function deleteLeadFormField(id: string): Promise<LeadFormField> {
  return prisma.leadFormField.update({
    where: { id },
    data: { isActive: false },
  });
}

/**
 * Permanently delete a form field
 */
export async function permanentlyDeleteLeadFormField(id: string): Promise<void> {
  await prisma.leadFormField.delete({
    where: { id },
  });
}

/**
 * Reorder form fields
 */
export async function reorderLeadFormFields(
  shopId: string,
  orderedIds: string[]
): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.leadFormField.update({
        where: { id },
        data: { position: index },
      })
    )
  );
}

/**
 * Generate a unique field name from label
 */
export function generateFieldName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 50);
}

/**
 * Check if a field name is unique for this shop
 */
export async function isFieldNameUnique(
  shopId: string,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const existing = await prisma.leadFormField.findFirst({
    where: {
      shopId,
      name,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
  return !existing;
}

// ============================================
// LEAD TYPES
// ============================================

export interface CreateLeadInput {
  shopId: string;
  formData: Record<string, unknown>;
}

export interface UpdateLeadStatusInput {
  status: LeadStatus;
  reviewedBy?: string;
  reviewNotes?: string;
}

export interface GetLeadsOptions {
  status?: LeadStatus | "all";
  search?: string;
  page?: number;
  limit?: number;
}

export interface LeadWithFields extends Lead {
  formFields?: LeadFormField[];
}

// ============================================
// LEAD FUNCTIONS
// ============================================

/**
 * Get leads for a shop with optional filtering
 */
export async function getLeads(
  shopId: string,
  options: GetLeadsOptions = {}
): Promise<{ leads: Lead[]; total: number }> {
  const { status = "all", page = 1, limit = 50 } = options;

  const where: Prisma.LeadWhereInput = {
    shopId,
    ...(status !== "all" ? { status } : {}),
  };

  // Note: Search is tricky with JSON data. For now, we just filter by status.
  // In the future, we could add a computed/indexed field for searchable data.

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.lead.count({ where }),
  ]);

  return { leads, total };
}

/**
 * Get a single lead by ID with form field definitions
 */
export async function getLeadById(
  shopId: string,
  leadId: string
): Promise<LeadWithFields | null> {
  const [lead, formFields] = await Promise.all([
    prisma.lead.findFirst({
      where: { id: leadId, shopId },
    }),
    prisma.leadFormField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
    }),
  ]);

  if (!lead) return null;

  return {
    ...lead,
    formFields,
  };
}

/**
 * Create a new lead from form submission
 */
export async function createLead(input: CreateLeadInput): Promise<Lead> {
  return prisma.lead.create({
    data: {
      shopId: input.shopId,
      formData: input.formData as Prisma.InputJsonValue,
    },
  });
}

/**
 * Update lead status (review, approve, reject)
 */
export async function updateLeadStatus(
  shopId: string,
  leadId: string,
  input: UpdateLeadStatusInput
): Promise<Lead> {
  return prisma.lead.update({
    where: { id: leadId },
    data: {
      status: input.status,
      reviewedAt: new Date(),
      reviewedBy: input.reviewedBy,
      reviewNotes: input.reviewNotes,
    },
  });
}

/**
 * Delete a lead
 */
export async function deleteLead(shopId: string, leadId: string): Promise<void> {
  await prisma.lead.delete({
    where: { id: leadId },
  });
}

/**
 * Get lead counts by status for a shop
 */
export async function getLeadCounts(
  shopId: string
): Promise<Record<LeadStatus | "all", number>> {
  const [newCount, reviewedCount, approvedCount, rejectedCount] = await Promise.all([
    prisma.lead.count({ where: { shopId, status: "NEW" } }),
    prisma.lead.count({ where: { shopId, status: "REVIEWED" } }),
    prisma.lead.count({ where: { shopId, status: "APPROVED" } }),
    prisma.lead.count({ where: { shopId, status: "REJECTED" } }),
  ]);

  const total = newCount + reviewedCount + approvedCount + rejectedCount;

  return {
    all: total,
    NEW: newCount,
    REVIEWED: reviewedCount,
    APPROVED: approvedCount,
    REJECTED: rejectedCount,
  };
}

// ============================================
// DEFAULT FORM FIELDS (for new shops)
// ============================================

const DEFAULT_FORM_FIELDS: Omit<CreateLeadFormFieldInput, "shopId">[] = [
  {
    name: "company_name",
    label: "Company Name",
    fieldType: "TEXT",
    placeholder: "Enter company name",
    isRequired: true,
  },
  {
    name: "contact_name",
    label: "Contact Name",
    fieldType: "TEXT",
    placeholder: "Enter your name",
    isRequired: true,
  },
  {
    name: "email",
    label: "Email",
    fieldType: "TEXT",
    placeholder: "Enter your email",
    isRequired: true,
  },
  {
    name: "phone",
    label: "Phone",
    fieldType: "TEXT",
    placeholder: "Enter your phone number",
    isRequired: false,
  },
  {
    name: "address",
    label: "Address",
    fieldType: "ADDRESS",
    placeholder: "Start typing an address...",
    isRequired: false,
  },
  {
    name: "specialty",
    label: "Specialty",
    fieldType: "SELECT",
    options: ["Restaurant", "Retail", "Wholesale", "Distributor", "Healthcare", "Hospitality", "Manufacturing", "Other"],
    isRequired: false,
  },
  {
    name: "notes",
    label: "Additional Notes",
    fieldType: "TEXTAREA",
    placeholder: "Any additional information",
    isRequired: false,
  },
];

/**
 * Seed default form fields for a new shop
 */
export async function seedDefaultFormFields(shopId: string): Promise<LeadFormField[]> {
  // Check if shop already has fields
  const existingFields = await prisma.leadFormField.count({
    where: { shopId },
  });

  if (existingFields > 0) {
    return prisma.leadFormField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
    });
  }

  // Create default fields
  const fields: LeadFormField[] = [];
  for (let i = 0; i < DEFAULT_FORM_FIELDS.length; i++) {
    const field = await prisma.leadFormField.create({
      data: {
        shopId,
        ...DEFAULT_FORM_FIELDS[i],
        position: i,
      },
    });
    fields.push(field);
  }

  return fields;
}
