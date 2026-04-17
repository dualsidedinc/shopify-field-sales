# Company Territory Block Extension

Admin block extension that displays territory and sales rep information on company detail pages in Shopify Admin.

## Data Access Pattern

Admin UI extensions have three ways to access data:

### 1. Direct Backend API (Recommended for App Data)

Use `fetch()` with a relative URL to call your app's backend. App Bridge automatically adds authentication headers.

```javascript
// Extension code
const res = await fetch(`/api/company-block/${encodeURIComponent(companyGid)}`);
const data = await res.json();
```

**Backend route must include CORS headers:**

```typescript
// app/routes/api.company-block.$id.tsx
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, cors } = await authenticate.admin(request);

  // ... fetch data from database ...

  return cors(Response.json(data));  // Wrap response with cors()
};
```

### 2. Direct Shopify GraphQL (`shopify.query()`)

For querying Shopify data (products, orders, metafields) directly from the extension:

```javascript
const result = await shopify.query(`
  query GetCompany($id: ID!) {
    company(id: $id) {
      name
      metafield(namespace: "$app:my_namespace", key: "my_key") {
        value
      }
    }
  }
`, { variables: { id: companyGid } });
```

### 3. Contextual Data (`shopify.data`)

Access the current resource context:

```javascript
const companyGid = shopify.data.selected?.[0]?.id;
```

## When to Use Each Pattern

| Data Source | Pattern |
|-------------|---------|
| Your app's database (territories, reps, custom data) | Direct Backend API |
| Shopify resources (products, orders, customers) | `shopify.query()` GraphQL |
| Current page context (selected resource ID) | `shopify.data` |
| App-owned metafields on Shopify resources | `shopify.query()` GraphQL |

## Common Mistakes

### Don't use App Proxies for Admin Extensions

App proxies (`/apps/fsm/...`) are designed for **storefront** use, not admin extensions. They add unnecessary latency and complexity.

```javascript
// BAD - Don't do this in admin extensions
const proxyUrl = `https://${shopDomain}/apps/fsm/company-block/${id}`;
const res = await fetch(proxyUrl);

// GOOD - Direct backend call
const res = await fetch(`/api/company-block/${id}`);
```

### Don't forget CORS headers

Admin extensions run on a different domain. Your API routes must wrap responses with `cors()`:

```typescript
// BAD - Will fail with CORS error
return Response.json(data);

// GOOD - Includes CORS headers
return cors(Response.json(data));
```

## Extension Configuration

The extension is configured in `shopify.extension.toml`:

```toml
api_version = "2026-04"

[[extensions]]
name = "t:name"
handle = "company-territory"
type = "ui_extension"

[[extensions.targeting]]
module = "./src/BlockExtension.jsx"
target = "admin.company-details.block.render"
```

## Available Admin Block Targets

- `admin.company-details.block.render` - Company detail page
- `admin.company-location.block.render` - Company location page
- `admin.customer-details.block.render` - Customer detail page
- `admin.order-details.block.render` - Order detail page
- `admin.product-details.block.render` - Product detail page
- `admin.draft-order-details.block.render` - Draft order detail page

See [Shopify documentation](https://shopify.dev/docs/apps/admin/admin-actions-and-blocks) for the full list.
