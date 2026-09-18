import { Form, redirect } from "react-router";
export async function loader({ request }) {
  const url = new URL(request.url);

  const isShopifyAdmin =
    url.searchParams.has("shop") ||
    url.searchParams.has("host") ||
    url.searchParams.get("embedded") === "1";

  if (isShopifyAdmin) {
    return redirect(`/app${url.search}`);
  }

  return null;
}

export default function App() {
  return (
    <main
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        padding: "80px 24px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#1f2937",
      }}
    >
      <div
        style={{
          textAlign: "center",
          marginBottom: "60px",
        }}
      >
        <h1
          style={{
            fontSize: "42px",
            lineHeight: "1.2",
            marginBottom: "18px",
          }}
        >
          Dalebrook Trade Registration
        </h1>

        <p
          style={{
            fontSize: "18px",
            lineHeight: "1.6",
            color: "#6b7280",
            maxWidth: "650px",
            margin: "0 auto",
          }}
        >
          Trade account registration and Business Central integration
          for Dalebrook.
        </p>
      </div>

      <div
        style={{
          maxWidth: "520px",
          margin: "0 auto",
          padding: "32px",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          background: "#ffffff",
        }}
      >
        <h2
          style={{
            fontSize: "22px",
            marginBottom: "12px",
          }}
        >
          Shopify Admin Login
        </h2>

        <p
          style={{
            color: "#6b7280",
            marginBottom: "24px",
            lineHeight: "1.5",
          }}
        >
          Enter your Shopify store domain to open the Dalebrook Trade
          Registration app.
        </p>

        <Form method="post" action="/auth/login">
          <label
            htmlFor="shop"
            style={{
              display: "block",
              fontWeight: "600",
              marginBottom: "8px",
            }}
          >
            Shopify store domain
          </label>

          <input
            id="shop"
            name="shop"
            type="text"
            placeholder="your-store.myshopify.com"
            required
            style={{
              width: "100%",
              padding: "12px 14px",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              fontSize: "16px",
              boxSizing: "border-box",
              marginBottom: "16px",
            }}
          />

          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px 18px",
              border: "0",
              borderRadius: "8px",
              background: "#111827",
              color: "#ffffff",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            Open Shopify App
          </button>
        </Form>
      </div>

      <div
        style={{
          marginTop: "60px",
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "24px",
        }}
      >
        <div>
          <h3>Trade Registration</h3>
          <p style={{ color: "#6b7280", lineHeight: "1.5" }}>
            Trade account applications are securely stored in Shopify
            for review and integration.
          </p>
        </div>

        <div>
          <h3>Business Central</h3>
          <p style={{ color: "#6b7280", lineHeight: "1.5" }}>
            Registration data can be passed to Business Central through
            the protected integration feed.
          </p>
        </div>

        <div>
          <h3>Data Export</h3>
          <p style={{ color: "#6b7280", lineHeight: "1.5" }}>
            Authorized users can access registration data in JSON, CSV,
            and XML formats.
          </p>
        </div>
      </div>

      <p
        style={{
          textAlign: "center",
          marginTop: "70px",
          color: "#9ca3af",
          fontSize: "14px",
        }}
      >
        Dalebrook Trade Registration System
      </p>
    </main>
  );
}