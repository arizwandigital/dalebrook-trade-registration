import { authenticate } from "../shopify.server";
import { getTradeRegistrations } from "../lib/trade-registrations.server";

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function loader({ request }) {
  // Keep authentication outside try/catch.
  const { admin } = await authenticate.admin(request);

  try {
    const registrations =
      await getTradeRegistrations(admin);

    const items = registrations
      .map(
        (item) => `
  <registration>
    <registration_id>${xmlEscape(
      item.registration_id
    )}</registration_id>

    <handle>${xmlEscape(
      item.handle
    )}</handle>

    <company>
      <name>${xmlEscape(
        item.company?.name
      )}</name>

      <address_1>${xmlEscape(
        item.company?.address_1
      )}</address_1>

      <address_2>${xmlEscape(
        item.company?.address_2
      )}</address_2>

      <country>${xmlEscape(
        item.company?.country
      )}</country>

      <city>${xmlEscape(
        item.company?.city
      )}</city>

      <county>${xmlEscape(
        item.company?.county
      )}</county>

      <postcode>${xmlEscape(
        item.company?.postcode
      )}</postcode>
    </company>

    <contact>
      <name>${xmlEscape(
        item.contact?.name
      )}</name>

      <email>${xmlEscape(
        item.contact?.email
      )}</email>

      <phone>${xmlEscape(
        item.contact?.phone
      )}</phone>
    </contact>

    <tax>
      <vat_registration_number>${xmlEscape(
        item.tax?.vat_registration_number
      )}</vat_registration_number>

      <eori_number>${xmlEscape(
        item.tax?.eori_number
      )}</eori_number>
    </tax>

    <credit>
      <requested>${xmlEscape(
        item.credit?.requested
      )}</requested>

      <limit_requested>${xmlEscape(
        item.credit?.limit_requested
      )}</limit_requested>

      <payment_terms>${xmlEscape(
        item.credit?.payment_terms
      )}</payment_terms>

      <trade_references>${xmlEscape(
        item.credit?.trade_references
      )}</trade_references>
    </credit>

    <certificate>
      <id>${xmlEscape(
        item.certificate?.id
      )}</id>

      <url>${xmlEscape(
        item.certificate?.url
      )}</url>

      <mime_type>${xmlEscape(
        item.certificate?.mime_type
      )}</mime_type>

      <file_size>${xmlEscape(
        item.certificate?.file_size
      )}</file_size>

      <filename>${xmlEscape(
        item.certificate?.filename
      )}</filename>
    </certificate>

    <workflow>
      <status>${xmlEscape(
        item.workflow?.status
      )}</status>

      <integration_status>${xmlEscape(
        item.workflow?.integration_status
      )}</integration_status>

      <bc_customer_number>${xmlEscape(
        item.workflow?.bc_customer_number
      )}</bc_customer_number>
    </workflow>

    <submitted_at>${xmlEscape(
      item.submitted_at
    )}</submitted_at>

    <updated_at>${xmlEscape(
      item.updated_at
    )}</updated_at>
  </registration>`
      )
      .join("");

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<trade_account_registrations count="${registrations.length}" exported_at="${xmlEscape(
        new Date().toISOString()
      )}">\n` +
      items +
      `\n</trade_account_registrations>`;

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type":
          "application/xml; charset=utf-8",

        "Content-Disposition":
          'attachment; filename="trade-account-registrations.xml"',

        "Cache-Control":
          "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error(
      "XML EXPORT ERROR:",
      error
    );

    return new Response(
      error?.message ||
        "Unable to export registrations.",
      {
        status: 500,
        headers: {
          "Content-Type":
            "text/plain; charset=utf-8",
        },
      }
    );
  }
}