import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const companyGid = shopify.data.selected?.[0]?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [blockData, setBlockData] = useState(null);

  useEffect(() => {
    if (!companyGid) {
      setLoading(false);
      setError("No company selected");
      return;
    }

    async function fetchData() {
      try {
        // Direct backend call - automatically authenticated by App Bridge
        const res = await fetch(`/api/company-block/${encodeURIComponent(companyGid)}`);

        if (!res.ok) {
          throw new Error(res.status === 404 ? "Company not synced" : "Failed to load");
        }

        const data = await res.json();
        setBlockData(data);
      } catch (err) {
        setError(err.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [companyGid]);

  if (loading) {
    return (
      <s-admin-block heading="Field Sales">
        <s-text tone="subdued">Loading...</s-text>
      </s-admin-block>
    );
  }

  if (error || !blockData) {
    return (
      <s-admin-block heading="Field Sales">
        <s-text tone="subdued">{error || "No data available"}</s-text>
      </s-admin-block>
    );
  }

  const { territories } = blockData;

  return (
    <s-admin-block heading="Field Sales">
      {territories.length > 0 ? (
        <s-table>
          <s-table-header-row>
            <s-table-header>Territory</s-table-header>
            <s-table-header>Code</s-table-header>
            <s-table-header>Sales Rep</s-table-header>
            <s-table-header>External ID</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {territories.map((t) => (
              <s-table-row key={t.id}>
                <s-table-cell>{t.name}</s-table-cell>
                <s-table-cell>{t.code || "—"}</s-table-cell>
                <s-table-cell>{t.rep?.name || "—"}</s-table-cell>
                <s-table-cell>{t.rep?.externalId || "—"}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      ) : (
        <s-text tone="subdued">No territories assigned</s-text>
      )}
    </s-admin-block>
  );
}