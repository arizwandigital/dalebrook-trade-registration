import { authenticate } from "../shopify.server";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function uploadCertificate(admin, file) {
  if (!file || !(file instanceof File) || file.size === 0) {
    return null;
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(
      "Certificate must be PDF, JPG or PNG."
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      "Certificate must be 10MB or smaller."
    );
  }

  /*
    1. Ask Shopify for a temporary staged upload target
  */
  const stagedResponse = await admin.graphql(
    `#graphql
      mutation StagedUploadsCreate(
        $input: [StagedUploadInput!]!
      ) {
        stagedUploadsCreate(input: $input) {
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
            filename: file.name,
            mimeType: file.type,
            resource: "FILE",
            httpMethod: "POST",
          },
        ],
      },
    }
  );

  const stagedJson =
    await stagedResponse.json();

  const stagedPayload =
    stagedJson?.data?.stagedUploadsCreate;

  if (stagedPayload?.userErrors?.length) {
    console.error(
      "Staged upload errors:",
      stagedPayload.userErrors
    );

    throw new Error(
      stagedPayload.userErrors[0]?.message ||
        "Unable to prepare certificate upload."
    );
  }

  const target =
    stagedPayload?.stagedTargets?.[0];

  if (!target) {
    throw new Error(
      "Shopify did not return an upload target."
    );
  }

  /*
    2. Upload actual binary file
  */
  const uploadForm = new FormData();

  for (const parameter of target.parameters) {
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

  const uploadResponse = await fetch(
    target.url,
    {
      method: "POST",
      body: uploadForm,
    }
  );

  if (!uploadResponse.ok) {
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
    3. Create permanent Shopify file
  */
  const fileCreateResponse =
    await admin.graphql(
      `#graphql
        mutation FileCreate(
          $files: [FileCreateInput!]!
        ) {
          fileCreate(files: $files) {
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

              contentType: "FILE",

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
    fileJson?.data?.fileCreate;

  if (filePayload?.userErrors?.length) {
    console.error(
      "File creation errors:",
      filePayload.userErrors
    );

    throw new Error(
      filePayload.userErrors[0]?.message ||
        "Unable to create certificate file in Shopify."
    );
  }

  const createdFile =
    filePayload?.files?.[0];

  if (!createdFile?.id) {
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

export async function action({ request }) {
  try {
    /*
      --------------------------------------------------
      APP PROXY DEBUG
      --------------------------------------------------
      Do not log the actual signature.
    */
    const proxyUrl =
      new URL(request.url);

    console.log(
      "[APP PROXY DEBUG]",
      {
        pathname:
          proxyUrl.pathname,

        shop:
          proxyUrl.searchParams.get(
            "shop"
          ),

        pathPrefix:
          proxyUrl.searchParams.get(
            "path_prefix"
          ),

        timestamp:
          proxyUrl.searchParams.get(
            "timestamp"
          ),

        loggedInCustomerId:
          proxyUrl.searchParams.get(
            "logged_in_customer_id"
          ),

        hasSignature:
          proxyUrl.searchParams.has(
            "signature"
          ),

        signatureLength:
          proxyUrl.searchParams.get(
            "signature"
          )?.length || 0,
      }
    );

    /*
      --------------------------------------------------
      AUTHENTICATE SHOPIFY APP PROXY
      --------------------------------------------------
    */
    let admin;

    try {
      const authContext =
        await authenticate.public.appProxy(
          request
        );

      admin = authContext?.admin;

      console.log(
        "[APP PROXY AUTH]",
        "Authentication successful"
      );
    } catch (authError) {
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

    /*
      We require Admin API access because
      this route uploads a file and creates
      a metaobject.
    */
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
      --------------------------------------------------
      READ FORM
      --------------------------------------------------
    */
    const formData =
      await request.formData();

    const getValue = (key) => {
      const value =
        formData.get(key);

      return typeof value === "string"
        ? value.trim()
        : "";
    };

    const companyName =
      getValue("company_name");

    const contactName =
      getValue("contact_name");

    const email =
      getValue("email");

    /*
      --------------------------------------------------
      REQUIRED VALUES
      --------------------------------------------------
    */
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
      --------------------------------------------------
      CERTIFICATE
      --------------------------------------------------
    */
    const certificate =
      formData.get(
        "certificate_of_incorporation"
      );

    if (
      !certificate ||
      !(certificate instanceof File) ||
      certificate.size === 0
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
      --------------------------------------------------
      CREDIT TERMS
      --------------------------------------------------
    */
    const creditRequested = [
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
      --------------------------------------------------
      METAOBJECT VALUES
      --------------------------------------------------
    */
    const values = {
      company_name:
        companyName,

      address_1:
        getValue("address_1"),

      address_2:
        getValue("address_2"),

      country:
        getValue("country"),

      postcode:
        getValue("postcode"),

      city:
        getValue("city"),

      county:
        getValue("county"),

      contact_name:
        contactName,

      email,

      phone:
        getValue("phone"),

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
        new Date().toISOString(),
    };

    /*
      --------------------------------------------------
      CREATE TRADE REGISTRATION METAOBJECT
      --------------------------------------------------
    */
    const response =
      await admin.graphql(
        `#graphql
          mutation CreateTradeRegistration(
            $metaobject: MetaobjectCreateInput!
          ) {
            metaobjectCreate(
              metaobject: $metaobject
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
      result?.data?.metaobjectCreate;

    /*
      --------------------------------------------------
      SHOPIFY USER ERRORS
      --------------------------------------------------
    */
    if (
      payload?.userErrors?.length
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
        },
        {
          status: 422,
        }
      );
    }

    if (!payload?.metaobject) {
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
      --------------------------------------------------
      SUCCESS
      --------------------------------------------------
    */
    console.log(
      "[TRADE REGISTRATION CREATED]",
      {
        id:
          payload.metaobject.id,

        handle:
          payload.metaobject.handle,

        company:
          companyName,
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
          payload.metaobject.displayName,
      },

      certificate: {
        id:
          certificateId,

        filename:
          certificate.name,
      },
    });
  } catch (error) {
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
        status: 500,
      }
    );
  }
}