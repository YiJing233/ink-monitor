import { redirect } from 'next/navigation';

// Redirect to the static OpenAPI spec for power users; in a future version
// this page can render a Swagger UI from the spec.
export default function ApiDocsPage() {
  redirect('/openapi.json');
}
