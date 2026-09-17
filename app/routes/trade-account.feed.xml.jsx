import { authenticate } from "../shopify.server";

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fieldsToObject(fields = []) {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.jsonValue ?? field.value ?? "",
    ])
  );
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

    const items = registrations
      .map(
        (item) => `
  <registration>
    <registration_id>${xmlEscape(item.registration_id)}</registration_id>
    <company_name>${xmlEscape(item.company_name)}</company_name>
    <address_1>${xmlEscape(item.address_1)}</address_1>
    <address_2>${xmlEscape(item.address_2)}</address_2>
    <country>${xmlEscape(item.country)}</country>
    <city>${xmlEscape(item.city)}</city>
    <county>${xmlEscape(item.county)}</county>
    <postcode>${xmlEscape(item.postcode)}</postcode>
    <contact_name>${xmlEscape(item.contact_name)}</contact_name>
    <email>${xmlEscape(item.email)}</email>
    <phone>${xmlEscape(item.phone)}</phone>
    <vat_registration_number>${xmlEscape(item.vat_registration_number)}</vat_registration_number>
    <eori_number>${xmlEscape(item.eori_number)}</eori_number>
    <apply_for_credit_terms>${xmlEscape(item.apply_for_credit_terms)}</apply_for_credit_terms>
    <credit_limit_requested>${xmlEscape(item.credit_limit_requested)}</credit_limit_requested>
    <payment_terms_preferred>${xmlEscape(item.payment_terms_preferred)}</payment_terms_preferred>
    <trade_references>${xmlEscape(item.trade_references)}</trade_references>
    <certificate_url>${xmlEscape(item.certificate_url)}</certificate_url>
    <status>${xmlEscape(item.status)}</status>
    <integration_status>${xmlEscape(item.integration_status)}</integration_status>
    <bc_customer_number>${xmlEscape(item.bc_customer_number)}</bc_customer_number>
    <submitted_at>${xmlEscape(item.submitted_at)}</submitted_at>
    <updated_at>${xmlEscape(item.updated_at)}</updated_at>
  </registration>`
      )
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<trade_account_registrations>
${items}
</trade_account_registrations>`;

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type":
          "application/xml; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="trade-account-registrations.xml"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      "XML trade feed error:",
      error
    );

    return new Response(
      "Unable to generate XML feed.",
      {
        status: 500,
      }
    );
  }
}