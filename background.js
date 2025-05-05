// Background Service Worker
// Handles all API calls to avoid CORS issues

// Common headers for staging API calls
const getStandardStagingHeaders = (locationId) => ({
  version: "2021-04-15",
  channel: "ISTIO_MESH",
  source: "EMAIL_BUILDER",
  "source-id": locationId,
  "istio-workload-name": "emails",
  "Content-Type": "application/json",
});

// Common headers for production API calls
const getStandardProdHeaders = (locationId, authToken) => {
  // Base headers
  const headers = {
    version: "2021-07-28",
    channel: "APP",
    source: "WEB_USER",
    "source-id": locationId,
    "Content-Type": "application/json",
  };

  // Add auth token if available
  if (authToken) {
    headers["token-id"] = authToken;
  }

  return headers;
};

// Send progress update to popup
function sendProgressUpdate(status) {
  chrome.runtime.sendMessage({
    action: "migrationUpdate",
    status: status,
  });
}

// Extract authentication token from the active tab
async function getAuthToken() {
  try {
    // Get active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      throw new Error("No active tab found");
    }

    // Check if we can access the tab
    try {
      // Execute script to extract auth token from localStorage
      const result = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        function: () => {
          // Try to find token in various localStorage keys
          const tokenKeys = [
            "token-id",
            "_pendo_visitorId.undefined",
            "a", // From your localStorage screenshot
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
                if (
                  parsed &&
                  parsed.value &&
                  typeof parsed.value === "string"
                ) {
                  return parsed.value;
                }
              } catch {
                // If it's not JSON but contains a JWT pattern
                if (
                  value.match(
                    /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/
                  )
                ) {
                  return value;
                }
              }
            }
          }

          return null;
        },
      });

      // Check if we found a token
      if (result && result[0] && result[0].result) {
        const tokenValue = result[0].result;
        console.log("Found token", tokenValue.substring(0, 20) + "...");
        return tokenValue;
      }
    } catch (scriptError) {
      console.warn("Unable to execute script in tab:", scriptError.message);
      // The tab may not allow content script execution or communication
      // We'll continue without the token
    }

    console.warn("No authentication token found");
    return null;
  } catch (error) {
    console.error("Error extracting auth token:", error);
    return null;
  }
}

// Handle migration process
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "startMigration") {
    const {
      prodLocationId,
      prodEntityId,
      stagingLocationId,
      builderType,
      manualToken,
    } = request.data;

    // Start the migration process
    startMigrationProcess(
      prodLocationId,
      prodEntityId,
      stagingLocationId,
      builderType,
      manualToken
    )
      .then((result) => {
        sendResponse({
          success: true,
          newEntityId: result.newEntityId,
        });
      })
      .catch((error) => {
        console.error("Migration error:", error);
        sendResponse({
          success: false,
          error: error.message || "Unknown error occurred",
        });
      });

    // Return true to indicate we will respond asynchronously
    return true;
  }
});

// Main migration process
async function startMigrationProcess(
  prodLocationId,
  prodEntityId,
  stagingLocationId,
  builderType,
  manualToken
) {
  try {
    let authToken = manualToken;

    // If no manual token provided, try to get auth token from browser
    if (!authToken) {
      sendProgressUpdate("Extracting authentication token...");
      authToken = await getAuthToken();
    }

    if (!authToken) {
      throw new Error("Authentication token is required for API calls");
    }

    // Step 1: Fetch data from production
    sendProgressUpdate("Fetching data from production...");
    const prodData = await fetchProductionData(
      prodLocationId,
      prodEntityId,
      builderType, // We still pass the original builder type for API calls
      authToken
    );

    // Step 2: Create new entity in staging - always create a template
    sendProgressUpdate("Creating new template in staging...");
    const newEntityResult = await createStagingEntity(
      stagingLocationId,
      "template" // Always create a template regardless of source type
    );
    const newEntityId = newEntityResult.id;

    if (!newEntityId) {
      throw new Error("Failed to create new template in staging");
    }

    // Step 3: Update the new entity with production data
    sendProgressUpdate("Updating staging template with production data...");
    await updateStagingEntityData(
      stagingLocationId,
      newEntityId,
      prodData,
      "template" // Always update as a template
    );

    // Return the result
    return {
      success: true,
      newEntityId: newEntityId,
    };
  } catch (error) {
    console.error("Migration process error:", error);
    throw error;
  }
}

// Fetch data from production
async function fetchProductionData(
  locationId,
  entityId,
  builderType,
  authToken
) {
  try {
    let apiUrl;
    let alternateApiUrl;

    if (builderType === "template") {
      // Primary endpoint for templates
      apiUrl = `https://services.leadconnectorhq.com/emails/builder/data/${locationId}/${entityId}?isInternal=true`;
      // Alternate endpoint for templates
      alternateApiUrl = `https://backend.leadconnectorhq.com/emails/builder/data/${locationId}/${entityId}?isInternal=true`;

      // Additional endpoints to try if the primary ones fail
      const additionalEndpoints = [
        `https://services.leadconnectorhq.com/emails/builder/${locationId}/${entityId}`,
        `https://backend.leadconnectorhq.com/emails/builder/${locationId}/${entityId}`,
      ];

      // Try all endpoints until we get a successful response
      let response = await tryMultipleEndpoints(
        [apiUrl, alternateApiUrl, ...additionalEndpoints],
        locationId,
        authToken
      );

      if (response) {
        return response;
      }
    } else if (builderType === "campaign") {
      // Primary endpoint for campaigns
      apiUrl = `https://services.leadconnectorhq.com/emails/schedule/template-data/${locationId}/${entityId}`;
      // Alternate endpoint for campaigns
      alternateApiUrl = `https://backend.leadconnectorhq.com/emails/schedule/${locationId}/${entityId}`;
      // Additional endpoints to try
      const additionalEndpoints = [
        `https://services.leadconnectorhq.com/emails/schedule/data/${locationId}/${entityId}`,
        `https://backend.leadconnectorhq.com/emails/schedule/data/${locationId}/${entityId}`,
      ];

      // Try all endpoints until we get a successful response
      let response = await tryMultipleEndpoints(
        [apiUrl, alternateApiUrl, ...additionalEndpoints],
        locationId,
        authToken
      );

      if (response) {
        return response;
      }
    } else {
      throw new Error("Invalid builder type");
    }

    throw new Error("Failed to fetch production data: All endpoints failed");
  } catch (error) {
    console.error("Error fetching production data:", error);
    throw new Error(`Failed to fetch data from production: ${error.message}`);
  }
}

// Helper function to try multiple API endpoints
async function tryMultipleEndpoints(endpoints, locationId, authToken) {
  for (const endpoint of endpoints) {
    try {
      console.log(`Trying endpoint: ${endpoint}`);

      // Standard headers
      const headers = getStandardProdHeaders(locationId, authToken);

      // Try the endpoint
      const response = await fetch(endpoint, {
        method: "GET",
        headers: headers,
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`Success with endpoint: ${endpoint}`);
        return data;
      }

      console.log(
        `Endpoint ${endpoint} failed with status: ${response.status}`
      );
    } catch (error) {
      console.warn(`Error with endpoint ${endpoint}:`, error.message);
    }
  }

  // If we also want to try with a different header format as a last resort
  try {
    console.log("Trying with alternate headers...");
    const alternateHeaders = {
      accept: "application/json, text/plain, */*",
      channel: "APP",
      source: "WEB_USER",
      "source-id": locationId,
      "token-id": authToken,
      "Content-Type": "application/json",
    };

    const response = await fetch(endpoints[0], {
      method: "GET",
      headers: alternateHeaders,
    });

    if (response.ok) {
      const data = await response.json();
      console.log("Success with alternate headers!");
      return data;
    }
  } catch (error) {
    console.warn("Error with alternate headers:", error.message);
  }

  return null;
}

// Create new entity in staging - only used to create templates now
async function createStagingEntity(locationId, builderType) {
  try {
    // We always create a template now, but keeping the parameter for backward compatibility
    const apiUrl =
      "http://staging.services.leadconnectorhq.internal/emails/builder";
    const requestBody = {
      locationId: locationId,
      type: "blank",
      updatedBy: "7Xw0wYJ99ufWXkfSrEQ0", // This should be dynamically determined in a real app
      title: "Migrated Template",
      isPlainText: false,
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getStandardStagingHeaders(locationId),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create template in staging: ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();
    return { id: result.id || result.redirect };
  } catch (error) {
    console.error("Error creating staging template:", error);
    throw new Error(`Failed to create template in staging: ${error.message}`);
  }
}

// Update staging entity with production data
async function updateStagingEntityData(
  locationId,
  entityId,
  prodData,
  builderType
) {
  try {
    let apiUrl;
    let requestBody;

    // Extract the DND data properly from the response format
    // First, check if we have editorData in the response (newer API format)
    let dndData;
    let htmlContent = "";

    if (prodData.editorData) {
      console.log("Using editorData format from production");
      dndData = prodData.editorData;
      // Sometimes previewUrl contains the HTML content
      if (prodData.previewUrl) {
        try {
          const htmlResponse = await fetch(prodData.previewUrl);
          if (htmlResponse.ok) {
            htmlContent = await htmlResponse.text();
          }
        } catch (error) {
          console.warn("Could not fetch HTML from previewUrl:", error);
        }
      }
    } else if (prodData.dnd) {
      console.log("Using dnd format from production");
      dndData = prodData.dnd;
      htmlContent = prodData.html || "";
    } else {
      console.warn("No editor data found in production response");
      dndData = { elements: [], attrs: {}, templateSettings: {} };
    }

    if (builderType === "template") {
      apiUrl =
        "http://staging.services.leadconnectorhq.internal/emails/builder/data";
      requestBody = {
        locationId: locationId,
        templateId: entityId,
        updatedBy: "7Xw0wYJ99ufWXkfSrEQ0", // This should be dynamically determined in a real app
        dnd: dndData,
        html: htmlContent,
        editorType: "builder",
      };
    } else if (builderType === "campaign") {
      apiUrl =
        "http://staging.services.leadconnectorhq.internal/emails/schedule/template-data";
      requestBody = {
        locationId: locationId,
        updatedBy: "7Xw0wYJ99ufWXkfSrEQ0", // This should be dynamically determined in a real app
        dnd: dndData,
        html: htmlContent,
        editorType: "builder",
        campaignId: entityId,
      };
    } else {
      throw new Error("Invalid builder type");
    }

    // Log request details for debugging
    console.log("Sending update request to staging:", {
      url: apiUrl,
      entityId: entityId,
      dataFormat: prodData.editorData
        ? "editorData"
        : prodData.dnd
        ? "dnd"
        : "unknown",
    });

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: getStandardStagingHeaders(locationId),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to update entity data: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error("Error updating staging entity data:", error);
    throw new Error(`Failed to update entity data: ${error.message}`);
  }
}
