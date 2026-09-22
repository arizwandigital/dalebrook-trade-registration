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

function escapeSearchValue(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
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

    "united states": "US",
    "united states of america": "US",
    "usa": "US",

    "canada": "CA",
    "australia": "AU",
    "new zealand": "NZ",
  };

  return map[value] || null;
}

async function findCustomerByEmail(
  admin,
  email
) {
  const safeEmail =
    escapeSearchValue(email);

  const response =
    await admin.graphql(
      `#graphql
        query FindTradeApplicant(
          $query: String!
        ) {
          customers(
            first: 1
            query: $query
          ) {
            nodes {
              id
              email
              firstName
              lastName
              phone
              tags
            }
          }
        }
      `,
      {
        variables: {
          query:
            `email:"${safeEmail}"`,
        },
      }
    );

  const json =
    await response.json();

  if (
    json?.errors?.length
  ) {
    console.error(
      "[Trade Applicant] Customer search GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]
        ?.message ||
        "Unable to search Shopify customers."
    );
  }

  return (
    json?.data
      ?.customers
      ?.nodes?.[0] ||
    null
  );
}

async function addApplicantTags(
  admin,
  customerId
) {
  const response =
    await admin.graphql(
      `#graphql
        mutation AddTradeApplicantTags(
          $id: ID!
          $tags: [String!]!
        ) {
          tagsAdd(
            id: $id
            tags: $tags
          ) {
            node {
              id
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
          id: customerId,

          tags: [
            "Trade Applicant",
            "Pending Trade Approval",
          ],
        },
      }
    );

  const json =
    await response.json();

  const errors =
    json?.data
      ?.tagsAdd
      ?.userErrors || [];

  if (errors.length) {
    console.error(
      "[Trade Applicant] Tag errors:",
      errors
    );

    throw new Error(
      errors[0]?.message ||
        "Unable to tag trade applicant."
    );
  }
}

async function createApplicantCustomer(
  admin,
  values
) {
  const {
    firstName,
    lastName,
  } = splitName(
    values.contact_name
  );

  /*
   * IMPORTANT:
   * Create only the core customer here.
   * Address is created separately afterwards.
   */
  const response =
    await admin.graphql(
      `#graphql
        mutation CreateTradeApplicant(
          $input: CustomerInput!
        ) {
          customerCreate(
            input: $input
          ) {
            customer {
              id
              email
              firstName
              lastName
              phone
              tags
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
          input: {
            firstName:
              firstName ||
              undefined,

            lastName:
              lastName ||
              undefined,

            email:
              values.email,

            phone:
              values.phone ||
              undefined,

            note:
              values.company_name
                ? `Trade application: ${values.company_name}`
                : "Trade application",

            tags: [
              "Trade Applicant",
              "Pending Trade Approval",
            ],
          },
        },
      }
    );

  const json =
    await response.json();

  if (
    json?.errors?.length
  ) {
    console.error(
      "[Trade Applicant] customerCreate GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]
        ?.message ||
        "Unable to create Shopify customer."
    );
  }

  const payload =
    json?.data
      ?.customerCreate;

  if (
    payload
      ?.userErrors
      ?.length
  ) {
    console.error(
      "[Trade Applicant] Customer create errors:",
      payload.userErrors
    );

    throw new Error(
      payload.userErrors[0]
        ?.message ||
        "Unable to create Shopify customer."
    );
  }

  if (
    !payload
      ?.customer
      ?.id
  ) {
    console.error(
      "[Trade Applicant] Unexpected customerCreate response:",
      json
    );

    throw new Error(
      "Shopify did not return a customer."
    );
  }

  return payload.customer;
}

async function createCustomerAddress(
  admin,
  customerId,
  values
) {
  /*
   * If there is no usable address,
   * don't fail the registration.
   */
  if (
    !values.address_1 &&
    !values.city &&
    !values.postcode
  ) {
    return null;
  }

  const countryCode =
    getCountryCode(
      values.country
    );

  const {
    firstName,
    lastName,
  } = splitName(
    values.contact_name
  );

  /*
   * Shopify expects MailingAddressInput.
   * Do not pass county as provinceCode.
   */
  const address = {
    company:
      values.company_name ||
      undefined,

    firstName:
      firstName ||
      undefined,

    lastName:
      lastName ||
      undefined,

    address1:
      values.address_1 ||
      undefined,

    address2:
      values.address_2 ||
      undefined,

    city:
      values.city ||
      undefined,

    zip:
      values.postcode ||
      undefined,

    phone:
      values.phone ||
      undefined,
  };

  if (countryCode) {
    address.countryCode =
      countryCode;
  }

  const response =
    await admin.graphql(
      `#graphql
        mutation CreateTradeApplicantAddress(
          $customerId: ID!
          $address: MailingAddressInput!
          $setAsDefault: Boolean
        ) {
          customerAddressCreate(
            customerId:
              $customerId

            address:
              $address

            setAsDefault:
              $setAsDefault
          ) {
            address {
              id
              address1
              address2
              city
              zip
              country
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
          customerId,

          address,

          setAsDefault:
            true,
        },
      }
    );

  const json =
    await response.json();

  if (
    json?.errors?.length
  ) {
    console.error(
      "[Trade Applicant] Address GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]
        ?.message ||
        "Unable to create customer address."
    );
  }

  const payload =
    json?.data
      ?.customerAddressCreate;

  if (
    payload
      ?.userErrors
      ?.length
  ) {
    console.error(
      "[Trade Applicant] Address errors:",
      payload.userErrors
    );

    throw new Error(
      payload.userErrors[0]
        ?.message ||
        "Unable to create customer address."
    );
  }

  return (
    payload?.address ||
    null
  );
}

export async function ensureTradeApplicantCustomer(
  admin,
  values
) {
  if (!values.email) {
    throw new Error(
      "Email is required to create a trade applicant."
    );
  }

  /*
   * First see if this email already
   * exists as a Shopify Customer.
   */
  let customer =
    await findCustomerByEmail(
      admin,
      values.email
    );

  let created = false;

  if (customer) {
    /*
     * Existing customer:
     * do not create a duplicate.
     */
    await addApplicantTags(
      admin,
      customer.id
    );
  } else {
    /*
     * New customer.
     */
    customer =
      await createApplicantCustomer(
        admin,
        values
      );

    created = true;

    /*
     * Only create the address for
     * newly-created customers for now.
     */
    await createCustomerAddress(
      admin,
      customer.id,
      values
    );
  }

  return {
    customer,
    created,
  };
}