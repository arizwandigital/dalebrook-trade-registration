import {
  authenticate,
} from "../shopify.server";

import {
  approveTradeRegistration,
} from "../services/trade-customer.server";

export async function action({
  request,
}) {
  try {
    const { admin } =
      await authenticate.admin(
        request
      );

    const formData =
      await request.formData();

    const registrationId =
      String(
        formData.get(
          "registration_id"
        ) || ""
      ).trim();

    if (!registrationId) {
      return Response.json(
        {
          success: false,
          message:
            "Registration ID is required.",
        },
        {
          status: 400,
        }
      );
    }

    const result =
      await approveTradeRegistration(
        admin,
        registrationId
      );

    return Response.json({
      success: true,

      created:
        result.created,

      company: {
        id:
          result.company?.id ||
          "",

        name:
          result.company?.name ||
          "",

        locationId:
          result.company
            ?.locationId ||
          "",

        contactId:
          result.company
            ?.contactId ||
          "",

        customerId:
          result.company
            ?.customerId ||
          "",
      },
    });
  } catch (error) {
    console.error(
      "[Approve Trade Registration]",
      error
    );

    return Response.json(
      {
        success: false,

        message:
          error?.message ||
          "Unable to approve trade registration.",
      },
      {
        status: 500,
      }
    );
  }
}