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

function normalizeEmail(value = "") {
  return String(value)
    .trim()
    .toLowerCase();
}

function getCountryCode(country = "") {
  const value = String(country)
    .trim()
    .toLowerCase();

  const map = {
    "united kingdom": "GB",
    "great britain": "GB",
    uk: "GB",
    england: "GB",
    scotland: "GB",
    wales: "GB",
    "northern ireland": "GB",
    ireland: "IE",

    "united states": "US",
    "united states of america": "US",
    usa: "US",

    canada: "CA",
    australia: "AU",
    "new zealand": "NZ",
  };

  return map[value] || null;
}

/*
|--------------------------------------------------------------------------
| Find Existing Shopify Customer By Email
|--------------------------------------------------------------------------
|
| This check is used BEFORE creating a trade applicant.
| If an exact email match already exists, registration must be rejected.
|
*/
async function findCustomerByEmail(
  admin,
  email
) {
  const normalizedEmail =
    normalizeEmail(email);

  if (!normalizedEmail) {
    return null;
  }

  const safeEmail =
    escapeSearchValue(
      normalizedEmail
    );

  const response =
    await admin.graphql(
      `#graphql
        query FindTradeApplicant(
          $query: String!
        ) {
          customers(
            first: 10
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
      "[Trade Applicant] Customer email search GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]
        ?.message ||
        "Unable to check whether this email address already exists."
    );
  }

  const customers =
    json?.data
      ?.customers
      ?.nodes || [];

  /*
   * Do an exact case-insensitive comparison.
   * Do not rely only on Shopify search matching.
   */
  const exactCustomer =
    customers.find(
      (customer) =>
        normalizeEmail(
          customer?.email
        ) === normalizedEmail
    );

  return (
    exactCustomer ||
    null
  );
}

/*
|--------------------------------------------------------------------------
| Create Trade Applicant Customer
|--------------------------------------------------------------------------
*/
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
              normalizeEmail(
                values.email
              ),

            phone:
              values.phone ||
              undefined,

            note:
              values.company_name
                ? `Trade application: ${values.company_name}`
                : "Trade application",

            /*
             * Keep existing static
             * registration tags.
             */
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

    /*
     * Duplicate phone errors currently
     * come from Shopify customerCreate.
     *
     * Preserve Shopify's actual message.
     */
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

/*
|--------------------------------------------------------------------------
| Create Customer Address
|--------------------------------------------------------------------------
*/
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

/*
|--------------------------------------------------------------------------
| Ensure Trade Applicant Customer
|--------------------------------------------------------------------------
|
| Rules:
|
| 1. Email is required.
| 2. Existing Shopify email = REJECT registration.
| 3. New email = create Shopify customer.
| 4. Duplicate phone is still rejected by Shopify customerCreate.
| 5. Address is created only after customer creation succeeds.
|
*/
export async function ensureTradeApplicantCustomer(
  admin,
  values
) {
  const email =
    normalizeEmail(
      values.email
    );

  if (!email) {
    throw new Error(
      "Email is required to create a trade applicant."
    );
  }

  /*
   * IMPORTANT:
   *
   * Do not reuse an existing Shopify customer.
   * A trade registration must use a unique
   * customer email address.
   */
  const existingCustomer =
    await findCustomerByEmail(
      admin,
      email
    );

  if (existingCustomer?.id) {
    console.warn(
      "[Trade Applicant] Duplicate email rejected:",
      {
        customerId:
          existingCustomer.id,

        email,
      }
    );

    throw new Error(
      "A customer with this email address already exists."
    );
  }

  /*
   * Email is unique.
   *
   * Now attempt customer creation.
   * Shopify customerCreate will also validate
   * duplicate phone numbers.
   */
  const customer =
    await createApplicantCustomer(
      admin,
      {
        ...values,
        email,
      }
    );

  /*
   * Only create the address after
   * customer creation succeeds.
   */
  await createCustomerAddress(
    admin,
    customer.id,
    values
  );

  return {
    customer,
    created: true,
  };
}