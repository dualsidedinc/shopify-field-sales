/**
 * API Client
 *
 * Typed API client for field-app endpoints.
 * Platform-agnostic - works in both web and React Native.
 */

import type { HttpClient, HttpResponse } from './httpClient';
import type {
  PaginatedResponse,
  SearchParams,
  Company,
  CompanyListItem,
  CompanyLocation,
  CompanyContact,
  CreateCompanyRequest,
  UpdateCompanyRequest,
} from '../types';

// Helper type to make params compatible with HttpClient
type QueryParams = Record<string, string | number | boolean | undefined>;

// ============================================
// RESPONSE TYPES (specific to API endpoints)
// ============================================

// Companies
export interface CompanySearchParams extends SearchParams {
  territoryId?: string;
  repId?: string;
}

export interface CompanyDetailResponse extends Company {
  locations: CompanyLocation[];
  contacts: CompanyContact[];
}

// Contacts
export interface ContactListParams {
  companyId: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ContactWithPaymentMethods extends CompanyContact {
  paymentMethods?: PaymentMethodInfo[];
}

export interface PaymentMethodInfo {
  id: string;
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
}

// Locations
export interface LocationListParams {
  companyId: string;
  [key: string]: string | number | boolean | undefined;
}

export interface LocationWithPaymentTerms extends CompanyLocation {
  paymentTermsType: string | null;
  paymentTermsDays: number | null;
}

// Products
export interface ProductSearchParams extends SearchParams {
  companyLocationId?: string;
}

export interface ApiPriceBreak {
  minimumQuantity: number;
  priceCents: number;
}

export interface ApiProductVariant {
  id: string;
  shopifyVariantId: string;
  title: string;
  sku: string | null;
  priceCents: number;
  basePriceCents: number;
  hasCatalogPrice: boolean;
  available: boolean;
  inventoryQuantity: number | null;
  // Quantity rules from B2B catalog (when companyLocationId is provided)
  quantityMin: number | null;
  quantityMax: number | null;
  quantityIncrement: number | null;
  priceBreaks: ApiPriceBreak[];
}

export interface ApiProductListItem {
  id: string;
  shopifyProductId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  productType: string | null;
  vendor: string | null;
  variants: ApiProductVariant[];
}

// Promotions
export interface ApiPromotionListItem {
  id: string;
  name: string;
  type: string;
  scope: string;
  discountType: string;
  discountValue: number;
  isActive: boolean;
  priority: number;
  startDate: string | null;
  endDate: string | null;
}

// Shipping Methods
export interface ShippingMethod {
  id: string;
  title: string;
  priceCents: number;
  description: string | null;
}

// Orders
export interface OrderSearchParams extends SearchParams {
  status?: string;
  companyId?: string;
}

export interface ApiOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  companyName: string;
  totalCents: number;
  createdAt: string;
  placedAt: string | null;
}

export interface ApiOrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  shopifyOrderId: string | null;
  company: {
    id: string;
    name: string;
    shopifyCompanyId: string | null;
  } | null;
  contact: ContactWithPaymentMethods | null;
  shippingLocation: LocationWithPaymentTerms | null;
  billingLocation: CompanyLocation | null;
  lineItems: ApiOrderLineItem[];
  appliedPromotions: ApiAppliedPromotion[];
  shippingMethod: ShippingMethod | null;
  note: string | null;
  poNumber: string | null;
  paymentTerms: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  timelineEvents: TimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiOrderLineItem {
  id: string;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  isFreeItem: boolean;
  promotionId: string | null;
  promotionName: string | null;
}

export interface ApiAppliedPromotion {
  id: string;
  name: string;
  type: string;
  scope: string;
  discountCents: number;
}

export interface TimelineEvent {
  id: string;
  authorType: 'SALES_REP' | 'ADMIN' | 'SYSTEM';
  authorId: string | null;
  authorName: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  comment: string | null;
  createdAt: string;
}

export interface CreateOrderRequest {
  companyId: string;
  contactId?: string;
  shippingLocationId?: string;
  billingLocationId?: string;
  lineItems: {
    shopifyProductId: string;
    shopifyVariantId: string;
    quantity: number;
  }[];
  shippingMethodId?: string;
  note?: string;
  poNumber?: string;
}

export interface UpdateOrderRequest {
  contactId?: string;
  shippingLocationId?: string;
  billingLocationId?: string;
  lineItems?: {
    shopifyProductId: string;
    shopifyVariantId: string;
    quantity: number;
  }[];
  shippingMethodId?: string;
  note?: string;
  poNumber?: string;
}

// Dashboard
export interface DashboardStats {
  ordersToday: number;
  ordersTodayValue: number;
  ordersThisWeek: number;
  ordersThisWeekValue: number;
  pendingOrders: number;
  activeCompanies: number;
}

// Profile
export interface ProfileResponse {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  tenant: {
    name: string;
    domain: string;
  };
  territories: string[];
  stats: {
    assignedCompanies: number;
    totalOrders: number;
  };
}

export interface UpdateProfileRequest {
  currentPassword?: string;
  newPassword?: string;
}

// Territories
export interface TerritoryListItem {
  id: string;
  name: string;
  description: string | null;
}

// Payment Methods (nested under companies)
export interface CompanyPaymentMethod {
  id: string;
  provider: string;
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
  contactName: string | null;
  contactEmail: string | null;
  createdAt: string;
}

// Tax Calculation
export interface TaxCalculationRequest {
  lineItems: {
    shopifyVariantId?: string | null;
    title: string;
    quantity: number;
    unitPriceCents: number;
  }[];
  shippingAddress?: {
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    countryCode?: string;
  } | null;
  customerId?: string | null;
  shippingCents?: number;
}

export interface TaxCalculationResponse {
  taxCents: number;
  taxLines: {
    title: string;
    rate: number;
    amountCents: number;
  }[];
}

// ============================================
// API CLIENT CLASS
// ============================================

export class ApiClient {
  constructor(private http: HttpClient) {}

  // --------------------------------------------
  // Companies
  // --------------------------------------------

  companies = {
    list: (params?: CompanySearchParams): Promise<HttpResponse<PaginatedResponse<CompanyListItem>>> =>
      this.http.get('/api/companies', params as QueryParams),

    get: (id: string): Promise<HttpResponse<CompanyDetailResponse>> =>
      this.http.get(`/api/companies/${id}`),

    create: (data: CreateCompanyRequest): Promise<HttpResponse<Company>> =>
      this.http.post('/api/companies', data),

    update: (id: string, data: UpdateCompanyRequest): Promise<HttpResponse<Company>> =>
      this.http.patch(`/api/companies/${id}`, data),
  };

  // --------------------------------------------
  // Contacts (nested under companies)
  // --------------------------------------------

  contacts = {
    list: (params: ContactListParams): Promise<HttpResponse<ContactWithPaymentMethods[]>> =>
      this.http.get(`/api/companies/${params.companyId}/contacts`),

    get: (companyId: string, contactId: string): Promise<HttpResponse<ContactWithPaymentMethods>> =>
      this.http.get(`/api/companies/${companyId}/contacts/${contactId}`),
  };

  // --------------------------------------------
  // Locations (nested under companies)
  // --------------------------------------------

  locations = {
    list: (params: LocationListParams): Promise<HttpResponse<LocationWithPaymentTerms[]>> =>
      this.http.get(`/api/companies/${params.companyId}/locations`),

    get: (companyId: string, locationId: string): Promise<HttpResponse<LocationWithPaymentTerms>> =>
      this.http.get(`/api/companies/${companyId}/locations/${locationId}`),
  };

  // --------------------------------------------
  // Products
  // --------------------------------------------

  products = {
    list: (params?: ProductSearchParams): Promise<HttpResponse<PaginatedResponse<ApiProductListItem>>> =>
      this.http.get('/api/products', params as QueryParams),
  };

  // --------------------------------------------
  // Promotions
  // --------------------------------------------

  promotions = {
    list: (): Promise<HttpResponse<ApiPromotionListItem[]>> =>
      this.http.get('/api/promotions'),
  };

  // --------------------------------------------
  // Shipping Methods
  // --------------------------------------------

  shippingMethods = {
    list: (): Promise<HttpResponse<ShippingMethod[]>> =>
      this.http.get('/api/shipping-methods'),
  };

  // --------------------------------------------
  // Orders
  // --------------------------------------------

  orders = {
    list: (params?: OrderSearchParams): Promise<HttpResponse<PaginatedResponse<ApiOrderListItem>>> =>
      this.http.get('/api/orders', params as QueryParams),

    get: (id: string): Promise<HttpResponse<ApiOrderDetail>> =>
      this.http.get(`/api/orders/${id}`),

    create: (data: CreateOrderRequest & { submitForApproval?: boolean; comment?: string }): Promise<HttpResponse<ApiOrderDetail>> =>
      this.http.post('/api/orders', data),

    update: (id: string, data: UpdateOrderRequest): Promise<HttpResponse<ApiOrderDetail>> =>
      this.http.patch(`/api/orders/${id}`, data),

    /** Full order update (PUT) */
    replace: (id: string, data: CreateOrderRequest): Promise<HttpResponse<ApiOrderDetail>> =>
      this.http.put(`/api/orders/${id}`, data),

    submit: (id: string, comment?: string): Promise<HttpResponse<ApiOrderDetail>> =>
      this.http.post(`/api/orders/${id}/submit`, { comment }),

    approve: (id: string, comment?: string): Promise<HttpResponse<ApiOrderDetail>> =>
      this.http.post(`/api/orders/${id}/approve`, { comment }),

    decline: (id: string, comment?: string): Promise<HttpResponse<ApiOrderDetail>> =>
      this.http.post(`/api/orders/${id}/decline`, { comment }),

    addComment: (id: string, comment: string): Promise<HttpResponse<void>> =>
      this.http.post(`/api/orders/${id}/comments`, { comment }),

    delete: (id: string): Promise<HttpResponse<void>> =>
      this.http.delete(`/api/orders/${id}`),
  };

  // --------------------------------------------
  // Dashboard
  // --------------------------------------------

  dashboard = {
    stats: (): Promise<HttpResponse<DashboardStats>> =>
      this.http.get('/api/dashboard'),
  };

  // --------------------------------------------
  // Territories
  // --------------------------------------------

  territories = {
    list: (): Promise<HttpResponse<PaginatedResponse<TerritoryListItem>>> =>
      this.http.get('/api/territories'),
  };

  // --------------------------------------------
  // Payment Methods (nested under companies)
  // --------------------------------------------

  paymentMethods = {
    list: (companyId: string): Promise<HttpResponse<CompanyPaymentMethod[]>> =>
      this.http.get(`/api/companies/${companyId}/payment-methods`),

    delete: (companyId: string, paymentMethodId: string): Promise<HttpResponse<void>> =>
      this.http.delete(`/api/companies/${companyId}/payment-methods?paymentMethodId=${paymentMethodId}`),
  };

  // --------------------------------------------
  // Auth
  // --------------------------------------------

  auth = {
    logout: (): Promise<HttpResponse<void>> =>
      this.http.post('/api/auth/logout'),
  };

  // --------------------------------------------
  // Profile
  // --------------------------------------------

  profile = {
    get: (): Promise<HttpResponse<ProfileResponse>> =>
      this.http.get('/api/profile'),

    update: (data: UpdateProfileRequest): Promise<HttpResponse<ProfileResponse>> =>
      this.http.put('/api/profile', data),
  };

  // --------------------------------------------
  // Tax
  // --------------------------------------------

  tax = {
    calculate: (data: TaxCalculationRequest): Promise<HttpResponse<TaxCalculationResponse>> =>
      this.http.post('/api/tax/calculate', data),
  };

  // --------------------------------------------
  // Cart (local order state)
  // --------------------------------------------

  cart = {
    get: (): Promise<HttpResponse<ApiOrderDetail | null>> =>
      this.http.get('/api/cart'),

    save: (data: CreateOrderRequest): Promise<HttpResponse<ApiOrderDetail>> =>
      this.http.post('/api/cart', data),

    clear: (): Promise<HttpResponse<void>> =>
      this.http.delete('/api/cart'),
  };
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createApiClient(http: HttpClient): ApiClient {
  return new ApiClient(http);
}
