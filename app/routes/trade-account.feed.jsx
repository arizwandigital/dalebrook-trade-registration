import { authenticate } from "../shopify.server";

function fieldsToObject(fields = []) {
  const result = {};

  for (const field of fields) {
    if (field.key === "certificate") {
      const ref = field.reference;

      if (ref?.url) {
        result.certificate = {
          id: ref.id || field.value || null,
          url: ref.url,
          mime_type: ref.mimeType || "",
          file_size: ref.originalFileSize || null,
          filename: ref.alt || "",
        };
      } else if (ref?.image?.url) {
        result.certificate = {
          id: ref.id || field.value || null,
          url: ref.image.url,
          mime_type: "image",
          file_size: null,
          filename: ref.image.altText || "",
        };
      } else {
        result.certificate = {
          id: field.value || null,
          url: "",
          mime_type: "",
          file_size: null,
          filename: "",
        };
      }

      continue;
    }

    result[field.key] =
      field.jsonValue ?? field.value ?? "";
  }

  return result;
}

export async function loader({ request }) {
  try {
    /*
      Request comes through Shopify App Proxy:
      /apps/trade-account/feed
    */
    const { admin } =
      await authenticate.public.appProxy(request);

    if (!admin) {
      return Response.json(
        {
          success: false,
          message: "App proxy authentication failed.",
        },
        { status: 401 }
      );
    }

    /*
      Additional protection for the external BC feed.
    */
    const expectedToken =
      process.env.TRADE_FEED_TOKEN;

    const authHeader =
      request.headers.get("authorization");

    if (
      !expectedToken ||
      authHeader !== `Bearer ${expectedToken}`
    ) {
      return Response.json(
        {
          success: false,
          message: "Unauthorized.",
        },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const registrations = [];

    let cursor = null;
    let hasNextPage = true;

    /*
      Retrieve all Trade Account Registration
      metaobjects, 100 records at a time.
    */
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
                displayName
                updatedAt

                fields {
                  key
                  value
                  jsonValue

                  reference {
                    ... on GenericFile {
                      id
                      url
                      mimeType
                      originalFileSize
                      alt
                    }

                    ... on MediaImage {
                      id
                      image {
                        url
                        altText
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

      if (result.errors?.length) {
        console.error(
          "Trade feed GraphQL errors:",
          result.errors
        );

        return Response.json(
          {
            success: false,
            message:
              "Unable to retrieve registrations.",
            errors: result.errors,
          },
          {
            status: 500,
            headers: {
              "Cache-Control": "no-store",
            },
          }
        );
      }

      const connection =
        result?.data?.metaobjects;

      if (!connection) {
        return Response.json(
          {
            success: false,
            message:
              "Shopify returned no registration data.",
          },
          {
            status: 500,
            headers: {
              "Cache-Control": "no-store",
            },
          }
        );
      }

      for (const node of connection.nodes || []) {
        const values =
          fieldsToObject(node.fields);

        registrations.push({
          registration_id: node.id,
          handle: node.handle,

          company: {
            name:
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
          },

          contact: {
            name:
              values.contact_name || "",

            email:
              values.email || "",

            phone:
              values.phone || "",
          },

          tax: {
            vat_registration_number:
              values.vat_registration_number ||
              "",

            eori_number:
              values.eori_number || "",
          },

          credit: {
            requested:
              values.apply_for_credit_terms ??
              false,

            limit_requested:
              values.credit_limit_requested ||
              "",

            payment_terms:
              values.payment_terms_preferred ||
              "",

            trade_references:
              values.trade_references || "",
          },

          certificate:
            values.certificate || null,

          workflow: {
            status:
              values.status || "",

            integration_status:
              values.integration_status || "",

            bc_customer_number:
              values.bc_customer_number || "",
          },

          submitted_at:
            values.submitted_at || "",

          updated_at:
            node.updatedAt || "",
        });
      }

      hasNextPage =
        connection.pageInfo?.hasNextPage ===
        true;

      cursor =
        connection.pageInfo?.endCursor || null;
    }

    return Response.json(
      {
        success: true,
        count: registrations.length,
        registrations,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "private, no-store, max-age=0",

          "Content-Type":
            "application/json; charset=utf-8",
        },
      }
    );
  } catch (error) {
    console.error(
      "Trade registration feed error:",
      error
    );

    return Response.json(
      {
        success: false,
        message:
          error?.message ||
          "Unable to load trade registrations.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}