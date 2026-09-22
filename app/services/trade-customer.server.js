function fieldMap(fields = []) {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.value ?? "",
    ])
  );
}

function splitName(fullName = "") {
  const parts = String(fullName)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastName:
      parts.length > 1
        ? parts.slice(1).join(" ")
        : "",
  };
}

function getCountryCode(country = "") {
  const value = String(country)
    .trim()
    .toLowerCase();

  const map = {
    "united kingdom": "GB",
    "great britain": "GB",
    "uk": "GB",
    "england": "GB",
    "scotland": "GB",
    "wales": "GB",
    "northern ireland": "GB",
    "ireland": "IE",
  };

  return map[value] || "GB";
}

export async function getTradeRegistration(
  admin,
  registrationId
) {
  const response = await admin.graphql(
    `#graphql
      query TradeRegistration($id: ID!) {
        metaobject(id: $id) {
          id
          handle
          displayName

          fields {
            key
            value
          }
        }
      }
    `,
    {
      variables: {
        id: registrationId,
      },
    }
  );

  const json = await response.json();

  if (json?.errors?.length) {
    console.error(
      "[B2B] Registration query errors:",
      json.errors
    );

    throw new Error(
      "Unable to load trade registration."
    );
  }

  const metaobject =
    json?.data?.metaobject;

  if (!metaobject) {
    throw new Error(
      "Trade registration was not found."
    );
  }

  return {
    id: metaobject.id,
    handle: metaobject.handle,
    displayName:
      metaobject.displayName,
    values: fieldMap(
      metaobject.fields
    ),
  };
}

async function createB2BCompany(
  admin,
  registration
) {
  const values =
    registration.values;

  const {
    firstName,
    lastName,
  } = splitName(
    values.contact_name
  );

  const countryCode =
    getCountryCode(
      values.country
    );

  const response =
    await admin.graphql(
      `#graphql
        mutation CreateTradeCompany(
          $input: CompanyCreateInput!
        ) {
          companyCreate(
            input: $input
          ) {
            company {
              id
              name

              mainContact {
                id

                customer {
                  id
                  email
                }
              }

              locations(first: 10) {
                nodes {
                  id
                  name
                }
              }
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
          input: {
            company: {
              name:
                values.company_name,
            },

            companyContact: {
              firstName:
                firstName ||
                "Trade",

              lastName:
                lastName ||
                "Customer",

              email:
                values.email,

              phone:
                values.phone ||
                undefined,
            },

            companyLocation: {
              name:
                values.company_name,

              phone:
                values.phone ||
                undefined,

              billingSameAsShipping:
                true,

              shippingAddress: {
                address1:
                  values.address_1 ||
                  undefined,

                address2:
                  values.address_2 ||
                  undefined,

                city:
                  values.city ||
                  undefined,

                zoneCode:
                  values.county ||
                  undefined,

                zip:
                  values.postcode ||
                  undefined,

                countryCode,

                firstName:
                  firstName ||
                  undefined,

                lastName:
                  lastName ||
                  undefined,

                recipient:
                  values.company_name ||
                  undefined,

                phone:
                  values.phone ||
                  undefined,
              },

              taxRegistrationId:
                values.vat_registration_number ||
                undefined,
            },
          },
        },
      }
    );

  const json =
    await response.json();

  const payload =
    json?.data?.companyCreate;

  if (
    payload?.userErrors?.length
  ) {
    console.error(
      "[B2B] Company creation errors:",
      payload.userErrors
    );

    throw new Error(
      payload.userErrors[0]
        ?.message ||
        "Unable to create Shopify B2B company."
    );
  }

  if (!payload?.company?.id) {
    console.error(
      "[B2B] Unexpected companyCreate response:",
      json
    );

    throw new Error(
      "Shopify did not return a company."
    );
  }

  const location =
    payload.company.locations
      ?.nodes?.[0];

  const contact =
    payload.company.mainContact;

  return {
    companyId:
      payload.company.id,

    companyName:
      payload.company.name,

    companyLocationId:
      location?.id || "",

    companyContactId:
      contact?.id || "",

    customerId:
      contact?.customer?.id ||
      "",

    customerEmail:
      contact?.customer?.email ||
      "",
  };
}

async function updateRegistrationApproval(
  admin,
  registration,
  b2b
) {
  const approvedAt =
    new Date().toISOString();

  const fields = [
    {
      key: "status",
      value: "Approved",
    },
    {
      key: "approved_at",
      value: approvedAt,
    },
    {
      key: "approved_by",
      value: "Shopify Admin",
    },
    {
      key:
        "shopify_company_id",
      value:
        b2b.companyId || "",
    },
    {
      key:
        "shopify_company_location_id",
      value:
        b2b.companyLocationId ||
        "",
    },
    {
      key:
        "shopify_company_contact_id",
      value:
        b2b.companyContactId ||
        "",
    },
  ];

  if (b2b.customerId) {
    fields.push({
      key:
        "shopify_customer_id",
      value:
        b2b.customerId,
    });
  }

  const response =
    await admin.graphql(
      `#graphql
        mutation UpdateTradeRegistration(
          $id: ID!
          $metaobject: MetaobjectUpdateInput!
        ) {
          metaobjectUpdate(
            id: $id
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
          id:
            registration.id,

          metaobject: {
            fields,
          },
        },
      }
    );

  const json =
    await response.json();

  const payload =
    json?.data?.metaobjectUpdate;

  if (
    payload?.userErrors?.length
  ) {
    console.error(
      "[B2B] Registration update errors:",
      payload.userErrors
    );

    throw new Error(
      payload.userErrors[0]
        ?.message ||
        "Unable to update trade registration."
    );
  }

  return {
    approvedAt,
  };
}

export async function approveTradeRegistration(
  admin,
  registrationId
) {
  const registration =
    await getTradeRegistration(
      admin,
      registrationId
    );

  const values =
    registration.values;

  /*
   * If already approved with a Shopify company,
   * do not create another one.
   */
  if (
    values.status ===
      "Approved" &&
    values.shopify_company_id
  ) {
    return {
      registration,
      created: false,

      company: {
        id:
          values.shopify_company_id,

        locationId:
          values.shopify_company_location_id ||
          "",

        contactId:
          values.shopify_company_contact_id ||
          "",

        customerId:
          values.shopify_customer_id ||
          "",
      },
    };
  }

  const b2b =
    await createB2BCompany(
      admin,
      registration
    );

  await updateRegistrationApproval(
    admin,
    registration,
    b2b
  );

  return {
    registration,
    created: true,

    company: {
      id:
        b2b.companyId,

      name:
        b2b.companyName,

      locationId:
        b2b.companyLocationId,

      contactId:
        b2b.companyContactId,

      customerId:
        b2b.customerId,
    },
  };
}