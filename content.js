// Content script that extracts information from the URL
// This runs in the context of the webpage

// Extract locationId and entityId from URL patterns
function extractUrlInfo() {
  const url = window.location.href;
  const urlObj = new URL(url);
  const pathname = urlObj.pathname;
  const hostname = urlObj.hostname;

  // Default response data structure
  const data = {
    prodLocationId: null,
    entityId: null,
    builderType: null,
  };

  // Extract information based on the host
  if (hostname === "app.gohighlevel.com") {
    // Extract the locationId from the path
    // Pattern: /location/{locationId}/...
    const locationMatch = pathname.match(/\/location\/([^\/]+)/);
    if (locationMatch && locationMatch[1]) {
      data.prodLocationId = locationMatch[1];
    }

    // Check for campaign URL pattern
    // Pattern: /location/{locationId}/emails/campaigns/create/{campaignId}
    const campaignMatch = pathname.match(
      /\/emails\/campaigns\/create\/([^\/]+)/
    );
    if (campaignMatch && campaignMatch[1]) {
      data.entityId = campaignMatch[1];
      data.builderType = "campaign";
      return data;
    }

    // Check for template URL pattern
    // Pattern: /location/{locationId}/emails/create/{templateId}/builder
    const templateMatch = pathname.match(/\/emails\/create\/([^\/]+)\/builder/);
    if (templateMatch && templateMatch[1]) {
      data.entityId = templateMatch[1];
      data.builderType = "template";
      return data;
    }
  }
  // Handle email-builder-prod.web.app URLs
  else if (hostname === "email-builder-prod.web.app") {
    // Try to extract location ID and entity ID from URL parameters
    const urlParams = new URLSearchParams(urlObj.search);
    const locationId = urlParams.get("locationId");
    const campaignId = urlParams.get("campaignId") || urlParams.get("id");
    const templateId = urlParams.get("templateId");

    if (locationId) {
      data.prodLocationId = locationId;
    }

    // Check if campaign ID exists in params
    if (campaignId) {
      data.entityId = campaignId;
      data.builderType = "campaign";
      return data;
    }

    // Check if template ID exists in params
    if (templateId) {
      data.entityId = templateId;
      data.builderType = "template";
      return data;
    }

    // If we can't find IDs in URL params, look in the page for embedded data
    try {
      // Look for campaign or template data in window.__INITIAL_STATE__ or similar
      if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.campaign) {
        data.entityId = window.__INITIAL_STATE__.campaign.id;
        data.builderType = "campaign";
        if (
          !data.prodLocationId &&
          window.__INITIAL_STATE__.campaign.locationId
        ) {
          data.prodLocationId = window.__INITIAL_STATE__.campaign.locationId;
        }
        return data;
      }

      if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.template) {
        data.entityId = window.__INITIAL_STATE__.template.id;
        data.builderType = "template";
        if (
          !data.prodLocationId &&
          window.__INITIAL_STATE__.template.locationId
        ) {
          data.prodLocationId = window.__INITIAL_STATE__.template.locationId;
        }
        return data;
      }
    } catch (error) {
      console.error("Error extracting data from window state:", error);
    }
  }

  // If we couldn't extract the information
  return data;
}

// Extract auth token from localStorage
function extractAuthToken() {
  try {
    // Try to find token in various localStorage keys
    const tokenKeys = [
      "token-id",
      "_pendo_visitorId.undefined",
      "a", // From previous localStorage inspection
    ];

    for (const key of tokenKeys) {
      const value = localStorage.getItem(key);
      if (
        value &&
        (value.includes("eyJ") ||
          (typeof value === "string" && value.includes("token")))
      ) {
        return value;
      }
    }

    // Look for JWT format in all localStorage items as fallback
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      if (value && typeof value === "string" && value.includes("eyJ")) {
        try {
          const parsed = JSON.parse(value);
          if (parsed && parsed.value && typeof parsed.value === "string") {
            return parsed.value;
          }
        } catch {
          // If it's not JSON but contains a JWT pattern
          if (
            value.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/)
          ) {
            return value;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error extracting auth token from localStorage:", error);
    return null;
  }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  try {
    if (request.action === "getUrlInfo") {
      const urlInfo = extractUrlInfo();
      const authToken = extractAuthToken();

      if (urlInfo.prodLocationId && urlInfo.entityId && urlInfo.builderType) {
        sendResponse({
          success: true,
          data: {
            ...urlInfo,
            authToken: authToken,
          },
        });
      } else {
        sendResponse({
          success: false,
          error: "Unable to extract information from the current URL",
          authToken: authToken, // Still send the token if we have it
        });
      }
    } else if (request.action === "getAuthToken") {
      const authToken = extractAuthToken();
      sendResponse({
        success: !!authToken,
        authToken: authToken,
      });
    }
  } catch (error) {
    console.error("Error in content script:", error);
    sendResponse({
      success: false,
      error: error.message || "Unknown error in content script",
    });
  }

  // Return true to indicate we will respond asynchronously
  return true;
});
