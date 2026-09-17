import { authenticate } from "../shopify.server";

function fieldsToObject(fields = []) {
  const result = {};

  for (const field of fields) {
    result[field.key] =
      field.jsonValue ?? field.value ?? "";
  }

  return result;
}

function csvEscape(value) {
  const stringValue =
    value === null || value === undefined
      ? ""
      : String(value);

  return `"${stringValue.replace(/"/g, '""')}"`;
}

export async function loader({ request }) {
  try {
    const { admin } =
      await authenticate.public.appProxy(request);

    if (!admin) {
      return new Response("Unauthorized", {
        status: 401,
      });
    }

    const expectedToken =
      process.env.TRADE_FEED_TOKEN;

    const authHeader =
      request.headers.get("authorization");

    if (
      !expectedToken ||
      authHeader !== `Bearer ${expectedToken}`
    ) {
      return new Response("Unauthorized", {
        status: 401,
      });
    }

    const registrations = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await admin.graphql(
        `#graphql
          query TradeAccountRegistrations(
            $cursor: String
          ) {
            metaobjects(
              type: "trade_account_registration"
              first: 100
              after: $cursor
            ) {
              nodes {
                id
                handle
                updatedAt

                fields {
                  key
                  value
                  jsonValue

                  reference {
                    ... on GenericFile {
                      id
                      url
                    }

                    ... on MediaImage {
                      id
                      image {
                        url
                      }
                    }
                  }
                }
              }

              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        {
          variables: {
            cursor,
          },
        }
      );

      const result = await response.json();
      const connection =
        result?.data?.metaobjects;

      for (const node of connection?.nodes || []) {
        const values =
          fieldsToObject(node.fields);

        const certificateField =
          node.fields?.find(
            (field) => field.key === "certificate"
          );

        const certificateUrl =
          certificateField?.reference?.url ||
          certificateField?.reference?.image?.url ||
          "";

        registrations.push({
          registration_id: node.id,
          company_name:
            values.company_name || "",
          address_1:
            values.address_1 || "",
          address_2:
            values.address_2 || "",
          country:
            values.country || "",
          city:
            values.city || "",
          county:
            values.county || "",
          postcode:
            values.postcode || "",
          contact_name:
            values.contact_name || "",
          email:
            values.email || "",
          phone:
            values.phone || "",
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
          certificate_url:
            certificateUrl,
          status:
            values.status || "",
          integration_status:
            values.integration_status || "",
          bc_customer_number:
            values.bc_customer_number || "",
          submitted_at:
            values.submitted_at || "",
          updated_at:
            node.updatedAt || "",
        });
      }

      hasNextPage =
        connection?.pageInfo?.hasNextPage === true;

      cursor =
        connection?.pageInfo?.endCursor || null;
    }

    const headers = [
      "registration_id",
      "company_name",
      "address_1",
      "address_2",
      "country",
      "city",
      "county",
      "postcode",
      "contact_name",
      "email",
      "phone",
      "vat_registration_number",
      "eori_number",
      "apply_for_credit_terms",
      "credit_limit_requested",
      "payment_terms_preferred",
      "trade_references",
      "certificate_url",
      "status",
      "integration_status",
      "bc_customer_number",
      "submitted_at",
      "updated_at",
    ];

    const rows = [
      headers.join(","),
      ...registrations.map((item) =>
        headers
          .map((header) =>
            csvEscape(item[header])
          )
          .join(",")
      ),
    ];

    return new Response(rows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type":
          "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="trade-account-registrations.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      "CSV trade feed error:",
      error
    );

    return new Response(
      "Unable to generate CSV feed.",
      {
        status: 500,
      }
    );
  }
}