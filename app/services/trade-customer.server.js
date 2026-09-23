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
| Handles partially completed previous approvals.
|--------------------------------------------------------------------------
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

              mainContact {
                id
              }

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

  if (profiles.length === 1) {
    return profiles[0];
  }

  throw new Error(
    "This customer is already associated with multiple B2B companies and none match this registration."
  );
}

/*
|--------------------------------------------------------------------------
| Create Company + Location
|--------------------------------------------------------------------------
|
| No new contact is created here.
| The Shopify Customer already exists from registration.
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

            mainContact {
              id
            }

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

    mainContactId:
      company.mainContact?.id ||
      "",
  };
}

/*
|--------------------------------------------------------------------------
| Assign Existing Customer as Company Contact
|--------------------------------------------------------------------------
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
| Assign Main Contact
|--------------------------------------------------------------------------
|
| IMPORTANT FOR BUSINESS CENTRAL:
| BC can skip B2B companies that don't have a usable main contact.
|--------------------------------------------------------------------------
*/
async function assignMainContact(
  admin,
  companyId,
  contactId,
  existingMainContactId = ""
) {
  if (
    !companyId ||
    !contactId
  ) {
    return;
  }

  /*
   * Already correct.
   */
  if (
    existingMainContactId &&
    existingMainContactId ===
      contactId
  ) {
    console.log(
      "[B2B] Company main contact already assigned."
    );

    return;
  }

  const response = await admin.graphql(
    `#graphql
      mutation AssignCompanyMainContact(
        $companyId: ID!
        $companyContactId: ID!
      ) {
        companyAssignMainContact(
          companyId: $companyId
          companyContactId: $companyContactId
        ) {
          company {
            id
            name

            mainContact {
              id

              customer {
                id
                email
                firstName
                lastName
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
        companyId,
        companyContactId:
          contactId,
      },
    }
  );

  const json =
    await response.json();

  if (json?.errors?.length) {
    console.error(
      "[B2B] Main contact GraphQL errors:",
      json.errors
    );

    throw new Error(
      json.errors[0]?.message ||
        "Unable to assign company main contact."
    );
  }

  const payload =
    json?.data
      ?.companyAssignMainContact;

  if (
    payload?.userErrors?.length
  ) {
    console.error(
      "[B2B] Main contact assignment errors:",
      payload.userErrors
    );

    throw new Error(
      payload.userErrors[0]?.message ||
        "Unable to assign company main contact."
    );
  }

  if (
    !payload?.company
      ?.mainContact?.id
  ) {
    throw new Error(
      "Shopify did not return the assigned company main contact."
    );
  }

  console.log(
    "[B2B] Main contact assigned:",
    {
      companyId,
      contactId:
        payload.company
          .mainContact.id,
    }
  );
}

/*
|--------------------------------------------------------------------------
| Assign Location Role
|--------------------------------------------------------------------------
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
    throw new Error(
      removeErrors[0]?.message ||
        "Unable to remove pending trade tag."
    );
  }

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
| Safe for repeated calls.
| Can later be called by Business Central too.
|--------------------------------------------------------------------------
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
      alreadyApproved: true,

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

  const customerId =
    values.shopify_customer_id;

  if (!customerId) {
    throw new Error(
      "This registration does not have a Shopify Customer ID."
    );
  }

  /*
   * Check whether customer is already linked
   * from a previous partial approval.
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
  let existingMainContactId = "";
  let existingRoles = [];

  let created = false;
  let recovered = false;

  if (existingProfile) {
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

    existingMainContactId =
      existingProfile
        ?.company
        ?.mainContact
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
     * Create Company + Location.
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

    existingMainContactId =
      company.mainContactId;

    /*
     * Attach EXISTING Shopify Customer.
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
   * Ensure location permission.
   */
  await assignDefaultRole(
    admin,
    contactId,
    locationId,
    defaultRoleId,
    existingRoles
  );

  /*
   * IMPORTANT:
   * Set same contact as MAIN CONTACT
   * so BC can import the B2B company reliably.
   */
  await assignMainContact(
    admin,
    companyId,
    contactId,
    existingMainContactId
  );

  /*
   * Update customer tags.
   */
  await updateCustomerTags(
    admin,
    customerId
  );

  /*
   * Update registration.
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
    alreadyApproved: false,

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