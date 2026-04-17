# Leads

Public lead capture form with customizable form builder.

## Overview

The Leads feature provides a public-facing form for capturing potential B2B customer information. The form is fully customizable through a form builder interface, and submissions are tracked with status workflow for review and approval.

## Key Features

- **Public Form**: Accessible via Shopify App Proxy (no authentication required)
- **Form Builder**: Admin configures all fields (no hard-coded fields)
- **Theme Integration**: Form inherits store's layout, fonts, and colors via Liquid
- **Google Places**: Address autocomplete with parsed components
- **Status Workflow**: NEW → REVIEWED → APPROVED/REJECTED

## Architecture

```
Storefront (Public)              Admin (Embedded App)
─────────────────────           ────────────────────────

/apps/fsm/lead-form             /app/leads
     │                               │
     ▼                               ▼
┌──────────────┐               ┌──────────────┐
│ proxy.lead-  │               │ Leads List   │
│ form.tsx     │               │ Lead Detail  │
│ (Liquid)     │               │ Form Builder │
└──────────────┘               └──────────────┘
     │                               │
     ▼                               ▼
┌────────────────────────────────────────────┐
│              lead.server.ts                │
│  - getLeads, createLead, updateLeadStatus  │
│  - getLeadFormFields, createLeadFormField  │
└────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────────────┐
│  Database: Lead, LeadFormField tables      │
└────────────────────────────────────────────┘
```

## Data Model

### LeadFormField

Defines the form structure for each shop.

```typescript
{
  id: string;
  shopId: string;
  name: string;           // Internal identifier (e.g., "company_name")
  label: string;          // Display label (e.g., "Company Name")
  fieldType: LeadFieldType;
  placeholder?: string;
  options: string[];      // For SELECT type
  isRequired: boolean;
  position: number;       // Display order
  isActive: boolean;      // Soft delete
}
```

### LeadFieldType

```typescript
enum LeadFieldType {
  TEXT      // Single line text input
  TEXTAREA  // Multi-line text input
  SELECT    // Dropdown with options
  CHECKBOX  // Yes/No checkbox
  ADDRESS   // Google Places autocomplete
}
```

### Lead

Stores form submissions.

```typescript
{
  id: string;
  shopId: string;
  formData: JSON;         // All field responses: { fieldName: value, ... }
  status: LeadStatus;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNotes?: string;
  submittedAt: Date;
}
```

### LeadStatus

```typescript
enum LeadStatus {
  NEW       // Just submitted
  REVIEWED  // Seen by admin
  APPROVED  // Accepted
  REJECTED  // Declined
}
```

## App Proxy Configuration

The public form is served via Shopify App Proxy. Configuration in `shopify.app.toml`:

```toml
[app_proxy]
url = "/proxy"        # Path prefix on your app
subpath = "fsm"       # Path on shop storefront
prefix = "apps"       # URL prefix type
```

This creates the public URL: `https://{shop}.myshopify.com/apps/fsm/lead-form`

## Routes

| Route | Purpose |
|-------|---------|
| `proxy.lead-form.tsx` | Public form (GET renders, POST submits) |
| `app.leads._index.tsx` | Leads list with status filtering |
| `app.leads.$id.tsx` | Lead detail view with status actions |
| `app.leads.form-builder.tsx` | Form field configuration |

## Components

| Component | Purpose |
|-----------|---------|
| `LeadFormFieldModal.tsx` | Add/edit form field modal |
| `LeadStatusBadge.tsx` | Color-coded status display |

## Address Field (Google Places)

The ADDRESS field type provides Google Places Autocomplete. When a user selects an address:

1. The full formatted address is stored in the main field
2. Parsed components are stored in hidden fields:
   - `{fieldName}_street`
   - `{fieldName}_city`
   - `{fieldName}_state`
   - `{fieldName}_zip`
   - `{fieldName}_country`

### Configuration

Add to `.env`:

```
GOOGLE_MAPS_API_KEY=your_api_key_here
```

Required Google Cloud APIs:
- Places API
- Maps JavaScript API

## Form Rendering

The public form uses Liquid templating (`Content-Type: application/liquid`) to inherit the store's theme:

- `{% layout 'theme' %}` wraps content in store layout
- Minimal CSS with `inherit` values for typography
- Theme-compatible color values using `rgba()` and `currentColor`

## Default Fields

When a shop first accesses the form builder, default fields are seeded:

| Field | Type | Required |
|-------|------|----------|
| Company Name | TEXT | Yes |
| Contact Name | TEXT | Yes |
| Email | TEXT | Yes |
| Phone | TEXT | No |
| Address | TEXTAREA | No |
| City | TEXT | No |
| State | TEXT | No |
| Zip Code | TEXT | No |
| Specialty | SELECT | No |
| Additional Notes | TEXTAREA | No |

## Service Functions

### Form Fields

```typescript
// Get all fields for a shop
getLeadFormFields(shopId: string): Promise<LeadFormField[]>

// Get active fields only (for public form)
getActiveLeadFormFields(shopId: string): Promise<LeadFormField[]>

// Create new field
createLeadFormField(input: CreateLeadFormFieldInput): Promise<LeadFormField>

// Update field
updateLeadFormField(id: string, input: UpdateLeadFormFieldInput): Promise<LeadFormField>

// Soft delete (sets isActive = false)
deleteLeadFormField(id: string): Promise<LeadFormField>

// Reorder fields
reorderLeadFormFields(shopId: string, orderedIds: string[]): Promise<void>
```

### Leads

```typescript
// List leads with optional filtering
getLeads(shopId: string, options?: GetLeadsOptions): Promise<{ leads: Lead[]; total: number }>

// Get single lead with field definitions
getLeadById(shopId: string, leadId: string): Promise<LeadWithFields | null>

// Create from form submission
createLead(input: CreateLeadInput): Promise<Lead>

// Update status
updateLeadStatus(shopId: string, leadId: string, input: UpdateLeadStatusInput): Promise<Lead>

// Get counts by status
getLeadCounts(shopId: string): Promise<Record<LeadStatus | "all", number>>
```

## Future Enhancements

- **Convert to Company**: Create Shopify Company from approved lead
- **Email Notifications**: Alert on new submissions
- **Territory Assignment**: Auto-assign leads to reps by address
- **Duplicate Detection**: Warn on similar company names
- **Webhook Integration**: POST submissions to external systems
