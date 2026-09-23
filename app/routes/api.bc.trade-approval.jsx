import {
  unauthenticated,
} from "../shopify.server";

import {
  approveTradeRegistration,
} from "../services/trade-customer.server";

const SHOP =
  process.env.BC_SHOP ||
  "dalebrook-app-dev.myshopify.com";

const BC_SECRET =
  process.env.BC_APPROVAL_SECRET ||
  "";

function json(
  data,
  status = 200
) {
  return Response.json(
    data,
    { status }
  );
}

async function findRegistrationByCustomerId(
  admin,
  customerId
) {
  const response =
    await admin.graphql(
      `#graphql
        query FindTradeRegistration(
          $type: String!
          $first: Int!
        ) {
          metaobjects(
            type: $type
            first: $first
          ) {
            nodes {
              id
              displayName

              fields {
                key
                value
              }
            }
          }
        }
      `,
      {
        variables: {
          type:
            "trade_account_registration",
          first: 100,
        },
      }
    );

  const result =
    await response.json();

  if (result?.errors?.length) {
    throw new Error(
      result.errors[0]?.message ||
        "Unable to search trade registrations."
    );
  }

  const nodes =
    result?.data
      ?.metaobjects
      ?.nodes || [];

  for (
    const node
    of nodes
  ) {
    const fields =
      Object.fromEntries(
        (node.fields || []).map(
          (field) => [
            field.key,
            field.value ?? "",
          ]
        )
      );

    if (
      fields.shopify_customer_id ===
      customerId
    ) {
      return {
        id: node.id,
        fields,
      };
    }
  }

  return null;
}

async function updateBcDetails(
  admin,
  registrationId,
  bcCustomerNumber
) {
  const fields = [
    {
      key:
        "integration_status",
      value:
        "Synced to BC",
    },
  ];

  if (bcCustomerNumber) {
    fields.push({
      key:
        "bc_customer_number",
      value:
        bcCustomerNumber,
    });
  }

  const response =
    await admin.graphql(
      `#graphql
        mutation UpdateBCStatus(
          $id: ID!
          $metaobject:
            MetaobjectUpdateInput!
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
            registrationId,

          metaobject: {
            fields,
          },
        },
      }
    );

  const result =
    await response.json();

  if (
    result?.errors?.length
  ) {
    throw new Error(
      result.errors[0]?.message ||
        "Unable to update BC status."
    );
  }

  const errors =
    result?.data
      ?.metaobjectUpdate
      ?.userErrors || [];

  if (errors.length) {
    throw new Error(
      errors[0]?.message ||
        "Unable to update BC status."
    );
  }
}

export async function action({
  request,
}) {
  try {
    if (
      request.method !==
      "POST"
    ) {
      return json(
        {
          success: false,
          message:
            "Method not allowed.",
        },
        405
      );
    }

    if (!BC_SECRET) {
      return json(
        {
          success: false,
          message:
            "BC approval secret is not configured.",
        },
        500
      );
    }

    const authHeader =
      request.headers.get(
        "authorization"
      ) || "";

    const expected =
      `Bearer ${BC_SECRET}`;

    if (
      authHeader !==
      expected
    ) {
      return json(
        {
          success: false,
          message:
            "Unauthorized.",
        },
        401
      );
    }

    const body =
      await request.json();

    const customerId =
      String(
        body
          ?.shopify_customer_id ||
          ""
      ).trim();

    const status =
      String(
        body?.status ||
        ""
      )
        .trim()
        .toLowerCase();

    const bcCustomerNumber =
      String(
        body
          ?.bc_customer_number ||
          ""
      ).trim();

    if (!customerId) {
      return json(
        {
          success: false,
          message:
            "shopify_customer_id is required.",
        },
        400
      );
    }

    if (
      status !==
      "approved"
    ) {
      return json(
        {
          success: false,
          message:
            "Only approved status is supported currently.",
        },
        400
      );
    }

    /*
     * This endpoint is called by BC,
     * not Shopify Admin.
     *
     * Use the app's stored offline
     * Shopify session.
     */
    const {
      admin,
    } =
      await unauthenticated.admin(
        SHOP
      );

    const registration =
      await findRegistrationByCustomerId(
        admin,
        customerId
      );

    if (!registration) {
      return json(
        {
          success: false,
          message:
            "No trade registration found for this Shopify customer.",
        },
        404
      );
    }

    /*
     * Save BC number/status first.
     */
    await updateBcDetails(
      admin,
      registration.id,
      bcCustomerNumber
    );

    /*
     * Reuse the exact same
     * approval logic as the
     * Shopify app button.
     */
    const result =
      await approveTradeRegistration(
        admin,
        registration.id,
        {
          approvedBy:
            "Business Central",
        }
      );

    return json({
      success: true,

      message:
        "Trade customer approved successfully.",

      registrationId:
        registration.id,

      shopifyCustomerId:
        customerId,

      bcCustomerNumber,

      company: {
        id:
          result.company
            ?.id || "",

        locationId:
          result.company
            ?.locationId ||
          "",

        contactId:
          result.company
            ?.contactId ||
          "",
      },
    });
  } catch (error) {
    console.error(
      "[BC Trade Approval]",
      error
    );

    return json(
      {
        success: false,

        message:
          error?.message ||
          "Unable to process BC approval.",
      },
      500
    );
  }
}