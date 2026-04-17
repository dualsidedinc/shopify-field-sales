'use client';

import { useState, useEffect, useCallback } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { api } from '@/lib/api';

export interface PriceBreak {
  minimumQuantity: number;
  priceCents: number;
}

export interface ProductVariant {
  id: string;
  shopifyVariantId: string;
  title: string;
  sku: string | null;
  priceCents: number;
  basePriceCents?: number;
  available: boolean;
  inventoryQuantity: number | null;
  // Quantity rules from B2B catalog
  quantityMin?: number | null;
  quantityMax?: number | null;
  quantityIncrement?: number | null;
  priceBreaks?: PriceBreak[];
}

export interface Product {
  id: string;
  shopifyProductId: string;
  title: string;
  imageUrl: string | null;
  variants: ProductVariant[];
}

export interface SelectedProduct {
  productId: string;
  variantId: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  priceCents: number;
  basePriceCents: number;
  imageUrl: string | null;
  // Quantity rules from B2B catalog
  quantityMin: number | null;
  quantityMax: number | null;
  quantityIncrement: number | null;
  priceBreaks: PriceBreak[];
}

interface ProductPickerProps {
  onSelect: (product: SelectedProduct) => void;
  disabled?: boolean;
  buttonLabel?: string;
  /** Company location ID for catalog-specific pricing and quantity rules */
  companyLocationId?: string | null;
}

interface ProductItem {
  id: string;
  shopifyProductId: string;
  title: string;
  imageUrl: string | null;
  variants: ProductVariant[];
}

export function ProductPicker({
  onSelect,
  disabled = false,
  buttonLabel = 'Add Product',
  companyLocationId,
}: ProductPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);

  const fetchProducts = useCallback(async (query: string = '') => {
    setLoading(true);
    try {
      const { data } = await api.client.products.list({
        pageSize: 50,
        query: query || undefined,
        // Pass company location for catalog-specific pricing and quantity rules
        companyLocationId: companyLocationId || undefined,
      });

      if (data?.items) {
        setProducts(data.items as ProductItem[]);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  }, [companyLocationId]);

  // Load products when sheet opens
  useEffect(() => {
    if (isOpen) {
      fetchProducts(searchQuery);
    }
  }, [isOpen, fetchProducts, searchQuery]);

  // Debounce search
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      fetchProducts(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, fetchProducts]);

  const handleProductClick = (product: ProductItem) => {
    // If product has multiple variants, show variant selection
    if (product.variants.length > 1) {
      setSelectedProduct(product);
    } else {
      // Single variant - add directly
      const variant = product.variants[0];
      handleVariantSelect(product, variant);
    }
  };

  const handleVariantSelect = (product: ProductItem, variant: ProductVariant) => {
    const basePriceCents = variant.basePriceCents ?? variant.priceCents;
    const selected: SelectedProduct = {
      productId: product.id,
      variantId: variant.id,
      shopifyProductId: product.shopifyProductId,
      shopifyVariantId: variant.shopifyVariantId,
      title: product.title,
      variantTitle: variant.title !== 'Default Title' ? variant.title : '',
      sku: variant.sku,
      priceCents: variant.priceCents,
      basePriceCents,
      imageUrl: product.imageUrl,
      // Quantity rules from B2B catalog
      quantityMin: variant.quantityMin ?? null,
      quantityMax: variant.quantityMax ?? null,
      quantityIncrement: variant.quantityIncrement ?? null,
      priceBreaks: variant.priceBreaks ?? [],
    };

    // Add immediately and close
    onSelect(selected);
    handleClose();
  };

  const handleClose = () => {
    setIsOpen(false);
    setSearchQuery('');
    setSelectedProduct(null);
  };

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className="btn-secondary"
      >
        <svg
          className="w-5 h-5 mr-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        {buttonLabel}
      </button>

      {/* Product List Sheet */}
      <BottomSheet
        isOpen={isOpen && !selectedProduct}
        onClose={handleClose}
        title="Select Products"
        height="full"
      >
        <div className="flex flex-col h-full">
          {/* Search */}
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <input
                type="search"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-10"
                autoFocus
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          {/* Product Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : products.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {searchQuery ? 'No products found' : 'No products available'}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {products.map((product) => {
                  const defaultPrice = product.variants[0]?.priceCents || 0;

                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => handleProductClick(product)}
                      className="card text-left relative hover:shadow-md transition-shadow"
                    >
                      <div className="aspect-square bg-gray-100 rounded-lg mb-2 overflow-hidden">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <svg
                              className="w-12 h-12"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                      <p className="font-medium text-gray-900 text-sm line-clamp-2">
                        {product.title}
                      </p>
                      <p className="text-primary-600 font-semibold mt-1">
                        {formatPrice(defaultPrice)}
                      </p>
                      {product.variants.length > 1 && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {product.variants.length} variants
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </BottomSheet>

      {/* Variant Selection Sheet */}
      <BottomSheet
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        title="Select Variant"
        height="auto"
      >
        {selectedProduct && (
          <div className="p-4">
            {/* Product Info */}
            <div className="flex gap-3 mb-4">
              <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                {selectedProduct.imageUrl ? (
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.title}
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{selectedProduct.title}</h3>
              </div>
            </div>

            {/* Variants */}
            <div className="space-y-2">
              {selectedProduct.variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => handleVariantSelect(selectedProduct, variant)}
                  disabled={!variant.available}
                  className={`w-full p-3 rounded-lg border text-left min-h-touch transition-colors ${
                    variant.available
                      ? 'border-gray-200 hover:border-primary-500'
                      : 'border-gray-100 bg-gray-50 opacity-50'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium text-gray-900">
                        {variant.title === 'Default Title' ? 'Standard' : variant.title}
                      </p>
                      {variant.sku && (
                        <p className="text-xs text-gray-500">SKU: {variant.sku}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-primary-600">
                        {formatPrice(variant.priceCents)}
                      </p>
                      {!variant.available && (
                        <p className="text-xs text-red-500">Out of stock</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

export default ProductPicker;
