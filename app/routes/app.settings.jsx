import {
  Form,
  useActionData,
  useLoaderData,
} from "react-router";

import {
  authenticate,
} from "../shopify.server";

function getField(
  fields = [],
  key
) {
  return (
    fields.find(
      (field) =>
        field.key === key
    )?.value || ""
  );
}

export async function loader({
  request,
}) {
  const { admin } =
    await authenticate.admin(
      request
    );

  const response =
    await admin.graphql(
      `#graphql
        query TradeAppSettings {
          metaobjects(
            type: "trade_app_settings"
            first: 1
          ) {
            nodes {
              id
              handle

              fields {
                key
                value
              }
            }
          }
        }
      `
    );

  const json =
    await response.json();

  if (json?.errors?.length) {
    console.error(
      "[SETTINGS] Query errors:",
      json.errors
    );

    throw new Error(
      "Unable to load trade settings."
    );
  }

  const settings =
    json?.data
      ?.metaobjects
      ?.nodes?.[0];

  return {
    settingsId:
      settings?.id || "",

    approvedTags:
      getField(
        settings?.fields,
        "approved_tags"
      ),
  };
}

export async function action({
  request,
}) {
  const { admin } =
    await authenticate.admin(
      request
    );

  const formData =
    await request.formData();

  const approvedTags =
    String(
      formData.get(
        "approved_tags"
      ) || ""
    ).trim();

  /*
   * Find existing settings entry.
   */
  const lookupResponse =
    await admin.graphql(
      `#graphql
        query TradeAppSettings {
          metaobjects(
            type: "trade_app_settings"
            first: 1
          ) {
            nodes {
              id
              handle
            }
          }
        }
      `
    );

  const lookupJson =
    await lookupResponse.json();

  const existing =
    lookupJson?.data
      ?.metaobjects
      ?.nodes?.[0];

  /*
   * Update existing settings entry.
   */
  if (existing?.id) {
    const response =
      await admin.graphql(
        `#graphql
          mutation UpdateTradeSettings(
            $id: ID!
            $metaobject: MetaobjectUpdateInput!
          ) {
            metaobjectUpdate(
              id: $id
              metaobject: $metaobject
            ) {
              metaobject {
                id
              }

              userErrors {
                field
                message
                code
              }
            }
          }
        `,
        {
          variables: {
            id:
              existing.id,

            metaobject: {
              fields: [
                {
                  key:
                    "approved_tags",

                  value:
                    approvedTags,
                },
              ],
            },
          },
        }
      );

    const json =
      await response.json();

    const errors =
      json?.data
        ?.metaobjectUpdate
        ?.userErrors || [];

    if (errors.length) {
      console.error(
        "[SETTINGS] Update errors:",
        errors
      );

      return {
        success: false,
        message:
          errors[0]?.message ||
          "Unable to save settings.",
      };
    }

    return {
      success: true,
      message:
        "Settings saved successfully.",
    };
  }

  /*
   * No settings entry yet:
   * create it automatically.
   */
  const response =
    await admin.graphql(
      `#graphql
        mutation CreateTradeSettings(
          $metaobject: MetaobjectCreateInput!
        ) {
          metaobjectCreate(
            metaobject: $metaobject
          ) {
            metaobject {
              id
              handle
            }

            userErrors {
              field
              message
              code
            }
          }
        }
      `,
      {
        variables: {
          metaobject: {
            type:
              "trade_app_settings",

            values: {
              approved_tags:
                approvedTags,
            },
          },
        },
      }
    );

  const json =
    await response.json();

  const errors =
    json?.data
      ?.metaobjectCreate
      ?.userErrors || [];

  if (errors.length) {
    console.error(
      "[SETTINGS] Create errors:",
      errors
    );

    return {
      success: false,
      message:
        errors[0]?.message ||
        "Unable to create settings.",
    };
  }

  return {
    success: true,
    message:
      "Settings saved successfully.",
  };
}

export default function TradeSettingsPage() {
  const {
    approvedTags,
  } = useLoaderData();

  const actionData =
    useActionData();

  return (
    <s-page heading="Trade account settings">
      <s-section heading="Customer tags">

        <s-stack
          direction="block"
          gap="base"
        >
          <s-text>
            Configure additional customer
            tags that should be added when
            a trade registration is approved.
          </s-text>

          <s-text tone="subdued">
            The existing Trade Customer and
            Trade Approved tags will always
            be added automatically.
          </s-text>

          {actionData?.message ? (
            <s-banner
              tone={
                actionData.success
                  ? "success"
                  : "critical"
              }
            >
              {actionData.message}
            </s-banner>
          ) : null}

          <Form method="post">

            <div
              style={{
                maxWidth: "640px",
              }}
            >
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: "600",
                }}
                htmlFor="approved_tags"
              >
                Additional approved
                customer tags
              </label>

              <textarea
                id="approved_tags"
                name="approved_tags"
                defaultValue={
                  approvedTags
                }
                rows={8}
                placeholder={
                  "B2B\nWholesale\nTrade"
                }
                style={{
                  display: "block",
                  width: "100%",
                  padding: "12px",
                  marginBottom: "8px",
                  border:
                    "1px solid #8a8a8a",
                  borderRadius: "8px",
                  font:
                    "inherit",
                }}
              />

              <p
                style={{
                  marginTop: 0,
                  marginBottom: "20px",
                  color: "#616161",
                  fontSize: "13px",
                }}
              >
                Enter one tag per line.
              </p>

              <s-button
                type="submit"
                variant="primary"
              >
                Save settings
              </s-button>

            </div>

          </Form>
        </s-stack>

      </s-section>
    </s-page>
  );
}