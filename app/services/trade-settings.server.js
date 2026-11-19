export function parseTags(value = "") {
  return String(value)
    .split(/\r?\n|,/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function getApprovedExtraTags(admin) {
  try {
    const response = await admin.graphql(
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

    const json = await response.json();

    if (json?.errors?.length) {
      console.error(
        "[TRADE SETTINGS] GraphQL errors:",
        json.errors
      );

      return [];
    }

    const settings =
      json?.data
        ?.metaobjects
        ?.nodes?.[0];

    if (!settings) {
      console.log(
        "[TRADE SETTINGS] No trade_app_settings entry found."
      );

      return [];
    }

    const approvedTagsField =
      settings.fields?.find(
        (field) =>
          field.key ===
          "approved_tags"
      );

    const tags = parseTags(
      approvedTagsField?.value ||
        ""
    );

    console.log(
      "[TRADE SETTINGS] Extra approved tags:",
      tags
    );

    return tags;
  } catch (error) {
    console.error(
      "[TRADE SETTINGS] Unable to load approved tags:",
      error
    );

    /*
     * Extra tags are optional.
     * Approval must still work even if settings fail.
     */
    return [];
  }
}
