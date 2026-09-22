import { authenticate } from "../shopify.server";

import {
  ensureTradeApplicantCustomer,
} from "../services/trade-applicant.server";


const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

const MAX_FILE_SIZE =
  10 * 1024 * 1024;


/*
|--------------------------------------------------------------------------
| Upload Certificate
|--------------------------------------------------------------------------
*/
async function uploadCertificate(
  admin,
  file
) {
  if (
    !file ||
    !(file instanceof File) ||
    file.size === 0
  ) {
    return null;
  }

  if (
    !ALLOWED_TYPES.includes(
      file.type
    )
  ) {
    throw new Error(
      "Certificate must be PDF, JPG or PNG."
    );
  }

  if (
    file.size >
    MAX_FILE_SIZE
  ) {
    throw new Error(
      "Certificate must be 10MB or smaller."
    );
  }

  /*
   * 1. Create staged upload
   */
  const stagedResponse =
    await admin.graphql(
      `#graphql
        mutation StagedUploadsCreate(
          $input: [StagedUploadInput!]!
        ) {
          stagedUploadsCreate(
            input: $input
          ) {
            stagedTargets {
              url
              resourceUrl

              parameters {
                name
                value
              }
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          input: [
            {
              filename:
                file.name,

              mimeType:
                file.type,

              resource:
                "FILE",

              httpMethod:
                "POST",
            },
          ],
        },
      }
    );

  const stagedJson =
    await stagedResponse.json();

  const stagedPayload =
    stagedJson?.data
      ?.stagedUploadsCreate;

  if (
    stagedPayload
      ?.userErrors
      ?.length
  ) {
    console.error(
      "Staged upload errors:",
      stagedPayload.userErrors
    );

    throw new Error(
      stagedPayload
        .userErrors[0]
        ?.message ||
        "Unable to prepare certificate upload."
    );
  }

  const target =
    stagedPayload
      ?.stagedTargets?.[0];

  if (!target) {
    throw new Error(
      "Shopify did not return an upload target."
    );
  }


  /*
   * 2. Upload actual file
   */
  const uploadForm =
    new FormData();

  for (
    const parameter
    of target.parameters
  ) {
    uploadForm.append(
      parameter.name,
      parameter.value
    );
  }

  uploadForm.append(
    "file",
    file,
    file.name
  );

  const uploadResponse =
    await fetch(
      target.url,
      {
        method: "POST",
        body: uploadForm,
      }
    );

  if (
    !uploadResponse.ok
  ) {
    const uploadError =
      await uploadResponse
        .text()
        .catch(() => "");

    console.error(
      "Certificate binary upload failed:",
      uploadError
    );

    throw new Error(
      "Unable to upload certificate file."
    );
  }


  /*
   * 3. Create permanent Shopify File
   */
  const fileCreateResponse =
    await admin.graphql(
      `#graphql
        mutation FileCreate(
          $files: [FileCreateInput!]!
        ) {
          fileCreate(
            files: $files
          ) {
            files {
              id
              fileStatus
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          files: [
            {
              originalSource:
                target.resourceUrl,

              contentType:
                "FILE",

              alt:
                `Certificate of Incorporation - ${file.name}`,
            },
          ],
        },
      }
    );

  const fileJson =
    await fileCreateResponse.json();

  const filePayload =
    fileJson?.data
      ?.fileCreate;

  if (
    filePayload
      ?.userErrors
      ?.length
  ) {
    console.error(
      "File creation errors:",
      filePayload.userErrors
    );

    throw new Error(
      filePayload
        .userErrors[0]
        ?.message ||
        "Unable to create certificate file in Shopify."
    );
  }

  const createdFile =
    filePayload
      ?.files?.[0];

  if (
    !createdFile?.id
  ) {
    console.error(
      "Unexpected fileCreate response:",
      fileJson
    );

    throw new Error(
      "Shopify did not return a certificate file ID."
    );
  }

  return createdFile.id;
}


/*
|--------------------------------------------------------------------------
| Submit Trade Registration
|--------------------------------------------------------------------------
*/
export async function action({
  request,
}) {
  try {
    /*
     * Authenticate Shopify App Proxy
     */
    let admin;

    try {
      const authContext =
        await authenticate.public
          .appProxy(
            request
          );

      admin =
        authContext?.admin;
    } catch (
      authError
    ) {
      console.error(
        "[APP PROXY AUTH FAILED]",
        {
          name:
            authError?.name,

          message:
            authError?.message,

          status:
            authError?.status,
        }
      );

      return Response.json(
        {
          success: false,

          message:
            "App proxy authentication failed.",
        },
        {
          status: 401,
        }
      );
    }


    if (!admin) {
      console.error(
        "[APP PROXY AUTH]",
        "Authenticated request did not return an Admin API context."
      );

      return Response.json(
        {
          success: false,

          message:
            "App proxy authentication failed.",
        },
        {
          status: 401,
        }
      );
    }


    /*
     * Read submitted form
     */
    const formData =
      await request.formData();

    const getValue = (
      key
    ) => {
      const value =
        formData.get(key);

      return typeof value ===
        "string"
        ? value.trim()
        : "";
    };


    /*
     * Required fields
     */
    const companyName =
      getValue(
        "company_name"
      );

    const contactName =
      getValue(
        "contact_name"
      );

    const email =
      getValue(
        "email"
      );


    if (
      !companyName ||
      !contactName ||
      !email
    ) {
      return Response.json(
        {
          success: false,

          message:
            "Company name, contact name and email are required.",
        },
        {
          status: 400,
        }
      );
    }


    /*
     * Certificate
     */
    const certificate =
      formData.get(
        "certificate_of_incorporation"
      );

    if (
      !certificate ||
      !(
        certificate
        instanceof File
      ) ||
      certificate.size ===
        0
    ) {
      return Response.json(
        {
          success: false,

          message:
            "Certificate of Incorporation is required.",
        },
        {
          status: 400,
        }
      );
    }


    const certificateId =
      await uploadCertificate(
        admin,
        certificate
      );


    /*
     * Credit request
     */
    const creditRequested =
      [
        "true",
        "on",
        "1",
        "yes",
      ].includes(
        String(
          formData.get(
            "apply_for_credit_terms"
          )
        ).toLowerCase()
      );


    /*
|--------------------------------------------------------------------------
| Prepare Registration Values
|--------------------------------------------------------------------------
*/
    const values = {
      company_name:
        companyName,

      address_1:
        getValue(
          "address_1"
        ),

      address_2:
        getValue(
          "address_2"
        ),

      country:
        getValue(
          "country"
        ),

      postcode:
        getValue(
          "postcode"
        ),

      city:
        getValue(
          "city"
        ),

      county:
        getValue(
          "county"
        ),

      contact_name:
        contactName,

      email,

      phone:
        getValue(
          "phone"
        ),

      vat_registration_number:
        getValue(
          "vat_registration_number"
        ),

      eori_number:
        getValue(
          "eori_number"
        ),

      certificate:
        certificateId,

      apply_for_credit_terms:
        creditRequested
          ? "true"
          : "false",

      credit_limit_requested:
        getValue(
          "credit_limit_requested"
        ),

      payment_terms_preferred:
        getValue(
          "payment_terms_preferred"
        ),

      trade_references:
        getValue(
          "trade_references"
        ),

      status:
        "Pending",

      integration_status:
        "Awaiting BC",

      submitted_at:
        new Date()
          .toISOString(),
    };


    /*
|--------------------------------------------------------------------------
| Create / Find Shopify Customer
|--------------------------------------------------------------------------
|
| This is the important change required by the client's ERP integration.
|
| Customer is created immediately so their normal Shopify Customer API
| integration can receive the registration.
|
*/
    const applicantResult =
      await ensureTradeApplicantCustomer(
        admin,
        values
      );


    const shopifyCustomer =
      applicantResult
        ?.customer;


    if (
      !shopifyCustomer?.id
    ) {
      throw new Error(
        "Unable to create or identify the Shopify customer."
      );
    }


    /*
     * Link Customer to Trade Registration
     */
    values.shopify_customer_id =
      shopifyCustomer.id;


    console.log(
      "[TRADE APPLICANT CUSTOMER READY]",
      {
        customerId:
          shopifyCustomer.id,

        email:
          shopifyCustomer.email ||
          email,

        created:
          applicantResult.created,
      }
    );


    /*
|--------------------------------------------------------------------------
| Create Registration Metaobject
|--------------------------------------------------------------------------
|
| Metaobject remains the workflow/application record.
| Customer is the standard ERP sync record.
|
*/
    const response =
      await admin.graphql(
        `#graphql
          mutation CreateTradeRegistration(
            $metaobject:
              MetaobjectCreateInput!
          ) {
            metaobjectCreate(
              metaobject:
                $metaobject
            ) {
              metaobject {
                id
                handle
                displayName
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
                "trade_account_registration",

              values,
            },
          },
        }
      );


    const result =
      await response.json();


    const payload =
      result?.data
        ?.metaobjectCreate;


    /*
     * GraphQL level errors
     */
    if (
      result?.errors
        ?.length
    ) {
      console.error(
        "Metaobject GraphQL errors:",
        result.errors
      );

      throw new Error(
        result.errors[0]
          ?.message ||
          "Unable to create trade registration."
      );
    }


    /*
     * Metaobject validation errors
     */
    if (
      payload
        ?.userErrors
        ?.length
    ) {
      console.error(
        "Metaobject creation errors:",
        payload.userErrors
      );

      return Response.json(
        {
          success: false,

          message:
            "Shopify could not create the registration.",

          errors:
            payload.userErrors,

          customer: {
            id:
              shopifyCustomer.id,

            created:
              applicantResult.created,
          },
        },
        {
          status: 422,
        }
      );
    }


    if (
      !payload?.metaobject
    ) {
      console.error(
        "Unexpected Shopify response:",
        result
      );

      return Response.json(
        {
          success: false,

          message:
            "Unexpected Shopify API response.",
        },
        {
          status: 500,
        }
      );
    }


    /*
|--------------------------------------------------------------------------
| Success
|--------------------------------------------------------------------------
*/
    console.log(
      "[TRADE REGISTRATION CREATED]",
      {
        registrationId:
          payload.metaobject.id,

        handle:
          payload.metaobject.handle,

        company:
          companyName,

        customerId:
          shopifyCustomer.id,

        customerCreated:
          applicantResult.created,
      }
    );


    return Response.json({
      success: true,


      registration: {
        id:
          payload.metaobject.id,

        handle:
          payload.metaobject.handle,

        displayName:
          payload.metaobject
            .displayName,

        status:
          "Pending",
      },


      customer: {
        id:
          shopifyCustomer.id,

        email:
          shopifyCustomer.email ||
          email,

        created:
          applicantResult.created,

        status:
          "Pending Trade Approval",
      },


      certificate: {
        id:
          certificateId,

        filename:
          certificate.name,
      },
    });
  } catch (
    error
  ) {
    console.error(
      "Trade account registration error:",
      error
    );

    return Response.json(
      {
        success: false,

        message:
          error?.message ||
          "Unable to submit registration.",
      },
      {
        status: 422,
      }
    );
  }
}