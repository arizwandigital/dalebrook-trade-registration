import { unauthenticated } from "../shopify.server";

function fieldMap(fields = []) {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.jsonValue ?? field.value,
    ])
  );
}

export async function loader({ request }) {
  try {
    const authHeader = request.headers.get("authorization");

    const expectedToken = process.env.TRADE_FEED_TOKEN;

    if (
      !expectedToken ||
      authHeader !== `Bearer ${expectedToken}`
    ) {
      return Response.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    const shop = process.env.SHOPIFY_STORE_DOMAIN;

    if (!shop) {
      return Response.json(
        {
          success: false,
          message: "Store domain not configured.",
        },
        { status: 500 }
      );
    }

    const { admin } = await unauthenticated.admin(shop);

    const response = await admin.graphql(
      `#graphql
        query TradeAccountRegistrations($cursor: String) {
          metaobjects(
            type: "trade_account_registration"
            first: 100
            after: $cursor
            sortKey: "updated_at"
            reverse: true
          ) {
            nodes {
              id
              handle
              displayName
              updatedAt

              fields {
                key
                value
                jsonValue
              }
            }

            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `
    );

    const json = await response.json();

    if (json.errors) {
      console.error(json.errors);

      return Response.json(
        {
          success: false,
          message: "Unable to retrieve registrations.",
        },
        { status: 500 }
      );
    }

    const nodes =
      json?.data?.metaobjects?.nodes || [];

    const registrations = nodes.map((node) => {
      const values = fieldMap(node.fields);

      return {
        id: node.id,
        handle: node.handle,
        company_name: values.company_name || "",
        address_1: values.address_1 || "",
        address_2: values.address_2 || "",
        country: values.country || "",
        postcode: values.postcode || "",
        city: values.city || "",
        county: values.county || "",

        contact_name: values.contact_name || "",
        email: values.email || "",
        phone: values.phone || "",

        vat_registration_number:
          values.vat_registration_number || "",

        eori_number:
          values.eori_number || "",

        apply_for_credit_terms:
          values.apply_for_credit_terms ?? false,

        credit_limit_requested:
          values.credit_limit_requested || "",

        payment_terms_preferred:
          values.payment_terms_preferred || "",

        trade_references:
          values.trade_references || "",

        certificate:
          values.certificate || null,

        status:
          values.status || "",

        integration_status:
          values.integration_status || "",

        bc_customer_number:
          values.bc_customer_number || "",

        submitted_at:
          values.submitted_at || "",

        updated_at:
          node.updatedAt,
      };
    });

    return Response.json({
      success: true,
      count: registrations.length,
      registrations,
    });

  } catch (error) {
    console.error("Trade feed error:", error);

    return Response.json(
      {
        success: false,
        message: "Unable to load trade registrations.",
      },
      { status: 500 }
    );
  }
}