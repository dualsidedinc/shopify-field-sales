/**
 * Shopify App Bridge UI utilities for Toast and Save Bar APIs
 * @see https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/toast-api
 * @see https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/save-bar-api
 */

export interface ToastOptions {
  /** Action button label */
  action?: string;
  /** Display time in milliseconds (default: 3000) */
  duration?: number;
  /** Applies error styling */
  isError?: boolean;
  /** Callback when action button is clicked */
  onAction?: () => void;
  /** Callback when toast is dismissed */
  onDismiss?: () => void;
}

export interface PickerItem {
  /** Unique identifier returned in selection results */
  id: string;
  /** Primary text in first column */
  heading: string;
  /** Values matching header order */
  data?: string[];
  /** Status indicators */
  badges?: Array<{
    content: string;
    tone?: "info" | "success" | "warning" | "critical";
    progress?: "incomplete" | "partiallyComplete" | "complete";
  }>;
  /** Preview image */
  thumbnail?: { url: string };
  /** Pre-select when picker opens */
  selected?: boolean;
  /** Prevent selection while keeping visible */
  disabled?: boolean;
}

export interface PickerHeader {
  /** Column label text */
  content: string;
  /** Data type: 'number' for right-aligned, 'string' for left-aligned */
  type?: "string" | "number";
}

export interface PickerOptions {
  /** Modal title */
  heading: string;
  /** Array of selectable items */
  items: PickerItem[];
  /** Column header definitions */
  headers?: PickerHeader[];
  /** Selection mode: false=single, true=unlimited, number=max limit */
  multiple?: boolean | number;
}

export interface PickerResult {
  /** Promise resolving to selected item IDs or undefined if cancelled */
  selected: Promise<string[] | undefined>;
}

declare global {
  interface Window {
    shopify?: {
      toast: {
        show: (message: string, options?: ToastOptions) => string;
        hide: (id: string) => void;
      };
      saveBar: {
        show: (id: string) => void;
        hide: (id: string) => void;
        toggle: (id: string) => void;
        leaveConfirmation: () => void;
      };
      modal: {
        show: (id: string) => void;
        hide: (id: string) => void;
        toggle: (id: string) => void;
      };
      picker: (options: PickerOptions) => Promise<PickerResult>;
    };
  }
}

/**
 * Toast API wrapper for showing non-disruptive notifications
 */
export const toast = {
  /**
   * Show a toast notification
   * @param message - The message to display
   * @param options - Optional configuration
   * @returns Toast ID for manual dismissal
   */
  show(message: string, options?: ToastOptions): string | undefined {
    return window.shopify?.toast.show(message, options);
  },

  /**
   * Hide a toast notification
   * @param id - The toast ID returned from show()
   */
  hide(id: string): void {
    window.shopify?.toast.hide(id);
  },

  /**
   * Show a success toast
   */
  success(message: string, options?: Omit<ToastOptions, "isError">): string | undefined {
    return this.show(message, { ...options, isError: false });
  },

  /**
   * Show an error toast
   */
  error(message: string, options?: Omit<ToastOptions, "isError">): string | undefined {
    return this.show(message, { ...options, isError: true });
  },
};

/**
 * Save Bar API wrapper for managing unsaved changes UI
 */
export const saveBar = {
  /**
   * Show the save bar to indicate pending changes
   * @param id - The save bar element ID
   */
  show(id: string): void {
    window.shopify?.saveBar.show(id);
  },

  /**
   * Hide the save bar after changes are saved or discarded
   * @param id - The save bar element ID
   */
  hide(id: string): void {
    window.shopify?.saveBar.hide(id);
  },

  /**
   * Toggle the save bar visibility
   * @param id - The save bar element ID
   */
  toggle(id: string): void {
    window.shopify?.saveBar.toggle(id);
  },

  /**
   * Prompt confirmation before leaving the page with unsaved changes
   */
  leaveConfirmation(): void {
    window.shopify?.saveBar.leaveConfirmation();
  },
};

/**
 * Modal API wrapper for managing modal overlays
 * @see https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/modal-api
 */
export const modal = {
  /**
   * Show a modal by its ID
   * @param id - The modal element ID
   */
  show(id: string): void {
    window.shopify?.modal.show(id);
  },

  /**
   * Hide a modal by its ID
   * @param id - The modal element ID
   */
  hide(id: string): void {
    window.shopify?.modal.hide(id);
  },

  /**
   * Toggle a modal's visibility
   * @param id - The modal element ID
   */
  toggle(id: string): void {
    window.shopify?.modal.toggle(id);
  },
};

/**
 * Picker API wrapper for selecting from custom app data
 * @see https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/picker-api
 */
export const picker = {
  /**
   * Open a picker dialog with custom items
   * @param options - Configuration options
   * @returns Selected item IDs or undefined if cancelled
   */
  async open(options: PickerOptions): Promise<string[] | undefined> {
    const result = await window.shopify?.picker(options);
    // result.selected is a Promise that resolves when user confirms/cancels
    return await result?.selected;
  },
};
