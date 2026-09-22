import {
  useEffect,
  useState,
} from "react";

import {
  useFetcher,
} from "react-router";

import {
  useAppBridge,
} from "@shopify/app-bridge-react";

import {
  authenticate,
} from "../shopify.server";

export const loader = async ({
  request,
}) => {
  const { admin } =
    await authenticate.admin(
      request
    );

  const response =
    await admin.graphql(
      `#graphql
        query TradeAccountRegistrations {
          metaobjects(
            type: "trade_account_registration"
            first: 100
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

  const json =
    await response.json();

  if (json.errors?.length) {
    console.error(
      "Registration list GraphQL errors:",
      json.errors
    );

    return {
      success: false,
      message:
        "Unable to load trade registrations.",
      registrations: [],
    };
  }

  const registrations =
    json?.data?.metaobjects
      ?.nodes?.map(
        (node) => {
          const fields =
            Object.fromEntries(
              (
                node.fields || []
              ).map(
                (field) => [
                  field.key,
                  field.jsonValue ??
                    field.value,
                ]
              )
            );

          return {
            id: node.id,

            companyName:
              fields.company_name ||
              node.displayName ||
              "",

            contactName:
              fields.contact_name ||
              "",

            email:
              fields.email ||
              "",

            phone:
              fields.phone ||
              "",

            status:
              fields.status ||
              "Pending",

            integrationStatus:
              fields.integration_status ||
              "Awaiting BC",

            bcCustomerNumber:
              fields.bc_customer_number ||
              "",

            shopifyCustomerId:
              fields.shopify_customer_id ||
              "",

            shopifyCompanyId:
              fields.shopify_company_id ||
              "",

            shopifyCompanyLocationId:
              fields.shopify_company_location_id ||
              "",

            shopifyCompanyContactId:
              fields.shopify_company_contact_id ||
              "",

            approvedAt:
              fields.approved_at ||
              "",

            approvedBy:
              fields.approved_by ||
              "",

            submittedAt:
              fields.submitted_at ||
              node.updatedAt ||
              "",
          };
        }
      ) || [];

  return {
    success: true,
    registrations,
  };
};

export default function RegisteredLists() {
  const listFetcher =
    useFetcher();

  const approvalFetcher =
    useFetcher();

  const shopify =
    useAppBridge();

  const [
    approvingId,
    setApprovingId,
  ] = useState(null);

  useEffect(() => {
    if (
      !listFetcher.data &&
      listFetcher.state ===
        "idle"
    ) {
      listFetcher.load(
        "/app/registered-lists"
      );
    }
  }, []);

  useEffect(() => {
    if (
      approvalFetcher.state !==
        "idle" ||
      !approvalFetcher.data
    ) {
      return;
    }

    const result =
      approvalFetcher.data;

    setApprovingId(null);

    if (!result.success) {
      shopify.toast.show(
        result.message ||
          "Unable to approve registration"
      );

      return;
    }

    shopify.toast.show(
      result.created
        ? "Trade customer approved successfully"
        : "Trade customer already approved"
    );

    listFetcher.load(
      "/app/registered-lists"
    );
  }, [
    approvalFetcher.state,
    approvalFetcher.data,
    shopify,
  ]);

  const registrations =
    listFetcher.data
      ?.registrations || [];

  const loading =
    listFetcher.state !==
      "idle" &&
    !listFetcher.data;

  const approveRegistration =
    (registration) => {
      if (
        !registration?.id ||
        approvalFetcher.state !==
          "idle"
      ) {
        return;
      }

      const confirmed =
        window.confirm(
          `Approve ${registration.companyName} as a trade customer?`
        );

      if (!confirmed) {
        return;
      }

      setApprovingId(
        registration.id
      );

      approvalFetcher.submit(
        {
          registration_id:
            registration.id,
        },
        {
          method: "POST",
          action:
            "/app/approve-registration",
        }
      );
    };

  const getCompanyUrl = (
    companyId
  ) => {
    if (!companyId) {
      return "";
    }

    const numericId =
      String(companyId)
        .split("/")
        .pop();

    return numericId
      ? `shopify://admin/companies/${numericId}`
      : "";
  };

  return (
    <s-page heading="Registered Lists" inlineSize="large">
      <s-button
        slot="primary-action"
        onClick={() =>
          listFetcher.load(
            "/app/registered-lists"
          )
        }
        loading={
          listFetcher.state !==
          "idle"
        }
      >
        Refresh
      </s-button>

      <s-section>
        <s-stack
          direction="block"
          gap="base"
        >
          <s-text tone="subdued">
            Review all submitted trade registrations.
            A Shopify B2B company is created only
            when the registration is approved.
          </s-text>

          {loading ? (
            <s-text>
              Loading registrations...
            </s-text>
          ) : registrations.length ===
            0 ? (
            <s-text tone="subdued">
              No registrations found.
            </s-text>
          ) : (
            <div
              style={{
                overflowX:
                  "auto",
              }}
            >
              <table
                style={{
                  width:
                    "100%",
                  borderCollapse:
                    "collapse",
                  fontSize:
                    "14px",
                }}
              >
                <thead>
                  <tr
                    style={{
                      textAlign:
                        "left",
                      borderBottom:
                        "1px solid #dcdcdc",
                    }}
                  >
                    <th style={thStyle}>
                      Company
                    </th>

                    <th style={thStyle}>
                      Contact
                    </th>

                    <th style={thStyle}>
                      Email
                    </th>

                    <th style={thStyle}>
                      Status
                    </th>

                    <th style={thStyle}>
                      BC Status
                    </th>

                    <th style={thStyle}>
                      Shopify Company
                    </th>

                    <th style={thStyle}>
                      Submitted
                    </th>

                    <th style={thStyle}>
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {registrations.map(
                    (
                      registration
                    ) => {
                      const isPending =
                        registration.status ===
                        "Pending";

                      const isApproving =
                        approvingId ===
                          registration.id &&
                        approvalFetcher.state !==
                          "idle";

                      const companyUrl =
                        getCompanyUrl(
                          registration.shopifyCompanyId
                        );

                      return (
                        <tr
                          key={
                            registration.id
                          }
                          style={{
                            borderBottom:
                              "1px solid #eeeeee",
                          }}
                        >
                          <td
                            style={
                              tdStyle
                            }
                          >
                            <strong>
                              {
                                registration.companyName
                              }
                            </strong>
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            {
                              registration.contactName ||
                              "—"
                            }

                            {registration.phone ? (
                              <div
                                style={{
                                  marginTop:
                                    "4px",
                                  color:
                                    "#6d7175",
                                }}
                              >
                                {
                                  registration.phone
                                }
                              </div>
                            ) : null}
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            {
                              registration.email ||
                              "—"
                            }
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            <StatusBadge
                              value={
                                registration.status
                              }
                            />
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            <StatusBadge
                              value={
                                registration.integrationStatus
                              }
                            />

                            {registration.bcCustomerNumber ? (
                              <div
                                style={{
                                  marginTop:
                                    "5px",
                                }}
                              >
                                {
                                  registration.bcCustomerNumber
                                }
                              </div>
                            ) : null}
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            {registration.shopifyCompanyId ? (
                              <s-badge tone="success">
                                Created
                              </s-badge>
                            ) : (
                              <s-badge>
                                Not created
                              </s-badge>
                            )}
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            {registration.submittedAt
                              ? new Date(
                                  registration.submittedAt
                                ).toLocaleString()
                              : "—"}
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            <s-stack
                              direction="inline"
                              gap="small"
                            >
                              {isPending ? (
                                <s-button
                                  variant="primary"
                                  loading={
                                    isApproving
                                  }
                                  disabled={
                                    approvalFetcher.state !==
                                      "idle" &&
                                    !isApproving
                                  }
                                  onClick={() =>
                                    approveRegistration(
                                      registration
                                    )
                                  }
                                >
                                  Approve
                                </s-button>
                              ) : null}

                              {companyUrl ? (
                                <s-button
                                  href={
                                    companyUrl
                                  }
                                >
                                  View company
                                </s-button>
                              ) : null}
                            </s-stack>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function StatusBadge({
  value,
}) {
  const normalized =
    String(
      value || ""
    ).toLowerCase();

  if (
    normalized.includes(
      "approved"
    ) ||
    normalized.includes(
      "synced"
    )
  ) {
    return (
      <s-badge tone="success">
        {value}
      </s-badge>
    );
  }

  if (
    normalized.includes(
      "reject"
    ) ||
    normalized.includes(
      "error"
    )
  ) {
    return (
      <s-badge tone="critical">
        {value}
      </s-badge>
    );
  }

  return (
    <s-badge tone="attention">
      {value}
    </s-badge>
  );
}

const thStyle = {
  padding:
    "14px 12px",
  fontWeight:
    "600",
  whiteSpace:
    "nowrap",
  color:
    "#303030",
};

const tdStyle = {
  padding:
    "16px 12px",
  verticalAlign:
    "top",
};