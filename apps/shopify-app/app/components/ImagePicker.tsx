/**
 * ImagePicker Component
 *
 * A modal-based component for selecting or uploading images from Shopify Files.
 * Uses staged upload flow for new file uploads.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, useModalId } from "./Modal";

interface ShopifyFile {
  id: string;
  url: string;
  alt: string | null;
  width?: number;
  height?: number;
  cursor: string;
}

interface FilesResponse {
  files: ShopifyFile[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

interface ImagePickerProps {
  /** Currently selected image URL */
  value: string | null;
  /** Callback when an image is selected */
  onChange: (url: string | null) => void;
  /** Label for the picker */
  label?: string;
  /** Help text */
  helpText?: string;
}

export function ImagePicker({
  value,
  onChange,
  label = "Image",
  helpText,
}: ImagePickerProps) {
  const modalId = useModalId("image-picker");
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<ShopifyFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [hasNextPage, setHasNextPage] = useState(false);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchFiles = useCallback(async (searchQuery: string, cursor?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (cursor) params.set("after", cursor);

      const response = await fetch(`/api/files?${params.toString()}`);
      const data: FilesResponse = await response.json();

      if (cursor) {
        setFiles((prev) => [...prev, ...data.files]);
      } else {
        setFiles(data.files);
      }
      setHasNextPage(data.pageInfo.hasNextPage);
      setEndCursor(data.pageInfo.endCursor);
    } catch (error) {
      console.error("Failed to fetch files:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchFiles("");
    }
  }, [isOpen, fetchFiles]);

  const handleSearchChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setSearch(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      fetchFiles(value);
    }, 300);
  };

  const handleLoadMore = () => {
    if (endCursor) {
      fetchFiles(search, endCursor);
    }
  };

  const handleSelect = (file: ShopifyFile) => {
    onChange(file.url);
    setIsOpen(false);
  };

  const handleRemove = () => {
    onChange(null);
  };

  const handleUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Step 1: Get staged upload URL
      const stagedFormData = new FormData();
      stagedFormData.append("intent", "stagedUpload");
      stagedFormData.append("filename", file.name);
      stagedFormData.append("mimeType", file.type);
      stagedFormData.append("fileSize", file.size.toString());

      const stagedResponse = await fetch("/api/files", {
        method: "POST",
        body: stagedFormData,
      });

      const stagedData = await stagedResponse.json();
      if (stagedData.error) {
        throw new Error(stagedData.error);
      }

      const { stagedTarget } = stagedData;

      // Step 2: Upload file to staged URL
      const uploadFormData = new FormData();
      for (const param of stagedTarget.parameters) {
        uploadFormData.append(param.name, param.value);
      }
      uploadFormData.append("file", file);

      await fetch(stagedTarget.url, {
        method: "POST",
        body: uploadFormData,
      });

      // Step 3: Create file in Shopify
      const createFormData = new FormData();
      createFormData.append("intent", "fileCreate");
      createFormData.append("resourceUrl", stagedTarget.resourceUrl);
      createFormData.append("alt", file.name.replace(/\.[^/.]+$/, ""));

      const createResponse = await fetch("/api/files", {
        method: "POST",
        body: createFormData,
      });

      const createData = await createResponse.json();
      if (createData.error) {
        throw new Error(createData.error);
      }

      // Select the newly uploaded file
      if (createData.file?.image?.url) {
        onChange(createData.file.image.url);
      }
      setIsOpen(false);
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  const openModal = () => {
    setIsOpen(true);
    const modalEl = document.getElementById(modalId) as HTMLElement & { showOverlay: () => void };
    modalEl?.showOverlay();
  };

  return (
    <div>
      <s-stack gap="small-200">
        <s-text type="strong">{label}</s-text>
        {helpText && <s-text color="subdued">{helpText}</s-text>}

        {value ? (
          <s-box
            padding="base"
            background="subdued"
            borderRadius="large"
            borderWidth="small"
            borderColor="base"
          >
            <s-stack gap="base" alignItems="center">
              <img
                src={value}
                alt="Selected image"
                style={{
                  maxWidth: "200px",
                  maxHeight: "100px",
                  objectFit: "contain",
                  borderRadius: "8px",
                }}
              />
              <s-stack direction="inline" gap="small-200">
                <s-button variant="secondary" onClick={openModal}>
                  Change
                </s-button>
                <s-button variant="tertiary" tone="critical" onClick={handleRemove}>
                  Remove
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        ) : (
          <s-button variant="secondary" onClick={openModal}>
            Select Image
          </s-button>
        )}
      </s-stack>

      <Modal
        id={modalId}
        heading="Select Image"
        size="large"
        onClose={() => setIsOpen(false)}
        secondaryActions={[{ content: "Cancel" }]}
      >
        <s-stack gap="base">
          {/* Search and Upload */}
          <s-grid gridTemplateColumns="1fr auto" gap="base">
            <s-text-field
              label=""
              value={search}
              onInput={handleSearchChange}
              placeholder="Search by filename..."
            />
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={handleUpload as any}
                id={`${modalId}-upload`}
              />
              <s-button
                variant="secondary"
                onClick={() => document.getElementById(`${modalId}-upload`)?.click()}
                loading={uploading}
              >
                Upload
              </s-button>
            </div>
          </s-grid>

          {/* File Grid */}
          {loading && files.length === 0 ? (
            <s-box padding="large">
              <s-spinner accessibilityLabel="Loading files" />
            </s-box>
          ) : files.length === 0 ? (
            <s-box padding="large">
              <s-text color="subdued">No images found. Try uploading one.</s-text>
            </s-box>
          ) : (
            <s-stack gap="base">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: "12px",
                  maxHeight: "400px",
                  overflowY: "auto",
                  padding: "4px",
                }}
              >
                {files.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => handleSelect(file)}
                    style={{
                      border: file.url === value ? "2px solid var(--p-color-border-focus)" : "1px solid var(--p-color-border)",
                      borderRadius: "8px",
                      padding: "8px",
                      background: file.url === value ? "var(--p-color-bg-surface-selected)" : "var(--p-color-bg-surface)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "8px",
                      transition: "border-color 0.15s ease",
                    }}
                    type="button"
                  >
                    <img
                      src={file.url}
                      alt={file.alt || "Image"}
                      style={{
                        width: "100%",
                        height: "80px",
                        objectFit: "contain",
                        borderRadius: "4px",
                      }}
                    />
                  </button>
                ))}
              </div>

              {hasNextPage && (
                <s-stack alignItems="center">
                  <s-button variant="tertiary" onClick={handleLoadMore} loading={loading}>
                    Load More
                  </s-button>
                </s-stack>
              )}
            </s-stack>
          )}
        </s-stack>
      </Modal>
    </div>
  );
}
