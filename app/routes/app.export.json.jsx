import { authenticate } from "../shopify.server";
import { getTradeRegistrations } from "../lib/trade-registrations.server";

export async function loader({ request }) {
  // IMPORTANT:
  // Keep Shopify authentication outside the try/catch.
  const { admin } = await authenticate.admin(request);

  try {
    const registrations =
      await getTradeRegistrations(admin);

    const data = {
      success: true,
      exported_at: new Date().toISOString(),
      count: registrations.length,
      registrations,
    };

    return new Response(
      JSON.stringify(data, null, 2),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          "Content-Disposition":
            'attachment; filename="trade-account-registrations.json"',

          "Cache-Control":
            "private, no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error(
      "JSON EXPORT ERROR:",
      error
    );

    return Response.json(
      {
        success: false,
        message:
          error?.message ||
          "Unable to export registrations.",
      },
      {
        status: 500,
      }
    );
  }
}