/**
 * Client Module
 *
 * Platform-agnostic HTTP client and API client for field sales apps.
 */

// HTTP Client
export { HttpClient, createHttpClient } from './httpClient';
export type { HttpClientConfig, HttpResponse, RequestOptions } from './httpClient';

// Token Storage
export { MemoryTokenStorage, CookieTokenStorage } from './tokenStorage';
export type { TokenStorage } from './tokenStorage';

// API Client
export { ApiClient, createApiClient } from './apiClient';
export type {
  // Company types
  CompanySearchParams,
  CompanyDetailResponse,
  // Contact types
  ContactListParams,
  ContactWithPaymentMethods,
  PaymentMethodInfo,
  // Location types
  LocationListParams,
  LocationWithPaymentTerms,
  // Product types
  ProductSearchParams,
  ApiPriceBreak,
  ApiProductVariant,
  ApiProductListItem,
  // Promotion types
  ApiPromotionListItem,
  // Shipping types
  ShippingMethod,
  // Order types
  OrderSearchParams,
  ApiOrderListItem,
  ApiOrderDetail,
  ApiOrderLineItem,
  ApiAppliedPromotion,
  TimelineEvent,
  CreateOrderRequest,
  UpdateOrderRequest,
  // Dashboard types
  DashboardStats,
  // Profile types
  ProfileResponse,
  // Tax types
  TaxCalculationRequest,
  TaxCalculationResponse,
} from './apiClient';
