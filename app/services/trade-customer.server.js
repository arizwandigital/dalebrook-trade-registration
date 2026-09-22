function fieldMap(fields = []) {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.value ?? "",
    ])
  );
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
  };

  return map[value] || "GB";
}


/*
|--------------------------------------------------------------------------
| Get Trade Registration
|--------------------------------------------------------------------------
*/
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
      json.errors[0]?.message ||
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


/*
|--------------------------------------------------------------------------
| Find Existing Company Contact
|--------------------------------------------------------------------------
|
| A customer can already be attached to a CompanyContact from a previous
| partial approval attempt.
|
| Shopify's companyAssignCustomerAsContact mutation should not be called
| again in that case.
|
*/
async function getExistingCompanyContact(
  admin,
  customerId,
  expectedCompanyName = ""
) {
  const response = await admin.graphql(
    `#graphql
      query ExistingB2BContact($id: ID!) {
        customer(id: $id) {
          id
          email

          companyContactProfiles {
            id
            isMainContact

            company {
              id
              name

              defaultRole {
                id
                name
              }

              locations(first: 20) {
                nodes {
                  id
                  name
                }
              }
            }

            roleAssignments(first: 20) {
              nodes {
                id

                companyLocation {
                  id
                  name
                }

                role {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        id: customerId,
      },
    }
  );

  const json = await response.json();

  if (json?.errors?.length) {
    console.error(
      "[B2B] Customer company profile errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]?.message ||
        "Unable to check customer's B2B company."
    );
  }

  const profiles =
    json?.data?.customer
      ?.companyContactProfiles || [];

  if (!profiles.length) {
    return null;
  }

  const normalizedExpected =
    String(expectedCompanyName)
      .trim()
      .toLowerCase();

  if (normalizedExpected) {
    const matching =
      profiles.find(
        (profile) =>
          String(
            profile?.company?.name ||
              ""
          )
            .trim()
            .toLowerCase() ===
          normalizedExpected
      );

    if (matching) {
      return matching;
    }
  }

  /*
   * If there is only one B2B relationship,
   * reuse it.
   */
  if (profiles.length === 1) {
    return profiles[0];
  }

  /*
   * If the customer belongs to several companies
   * and none match the registration company,
   * don't guess.
   */
  throw new Error(
    "This customer is already associated with multiple B2B companies and none match this registration."
  );
}


/*
|--------------------------------------------------------------------------
| Create B2B Company + Company Location
|--------------------------------------------------------------------------
*/
async function createCompanyAndLocation(
  admin,
  registration
) {
  const values =
    registration.values;

  const countryCode =
    getCountryCode(
      values.country
    );

  const response = await admin.graphql(
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

            defaultRole {
              id
              name
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

              zip:
                values.postcode ||
                undefined,

              countryCode,

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

  if (json?.errors?.length) {
    console.error(
      "[B2B] companyCreate GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]?.message ||
        "Unable to create Shopify B2B company."
    );
  }

  const payload =
    json?.data?.companyCreate;

  if (payload?.userErrors?.length) {
    console.error(
      "[B2B] Company creation errors:",
      payload.userErrors
    );

    throw new Error(
      payload.userErrors[0]?.message ||
        "Unable to create Shopify B2B company."
    );
  }

  const company =
    payload?.company;

  if (!company?.id) {
    console.error(
      "[B2B] Unexpected companyCreate response:",
      json
    );

    throw new Error(
      "Shopify did not return a B2B company."
    );
  }

  const location =
    company.locations
      ?.nodes?.[0];

  return {
    companyId:
      company.id,

    companyName:
      company.name,

    locationId:
      location?.id || "",

    defaultRoleId:
      company.defaultRole?.id ||
      "",
  };
}


/*
|--------------------------------------------------------------------------
| Assign Existing Shopify Customer to Company
|--------------------------------------------------------------------------
|
| This creates the CompanyContact wrapper around the existing Customer.
|
*/
async function assignExistingCustomer(
  admin,
  companyId,
  customerId
) {
  const response = await admin.graphql(
    `#graphql
      mutation AssignTradeCustomer(
        $companyId: ID!
        $customerId: ID!
      ) {
        companyAssignCustomerAsContact(
          companyId: $companyId
          customerId: $customerId
        ) {
          companyContact {
            id
            isMainContact

            customer {
              id
              email
            }

            company {
              id
              name
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
        companyId,
        customerId,
      },
    }
  );

  const json =
    await response.json();

  if (json?.errors?.length) {
    console.error(
      "[B2B] Contact assignment GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]?.message ||
        "Unable to assign customer to company."
    );
  }

  const payload =
    json?.data
      ?.companyAssignCustomerAsContact;

  if (payload?.userErrors?.length) {
    console.error(
      "[B2B] Contact assignment errors:",
      payload.userErrors
    );

    throw new Error(
      payload.userErrors[0]?.message ||
        "Unable to assign customer to company."
    );
  }

  if (
    !payload?.companyContact?.id
  ) {
    throw new Error(
      "Shopify did not return a Company Contact."
    );
  }

  return payload.companyContact;
}


/*
|--------------------------------------------------------------------------
| Assign Company Contact Role
|--------------------------------------------------------------------------
|
| Shopify requires a role assignment for the Company Contact at the
| Company Location.
|
| Correct payload field:
| companyContactRoleAssignment
|
*/
async function assignDefaultRole(
  admin,
  contactId,
  locationId,
  roleId,
  existingRoleAssignments = []
) {
  if (
    !contactId ||
    !locationId ||
    !roleId
  ) {
    console.warn(
      "[B2B] Role assignment skipped because contact/location/role is missing.",
      {
        contactId,
        locationId,
        roleId,
      }
    );

    return;
  }

  const alreadyAssigned =
    existingRoleAssignments.some(
      (assignment) =>
        assignment
          ?.companyLocation
          ?.id ===
          locationId &&
        assignment
          ?.role
          ?.id ===
          roleId
    );

  if (alreadyAssigned) {
    console.log(
      "[B2B] Contact role already assigned."
    );

    return;
  }

  const response = await admin.graphql(
    `#graphql
      mutation AssignTradeRole(
        $companyContactId: ID!
        $companyContactRoleId: ID!
        $companyLocationId: ID!
      ) {
        companyContactAssignRole(
          companyContactId: $companyContactId
          companyContactRoleId: $companyContactRoleId
          companyLocationId: $companyLocationId
        ) {
          companyContactRoleAssignment {
            id

            companyLocation {
              id
              name
            }

            role {
              id
              name
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
        companyContactId:
          contactId,

        companyContactRoleId:
          roleId,

        companyLocationId:
          locationId,
      },
    }
  );

  const json =
    await response.json();

  if (json?.errors?.length) {
    console.error(
      "[B2B] Role GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]?.message ||
        "Unable to assign B2B role."
    );
  }

  const payload =
    json?.data
      ?.companyContactAssignRole;

  if (
    payload?.userErrors?.length
  ) {
    console.error(
      "[B2B] Role assignment errors:",
      payload.userErrors
    );

    throw new Error(
      payload.userErrors[0]?.message ||
        "Unable to assign B2B customer role."
    );
  }

  if (
    !payload
      ?.companyContactRoleAssignment
      ?.id
  ) {
    console.warn(
      "[B2B] Role mutation completed but no role assignment ID was returned."
    );
  }
}


/*
|--------------------------------------------------------------------------
| Update Shopify Customer Tags
|--------------------------------------------------------------------------
*/
async function updateCustomerTags(
  admin,
  customerId
) {
  /*
   * Remove pending approval tag.
   */
  const removeResponse =
    await admin.graphql(
      `#graphql
        mutation RemovePendingTradeTag(
          $id: ID!
          $tags: [String!]!
        ) {
          tagsRemove(
            id: $id
            tags: $tags
          ) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id:
            customerId,

          tags: [
            "Pending Trade Approval",
          ],
        },
      }
    );

  const removeJson =
    await removeResponse.json();

  if (
    removeJson?.errors?.length
  ) {
    console.error(
      "[B2B] Remove tag GraphQL errors:",
      removeJson.errors
    );

    throw new Error(
      removeJson.errors[0]?.message ||
        "Unable to update trade applicant tags."
    );
  }

  const removeErrors =
    removeJson?.data
      ?.tagsRemove
      ?.userErrors || [];

  if (removeErrors.length) {
    console.error(
      "[B2B] Remove tag errors:",
      removeErrors
    );

    throw new Error(
      removeErrors[0]?.message ||
        "Unable to remove pending trade tag."
    );
  }


  /*
   * Add approved tags.
   */
  const addResponse =
    await admin.graphql(
      `#graphql
        mutation AddApprovedTradeTags(
          $id: ID!
          $tags: [String!]!
        ) {
          tagsAdd(
            id: $id
            tags: $tags
          ) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id:
            customerId,

          tags: [
            "Trade Customer",
            "Trade Approved",
          ],
        },
      }
    );

  const addJson =
    await addResponse.json();

  if (
    addJson?.errors?.length
  ) {
    console.error(
      "[B2B] Add tag GraphQL errors:",
      addJson.errors
    );

    throw new Error(
      addJson.errors[0]?.message ||
        "Unable to update approved trade tags."
    );
  }

  const addErrors =
    addJson?.data
      ?.tagsAdd
      ?.userErrors || [];

  if (addErrors.length) {
    console.error(
      "[B2B] Add approved tag errors:",
      addErrors
    );

    throw new Error(
      addErrors[0]?.message ||
        "Unable to add approved trade tags."
    );
  }
}


/*
|--------------------------------------------------------------------------
| Update Registration Metaobject
|--------------------------------------------------------------------------
*/
async function updateRegistrationApproval(
  admin,
  registration,
  result
) {
  const approvedAt =
    new Date().toISOString();

  const fields = [
    {
      key: "status",
      value: "Approved",
    },

    {
      key:
        "shopify_company_id",
      value:
        result.companyId ||
        "",
    },

    {
      key:
        "shopify_company_location_id",
      value:
        result.locationId ||
        "",
    },

    {
      key:
        "shopify_company_contact_id",
      value:
        result.contactId ||
        "",
    },

    {
      key:
        "approved_at",
      value:
        approvedAt,
    },

    {
      key:
        "approved_by",
      value:
        result.approvedBy ||
        "Shopify Admin",
    },
  ];

  const response = await admin.graphql(
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

  if (json?.errors?.length) {
    console.error(
      "[B2B] Registration update GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]?.message ||
        "Unable to update trade registration."
    );
  }

  const errors =
    json?.data
      ?.metaobjectUpdate
      ?.userErrors || [];

  if (errors.length) {
    console.error(
      "[B2B] Registration update errors:",
      errors
    );

    throw new Error(
      errors[0]?.message ||
        "Unable to update trade registration."
    );
  }

  return approvedAt;
}


/*
|--------------------------------------------------------------------------
| APPROVE TRADE REGISTRATION
|--------------------------------------------------------------------------
|
| This function is intentionally idempotent.
|
| It can be called from:
|
| 1. Shopify app manual Approve button
| 2. Future Business Central approval callback
|
*/
export async function approveTradeRegistration(
  admin,
  registrationId,
  options = {}
) {
  const {
    approvedBy =
      "Shopify Admin",
  } = options;

  const registration =
    await getTradeRegistration(
      admin,
      registrationId
    );

  const values =
    registration.values;


  /*
   * Already completely approved.
   */
  if (
    values.status ===
      "Approved" &&
    values.shopify_company_id &&
    values.shopify_company_contact_id
  ) {
    return {
      registration,

      created: false,

      recovered: false,

      alreadyApproved:
        true,

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


  /*
   * Customer must already exist.
   *
   * Customer is created when trade registration
   * is submitted so the client's standard ERP
   * Customer API sync can see it.
   */
  const customerId =
    values.shopify_customer_id;

  if (!customerId) {
    throw new Error(
      "This registration does not have a Shopify Customer ID."
    );
  }


  /*
|--------------------------------------------------------------------------
| STEP 1
| Recover Existing B2B Relationship if Present
|--------------------------------------------------------------------------
*/
  const existingProfile =
    await getExistingCompanyContact(
      admin,
      customerId,
      values.company_name
    );


  let companyId;
  let companyName;
  let locationId;
  let defaultRoleId;
  let contactId;

  let existingRoles = [];

  let created = false;
  let recovered = false;


  if (existingProfile) {
    console.log(
      "[B2B] Existing Company Contact found. Reusing existing relationship."
    );

    recovered = true;

    companyId =
      existingProfile
        ?.company
        ?.id ||
      "";

    companyName =
      existingProfile
        ?.company
        ?.name ||
      values.company_name;

    locationId =
      existingProfile
        ?.company
        ?.locations
        ?.nodes?.[0]
        ?.id ||
      "";

    defaultRoleId =
      existingProfile
        ?.company
        ?.defaultRole
        ?.id ||
      "";

    contactId =
      existingProfile.id;

    existingRoles =
      existingProfile
        ?.roleAssignments
        ?.nodes ||
      [];


    if (!companyId) {
      throw new Error(
        "Existing B2B customer contact does not contain a Company ID."
      );
    }
  } else {
    /*
|--------------------------------------------------------------------------
| STEP 2
| Create Company + Location
|--------------------------------------------------------------------------
*/
    const company =
      await createCompanyAndLocation(
        admin,
        registration
      );

    companyId =
      company.companyId;

    companyName =
      company.companyName;

    locationId =
      company.locationId;

    defaultRoleId =
      company.defaultRoleId;


    /*
|--------------------------------------------------------------------------
| STEP 3
| Attach Existing Shopify Customer
|--------------------------------------------------------------------------
|
| Shopify specifically provides companyAssignCustomerAsContact
| for linking an existing Customer to a B2B Company.
|
*/
    const contact =
      await assignExistingCustomer(
        admin,
        companyId,
        customerId
      );

    contactId =
      contact.id;

    created =
      true;
  }


  /*
|--------------------------------------------------------------------------
| STEP 4
| Ensure B2B Location Role
|--------------------------------------------------------------------------
*/
  await assignDefaultRole(
    admin,
    contactId,
    locationId,
    defaultRoleId,
    existingRoles
  );


  /*
|--------------------------------------------------------------------------
| STEP 5
| Update Shopify Customer Status Tags
|--------------------------------------------------------------------------
|
| Before approval:
|
| Trade Applicant
| Pending Trade Approval
|
| After approval:
|
| Trade Applicant
| Trade Customer
| Trade Approved
|
*/
  await updateCustomerTags(
    admin,
    customerId
  );


  /*
|--------------------------------------------------------------------------
| STEP 6
| Save Company IDs to Registration Metaobject
|--------------------------------------------------------------------------
*/
  await updateRegistrationApproval(
    admin,
    registration,
    {
      companyId,
      locationId,
      contactId,
      approvedBy,
    }
  );


  return {
    registration,

    created,

    recovered,

    alreadyApproved:
      false,

    company: {
      id:
        companyId,

      name:
        companyName,

      locationId,

      contactId,

      customerId,
    },
  };
}