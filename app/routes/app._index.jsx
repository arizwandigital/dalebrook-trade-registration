import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query TradeAccountDashboard {
        metaobjects(
          type: "trade_account_registration"
          first: 25
          reverse: true
        ) {
          nodes {
            id
            displayName
            updatedAt

            fields {
              key
              value
              jsonValue
            }
          }
        }
      }
    `
  );

  const json = await response.json();

  if (json.errors?.length) {
    console.error("Dashboard GraphQL errors:", json.errors);

    return {
      success: false,
      message: "Unable to load trade registrations.",
      errors: json.errors,
    };
  }

  const registrations =
    json?.data?.metaobjects?.nodes?.map((node) => {
      const fields = Object.fromEntries(
        (node.fields || []).map((field) => [
          field.key,
          field.jsonValue ?? field.value,
        ])
      );

      return {
        id: node.id,

        companyName:
          fields.company_name ||
          node.displayName ||
          "",

        contactName:
          fields.contact_name || "",

        email:
          fields.email || "",

        phone:
          fields.phone || "",

        status:
          fields.status || "Pending",

        integrationStatus:
          fields.integration_status ||
          "Awaiting BC",

        bcCustomerNumber:
          fields.bc_customer_number || "",

        submittedAt:
          fields.submitted_at ||
          node.updatedAt ||
          "",
      };
    }) || [];

  return {
    success: true,
    registrations,
  };
};

export default function Index() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const data = fetcher.data;

  useEffect(() => {
    if (
      !fetcher.data &&
      fetcher.state === "idle"
    ) {
      fetcher.submit(
        {},
        {
          method: "POST",
        }
      );
    }
  }, []);

  useEffect(() => {
    if (data?.success === false) {
      shopify.toast.show(
        data.message ||
          "Unable to load registrations"
      );
    }
  }, [data, shopify]);

  const registrations =
    data?.registrations || [];

  const pendingCount =
    registrations.filter(
      (item) =>
        item.status === "Pending"
    ).length;

  const awaitingBcCount =
    registrations.filter(
      (item) =>
        item.integrationStatus ===
        "Awaiting BC"
    ).length;

  const syncedCount =
    registrations.filter(
      (item) =>
        item.integrationStatus ===
        "Synced"
    ).length;

  const loading =
    fetcher.state !== "idle" &&
    !fetcher.data;

  const refreshDashboard = () => {
    fetcher.submit(
      {},
      {
        method: "POST",
      }
    );
  };

  const downloadExport = async (format) => {
    try {
      console.log(
        `[Trade Registration] Starting ${format} export`
      );

      const response = await fetch(
        `/app/export/${format}`,
        {
          method: "GET",
          credentials: "include",

          headers: {
            Accept:
              format === "json"
                ? "application/json"
                : format === "csv"
                  ? "text/csv"
                  : "application/xml",
          },
        }
      );

      console.log(
        `[Trade Registration] ${format} export response:`,
        response.status
      );

      if (!response.ok) {
        const errorText =
          await response.text();

        console.error(
          `[Trade Registration] ${format} export failed:`,
          response.status,
          errorText
        );

        throw new Error(
          `Unable to export ${format.toUpperCase()}`
        );
      }

      const blob = await response.blob();

      if (!blob || blob.size === 0) {
        throw new Error(
          `${format.toUpperCase()} export returned an empty file`
        );
      }

      const downloadUrl =
        window.URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = downloadUrl;

      link.download =
        `trade-account-registrations.${format}`;

      link.style.display = "none";

      document.body.appendChild(link);

      link.click();

      link.remove();

      setTimeout(() => {
        window.URL.revokeObjectURL(
          downloadUrl
        );
      }, 1500);

      shopify.toast.show(
        `${format.toUpperCase()} export downloaded`
      );
    } catch (error) {
      console.error(
        "[Trade Registration] Export error:",
        error
      );

      shopify.toast.show(
        error?.message ||
          "Export failed"
      );
    }
  };

  return (
    <s-page heading="Dalebrook Trade Registration">
      <s-button
        slot="primary-action"
        onClick={refreshDashboard}
        loading={fetcher.state !== "idle"}
      >
        Refresh
      </s-button>

      <s-section heading="Integration status">
        <s-stack
          direction="block"
          gap="base"
        >
          <s-banner tone="success">
            Registration API is active and connected to Shopify.
          </s-banner>

          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
            gap="base"
          >
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack
                direction="block"
                gap="small"
              >
                <s-text tone="subdued">
                  Registrations
                </s-text>

                <s-heading>
                  {registrations.length}
                </s-heading>
              </s-stack>
            </s-box>

            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack
                direction="block"
                gap="small"
              >
                <s-text tone="subdued">
                  Pending review
                </s-text>

                <s-heading>
                  {pendingCount}
                </s-heading>
              </s-stack>
            </s-box>

            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack
                direction="block"
                gap="small"
              >
                <s-text tone="subdued">
                  Awaiting BC
                </s-text>

                <s-heading>
                  {awaitingBcCount}
                </s-heading>
              </s-stack>
            </s-box>

            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack
                direction="block"
                gap="small"
              >
                <s-text tone="subdued">
                  Synced to BC
                </s-text>

                <s-heading>
                  {syncedCount}
                </s-heading>
              </s-stack>
            </s-box>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Export registration data">
        <s-stack
          direction="block"
          gap="base"
        >
          <s-text>
            Download all Trade Account Registration records directly from Shopify.
          </s-text>

          <s-stack
            direction="inline"
            gap="base"
          >
            <s-button
              onClick={() =>
                downloadExport("json")
              }
            >
              Download JSON
            </s-button>

            <s-button
              onClick={() =>
                downloadExport("csv")
              }
            >
              Download CSV
            </s-button>

            <s-button
              onClick={() =>
                downloadExport("xml")
              }
            >
              Download XML
            </s-button>
          </s-stack>

          <s-text tone="subdued">
            Exports include company, address, contact, tax, credit, certificate and Business Central workflow information.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="System status">
        <s-stack
          direction="block"
          gap="small"
        >
          <s-text>
            ✓ Trade registration form connected
          </s-text>

          <s-text>
            ✓ Metaobject storage active
          </s-text>

          <s-text>
            ✓ Certificate upload active
          </s-text>

          <s-text>
            ✓ External JSON feed active
          </s-text>

          <s-text>
            ✓ JSON admin export enabled
          </s-text>

          <s-text>
            ✓ CSV admin export enabled
          </s-text>

          <s-text>
            ✓ XML admin export enabled
          </s-text>

          <s-text>
            ✓ Shopify App Proxy active
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Latest registrations">
        {loading ? (
          <s-text>
            Loading registrations...
          </s-text>
        ) : registrations.length === 0 ? (
          <s-text tone="subdued">
            No trade account registrations found yet.
          </s-text>
        ) : (
          <s-stack
            direction="block"
            gap="base"
          >
            {registrations.map(
              (registration) => (
                <s-box
                  key={registration.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack
                    direction="block"
                    gap="small"
                  >
                    <s-heading>
                      {
                        registration.companyName
                      }
                    </s-heading>

                    <s-text>
                      Contact:{" "}
                      {registration.contactName ||
                        "—"}
                    </s-text>

                    <s-text>
                      Email:{" "}
                      {registration.email ||
                        "—"}
                    </s-text>

                    <s-text>
                      Phone:{" "}
                      {registration.phone ||
                        "—"}
                    </s-text>

                    <s-text>
                      Application status:{" "}
                      {
                        registration.status
                      }
                    </s-text>

                    <s-text>
                      Integration status:{" "}
                      {
                        registration.integrationStatus
                      }
                    </s-text>

                    {registration.bcCustomerNumber ? (
                      <s-text>
                        BC Customer No.:{" "}
                        {
                          registration.bcCustomerNumber
                        }
                      </s-text>
                    ) : null}

                    <s-text tone="subdued">
                      Submitted:{" "}
                      {registration.submittedAt
                        ? new Date(
                            registration.submittedAt
                          ).toLocaleString()
                        : "—"}
                    </s-text>
                  </s-stack>
                </s-box>
              )
            )}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Business Central integration">
        <s-stack
          direction="block"
          gap="small"
        >
          <s-text>
            Trade Account Registration submissions are stored in Shopify as metaobjects.
          </s-text>

          <s-text>
            The automated external Business Central integration feed is available through:
          </s-text>

          <s-box
            padding="base"
            background="subdued"
            borderRadius="base"
          >
            <code>
              /apps/trade-account/feed
            </code>
          </s-box>

          <s-text tone="subdued">
            The external JSON feed is protected using Bearer token authentication. JSON, CSV and XML manual exports above are available only to authenticated Shopify Admin users.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}