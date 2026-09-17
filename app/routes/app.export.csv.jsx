import { authenticate } from "../shopify.server";
import { getTradeRegistrations } from "../lib/trade-registrations.server";

function csvEscape(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '""';
  }

  return `"${String(value).replace(
    /"/g,
    '""'
  )}"`;
}

export async function loader({ request }) {
  // Keep authentication outside try/catch.
  const { admin } = await authenticate.admin(request);

  try {
    const registrations =
      await getTradeRegistrations(admin);

    const headers = [
      "registration_id",
      "handle",

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

      "certificate_id",
      "certificate_url",
      "certificate_mime_type",
      "certificate_file_size",
      "certificate_filename",

      "status",
      "integration_status",
      "bc_customer_number",

      "submitted_at",
      "updated_at",
    ];

    const rows =
      registrations.map(
        (registration) => ({
          registration_id:
            registration.registration_id,

          handle:
            registration.handle,

          company_name:
            registration.company?.name || "",

          address_1:
            registration.company?.address_1 || "",

          address_2:
            registration.company?.address_2 || "",

          country:
            registration.company?.country || "",

          city:
            registration.company?.city || "",

          county:
            registration.company?.county || "",

          postcode:
            registration.company?.postcode || "",

          contact_name:
            registration.contact?.name || "",

          email:
            registration.contact?.email || "",

          phone:
            registration.contact?.phone || "",

          vat_registration_number:
            registration.tax
              ?.vat_registration_number || "",

          eori_number:
            registration.tax
              ?.eori_number || "",

          apply_for_credit_terms:
            registration.credit?.requested ??
            false,

          credit_limit_requested:
            registration.credit
              ?.limit_requested || "",

          payment_terms_preferred:
            registration.credit
              ?.payment_terms || "",

          trade_references:
            registration.credit
              ?.trade_references || "",

          certificate_id:
            registration.certificate?.id || "",

          certificate_url:
            registration.certificate?.url || "",

          certificate_mime_type:
            registration.certificate
              ?.mime_type || "",

          certificate_file_size:
            registration.certificate
              ?.file_size ?? "",

          certificate_filename:
            registration.certificate
              ?.filename || "",

          status:
            registration.workflow?.status || "",

          integration_status:
            registration.workflow
              ?.integration_status || "",

          bc_customer_number:
            registration.workflow
              ?.bc_customer_number || "",

          submitted_at:
            registration.submitted_at || "",

          updated_at:
            registration.updated_at || "",
        })
      );

    const csvLines = [
      headers
        .map(csvEscape)
        .join(","),

      ...rows.map((row) =>
        headers
          .map((header) =>
            csvEscape(row[header])
          )
          .join(",")
      ),
    ];

    // UTF-8 BOM for Excel compatibility.
    const csv =
      "\uFEFF" +
      csvLines.join("\r\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type":
          "text/csv; charset=utf-8",

        "Content-Disposition":
          'attachment; filename="trade-account-registrations.csv"',

        "Cache-Control":
          "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error(
      "CSV EXPORT ERROR:",
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