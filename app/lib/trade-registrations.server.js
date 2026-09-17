export async function getTradeRegistrations(admin) {
  const registrations = [];

  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query TradeAccountRegistrations($cursor: String) {
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
        "Trade registrations GraphQL errors:",
        result.errors
      );

      throw new Error(
        result.errors[0]?.message ||
        "Unable to retrieve trade registrations."
      );
    }

    const connection =
      result?.data?.metaobjects;

    if (!connection) {
      throw new Error(
        "Shopify returned no trade registration data."
      );
    }

    for (const node of connection.nodes || []) {
      const values = {};

      for (const field of node.fields || []) {
        if (field.key === "certificate") {
          const ref = field.reference;

          if (ref?.url) {
            values.certificate = {
              id:
                ref.id ||
                field.value ||
                null,

              url:
                ref.url || "",

              mime_type:
                ref.mimeType || "",

              file_size:
                ref.originalFileSize || null,

              filename:
                ref.alt || "",
            };
          } else if (ref?.image?.url) {
            values.certificate = {
              id:
                ref.id ||
                field.value ||
                null,

              url:
                ref.image.url,

              mime_type:
                "image",

              file_size:
                null,

              filename:
                ref.image.altText || "",
            };
          } else {
            values.certificate = {
              id:
                field.value || null,

              url: "",
              mime_type: "",
              file_size: null,
              filename: "",
            };
          }

          continue;
        }

        values[field.key] =
          field.jsonValue ??
          field.value ??
          "";
      }

      registrations.push({
        registration_id:
          node.id,

        handle:
          node.handle,

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
          values.certificate || {
            id: null,
            url: "",
            mime_type: "",
            file_size: null,
            filename: "",
          },

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
      connection.pageInfo?.hasNextPage === true;

    cursor =
      connection.pageInfo?.endCursor ||
      null;
  }

  return registrations;
}