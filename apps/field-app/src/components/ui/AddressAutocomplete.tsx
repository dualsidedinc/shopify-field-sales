'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

export type AddressComponents = {
  venue: string;
  address: string;
  address2?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
};

type Suggestion = {
  placeId: string;
  mainText: string;
  secondaryText: string;
};

interface AddressAutocompleteProps {
  onAddressSelect: (components: AddressComponents) => void;
  apiKey: string;
  label?: string;
  placeholder?: string;
  selectedValue?: string;
  required?: boolean;
  error?: string;
}

export function AddressAutocomplete({
  onAddressSelect,
  apiKey,
  label = 'Address',
  placeholder = 'Start typing an address...',
  selectedValue = '',
  required = false,
  error,
}: AddressAutocompleteProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const sessionTokenRef = useRef<any>(null);

  // Track client-side mount for portal
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Load Google Maps script
  useEffect(() => {
    if (!apiKey) return;

    const google = (window as any).google;

    if (google?.maps?.places?.Place) {
      setIsGoogleLoaded(true);
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      return;
    }

    (window as any).initGoogleMapsFieldApp = () => {
      const g = (window as any).google;
      if (g?.maps?.places?.Place) {
        setIsGoogleLoaded(true);
        sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken();
      }
    };

    const existingScript = document.querySelector(
      'script[src*="maps.googleapis.com"]'
    );
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        const g = (window as any).google;
        if (g?.maps?.places?.Place) {
          setIsGoogleLoaded(true);
          sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken();
        }
      });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async&callback=initGoogleMapsFieldApp`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, [apiKey]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsideContainer = containerRef.current && !containerRef.current.contains(target);
      const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(target);

      if (isOutsideContainer && isOutsideDropdown) {
        setIsOpen(false);
        if (!selectedValue) {
          setIsSearching(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedValue]);

  // Fetch suggestions when search query changes
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3 || !isGoogleLoaded) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(searchQuery);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, isGoogleLoaded]);

  const fetchSuggestions = async (input: string) => {
    const google = (window as any).google;
    if (!google?.maps?.places?.AutocompleteSuggestion) return;

    setIsLoading(true);

    try {
      const request = {
        input,
        sessionToken: sessionTokenRef.current,
      };

      const { suggestions: results } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

      const mappedSuggestions: Suggestion[] = results.map((suggestion: any) => ({
        placeId: suggestion.placePrediction.placeId,
        mainText: suggestion.placePrediction.mainText.text,
        secondaryText: suggestion.placePrediction.secondaryText?.text || '',
      }));

      setSuggestions(mappedSuggestions);
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = async (suggestion: Suggestion) => {
    const google = (window as any).google;
    if (!google?.maps?.places?.Place) return;

    setIsOpen(false);
    setSuggestions([]);

    try {
      const place = new google.maps.places.Place({
        id: suggestion.placeId,
      });

      await place.fetchFields({
        fields: ['addressComponents', 'formattedAddress', 'location', 'displayName'],
      });

      // Create new session token for next search
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();

      const components: AddressComponents = {
        venue: '',
        address: '',
        city: '',
        state: '',
        country: '',
        postalCode: '',
      };

      let streetNumber = '';
      let route = '';

      if (place.addressComponents) {
        for (const component of place.addressComponents) {
          const types = component.types;

          if (types.includes('street_number')) {
            streetNumber = component.longText;
          } else if (types.includes('route')) {
            route = component.longText;
          } else if (types.includes('locality')) {
            components.city = component.longText;
          } else if (types.includes('administrative_area_level_1')) {
            components.state = component.shortText;
          } else if (types.includes('country')) {
            components.country = component.longText;
          } else if (types.includes('postal_code')) {
            components.postalCode = component.longText;
          }
        }
      }

      const streetAddress = [streetNumber, route].filter(Boolean).join(' ');

      const displayName = place.displayName;
      if (displayName && displayName !== streetAddress) {
        components.venue = displayName;
      }
      components.address = streetAddress;

      // Get coordinates and fetch timezone
      if (place.location) {
        const lat = place.location.lat();
        const lng = place.location.lng();

        components.latitude = lat;
        components.longitude = lng;

        // Fetch timezone
        const timestamp = Math.floor(Date.now() / 1000);
        try {
          const response = await fetch(
            `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${apiKey}`
          );
          const data = await response.json();
          if (data.status === 'OK' && data.timeZoneId) {
            components.timezone = data.timeZoneId;
          }
        } catch (err) {
          console.error('Failed to fetch timezone:', err);
        }
      }

      onAddressSelect(components);
      setSearchQuery('');
      setIsSearching(false);
    } catch (err) {
      console.error('Failed to fetch place details:', err);
      setIsSearching(false);
    }
  };

  // Update dropdown position
  const updateDropdownPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);
      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isOpen, updateDropdownPosition]);

  const showSuggestions = suggestions.length > 0;
  const displayValue = isSearching ? searchQuery : selectedValue;

  const renderDropdown = () => {
    if (!isOpen || !isMounted) return null;

    const dropdownContent = (
      <div
        ref={dropdownRef}
        style={{
          position: 'absolute',
          top: dropdownPosition.top,
          left: dropdownPosition.left,
          width: dropdownPosition.width,
          zIndex: 9999,
        }}
        className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden"
      >
        {isLoading && searchQuery.length >= 3 && suggestions.length === 0 ? (
          <div className="px-4 py-3 text-gray-500 text-sm">
            Searching...
          </div>
        ) : showSuggestions ? (
          <div className="max-h-60 overflow-y-auto">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.placeId}
                type="button"
                onClick={() => handleSelect(suggestion)}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100 border-b border-gray-100 last:border-b-0 transition-colors"
              >
                <div className="font-medium text-gray-900 text-sm">
                  {suggestion.mainText}
                </div>
                <div className="text-gray-500 text-xs mt-0.5">
                  {suggestion.secondaryText}
                </div>
              </button>
            ))}
          </div>
        ) : searchQuery.length >= 3 && !isLoading ? (
          <div className="px-4 py-3 text-gray-500 text-sm">
            No addresses found
          </div>
        ) : null}
      </div>
    );

    return createPortal(dropdownContent, document.body);
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`input pr-10 ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
          value={displayValue}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setIsSearching(true);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsSearching(true);
            setSearchQuery('');
            setIsOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
        />

        {/* Search icon */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
      </div>

      {error && (
        <p className="mt-1 text-sm text-red-500">{error}</p>
      )}

      {!isGoogleLoaded && apiKey && (
        <p className="mt-1 text-xs text-gray-400">Loading address lookup...</p>
      )}

      {renderDropdown()}
    </div>
  );
}

export default AddressAutocomplete;
