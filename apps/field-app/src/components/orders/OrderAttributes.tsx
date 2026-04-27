'use client';

interface OrderAttributesProps {
  poNumber: string;
  note: string;
  onPoNumberChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  readonly?: boolean;
}

/**
 * Metafields-style two-column layout: label on the left, value/input on the
 * right. Same shape across readonly and edit modes — only the right column
 * swaps between display text and an input.
 */
export function OrderAttributes({
  poNumber,
  note,
  onPoNumberChange,
  onNoteChange,
  readonly = false,
}: OrderAttributesProps) {
  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900 mb-4">Order Details</h2>

      <div className="space-y-3">
        <Row label="PO Number" htmlFor="poNumber">
          {readonly ? (
            <DisplayValue value={poNumber} placeholder="Not provided" />
          ) : (
            <input
              id="poNumber"
              type="text"
              value={poNumber}
              onChange={(e) => onPoNumberChange(e.target.value)}
              placeholder="Enter PO number"
              className="input h-10 text-sm"
            />
          )}
        </Row>

        <Row label="Notes" htmlFor="note" alignTop>
          {readonly ? (
            <DisplayValue value={note} placeholder="No notes" multiline />
          ) : (
            <textarea
              id="note"
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Add any notes for this order..."
              rows={3}
              className="input resize-none text-sm"
            />
          )}
        </Row>
      </div>
    </div>
  );
}

function Row({
  label,
  htmlFor,
  alignTop = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  alignTop?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid grid-cols-[110px,1fr] gap-3 ${alignTop ? 'items-start' : 'items-center'}`}>
      <label htmlFor={htmlFor} className={`text-sm text-gray-700 ${alignTop ? 'pt-2' : ''}`}>
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function DisplayValue({
  value,
  placeholder,
  multiline = false,
}: {
  value: string;
  placeholder: string;
  multiline?: boolean;
}) {
  if (!value) {
    return <p className="text-sm text-gray-400">{placeholder}</p>;
  }
  return (
    <p className={`text-sm text-gray-900 ${multiline ? 'whitespace-pre-wrap' : ''}`}>{value}</p>
  );
}

export default OrderAttributes;
