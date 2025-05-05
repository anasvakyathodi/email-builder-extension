document.addEventListener("DOMContentLoaded", function () {
  const stagingLocationIdInput = document.getElementById("stagingLocationId");
  const migrateButton = document.getElementById("migrateButton");
  const loadingIndicator = document.getElementById("loadingIndicator");
  const statusMessage = document.getElementById("statusMessage");
  const authTokenInput = document.getElementById("authToken");
  const manualEntryCheckbox = document.getElementById("manualEntryCheckbox");

  // Add new fields for manual production ID entry
  const prodLocationIdContainer = document.createElement("div");
  prodLocationIdContainer.className = "form-group";
  prodLocationIdContainer.innerHTML = `
    <label for="prodLocationId">Production Location ID:</label>
    <input type="text" id="prodLocationId" placeholder="Enter production location ID">
  `;

  const prodEntityIdContainer = document.createElement("div");
  prodEntityIdContainer.className = "form-group";
  prodEntityIdContainer.innerHTML = `
    <label for="prodEntityId">Production Entity ID:</label>
    <input type="text" id="prodEntityId" placeholder="Enter production entity ID">
  `;

  // Insert after auth token
  authTokenInput.parentNode.after(prodLocationIdContainer);
  prodLocationIdContainer.after(prodEntityIdContainer);

  const prodLocationIdInput = document.getElementById("prodLocationId");
  const prodEntityIdInput = document.getElementById("prodEntityId");

  // Initially hide the manual fields
  prodLocationIdContainer.style.display = "none";
  prodEntityIdContainer.style.display = "none";

  // Toggle manual entry fields
  manualEntryCheckbox.addEventListener("change", function () {
    prodLocationIdContainer.style.display = this.checked ? "block" : "none";
    prodEntityIdContainer.style.display = this.checked ? "block" : "none";

    // If manual mode is enabled, try to extract IDs from URL
    if (this.checked) {
      prefillFromUrl();
    }
  });

  // Function to extract and prefill IDs from URL when in manual mode
  async function prefillFromUrl() {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length === 0) return;

      const tab = tabs[0];
      const url = tab.url;

      if (
        !url.includes("app.gohighlevel.com") &&
        !url.includes("email-builder-prod.web.app")
      ) {
        return;
      }

      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Try to extract campaign or template ID from URL
      let entityId = null;

      if (url.includes("app.gohighlevel.com")) {
        // Extract locationId from /location/{locationId}/ pattern
        const locationMatch = pathname.match(/\/location\/([^\/]+)/);
        if (locationMatch && locationMatch[1]) {
          prodLocationIdInput.value = locationMatch[1];
        }

        // Check for campaign ID
        const campaignMatch = pathname.match(
          /\/emails\/campaigns\/create\/([^\/]+)/
        );
        if (campaignMatch && campaignMatch[1]) {
          entityId = campaignMatch[1];
        }

        // Check for template ID
        const templateMatch = pathname.match(
          /\/emails\/create\/([^\/]+)\/builder/
        );
        if (templateMatch && templateMatch[1]) {
          entityId = templateMatch[1];
        }
      } else if (url.includes("email-builder-prod.web.app")) {
        // Extract from query parameters
        const urlParams = new URLSearchParams(urlObj.search);

        if (urlParams.get("locationId")) {
          prodLocationIdInput.value = urlParams.get("locationId");
        }

        const campaignId = urlParams.get("campaignId") || urlParams.get("id");
        const templateId = urlParams.get("templateId");

        if (campaignId) {
          entityId = campaignId;
        } else if (templateId) {
          entityId = templateId;
        }
      }

      // Update the entity ID field
      if (entityId) {
        prodEntityIdInput.value = entityId;
      }
    } catch (error) {
      console.error("Error prefilling from URL:", error);
    }
  }

  // Load saved values if available
  chrome.storage.local.get(
    ["stagingLocationId", "prodLocationId", "authToken"],
    function (result) {
      if (result.stagingLocationId) {
        stagingLocationIdInput.value = result.stagingLocationId;
      }
      if (result.prodLocationId) {
        prodLocationIdInput.value = result.prodLocationId;
      }
      if (result.authToken) {
        authTokenInput.value = result.authToken;
      }

      // Try to prefill from URL if manual mode is already enabled
      if (manualEntryCheckbox.checked) {
        prefillFromUrl();
      }
    }
  );

  // Get the current tab URL and extract information
  async function getCurrentTabInfo() {
    // Validate auth token first - we need this regardless of mode
    const authToken = authTokenInput.value.trim();
    if (!authToken) {
      showStatus("error", "Please enter an authentication token");
      return;
    }

    // Check if manual entry is enabled
    if (manualEntryCheckbox.checked) {
      const prodLocationId = prodLocationIdInput.value.trim();
      const prodEntityId = prodEntityIdInput.value.trim();

      if (!prodLocationId || !prodEntityId) {
        showStatus(
          "error",
          "Please enter both production location ID and entity ID"
        );
        return;
      }

      // Use manually entered values
      processPageData({
        prodLocationId: prodLocationId,
        entityId: prodEntityId,
      });

      return;
    }

    // Otherwise, extract from URL
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tabs.length === 0) {
      showStatus("error", "No active tab found");
      return null;
    }

    // Check if the URL is from the expected domain
    const tab = tabs[0];
    if (
      !tab.url.includes("app.gohighlevel.com") &&
      !tab.url.includes("email-builder-prod.web.app")
    ) {
      showStatus(
        "error",
        "Please navigate to a GoHighLevel email builder page or enable manual ID entry"
      );
      return null;
    }

    // Request the URL data from the content script
    try {
      chrome.tabs.sendMessage(
        tab.id,
        { action: "getUrlInfo" },
        function (response) {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            console.error("Communication error:", errorMsg);

            // Enable manual mode and try to prefill from URL directly
            manualEntryCheckbox.checked = true;
            prodLocationIdContainer.style.display = "block";
            prodEntityIdContainer.style.display = "block";
            prefillFromUrl();

            showStatus(
              "error",
              "Error communicating with page: " +
                errorMsg +
                ". Manual entry mode has been enabled with data from the URL."
            );
            return;
          }

          if (response && response.success) {
            processPageData(response.data);
          } else {
            // Enable manual mode and try to prefill from URL directly
            manualEntryCheckbox.checked = true;
            prodLocationIdContainer.style.display = "block";
            prodEntityIdContainer.style.display = "block";
            prefillFromUrl();

            showStatus(
              "error",
              "Failed to extract information from the page. Manual entry mode has been enabled with data from the URL."
            );
          }
        }
      );
    } catch (error) {
      console.error("Error sending message:", error);

      // Enable manual mode and try to prefill from URL directly
      manualEntryCheckbox.checked = true;
      prodLocationIdContainer.style.display = "block";
      prodEntityIdContainer.style.display = "block";
      prefillFromUrl();

      showStatus(
        "error",
        "Failed to communicate with the page. Manual entry mode has been enabled with data from the URL."
      );
    }
  }

  // Process the data extracted from the page
  function processPageData(data) {
    const stagingLocationId = stagingLocationIdInput.value.trim();
    const authToken = authTokenInput.value.trim();

    if (!stagingLocationId) {
      showStatus("error", "Please enter a staging location ID");
      return;
    }

    if (!authToken) {
      showStatus("error", "Please enter an authentication token");
      return;
    }

    if (!data.prodLocationId || !data.entityId) {
      showStatus(
        "error",
        "Could not extract required information from the URL. Try enabling manual entry mode."
      );
      return;
    }

    // Save the values for future use
    chrome.storage.local.set({
      stagingLocationId: stagingLocationId,
      prodLocationId: data.prodLocationId,
      authToken: authToken,
    });

    // Update the manual entry fields with the extracted values
    prodLocationIdInput.value = data.prodLocationId;
    prodEntityIdInput.value = data.entityId;

    // Show loading state
    setLoading(true);

    // Send request to background script to start the migration process
    // Always use "template" as the builder type
    chrome.runtime.sendMessage(
      {
        action: "startMigration",
        data: {
          prodLocationId: data.prodLocationId,
          prodEntityId: data.entityId,
          stagingLocationId: stagingLocationId,
          builderType: "template", // Always create a template regardless of the source type
          manualToken: authToken,
        },
      },
      function (response) {
        setLoading(false);

        if (response.success) {
          showStatus(
            "success",
            `Successfully migrated to staging!<br>New template ID: ${response.newEntityId}`
          );
        } else {
          showStatus("error", `Migration failed: ${response.error}`);
        }
      }
    );
  }

  // Set loading state
  function setLoading(isLoading) {
    migrateButton.disabled = isLoading;
    loadingIndicator.style.display = isLoading ? "block" : "none";
    if (isLoading) {
      statusMessage.style.display = "none";
    }
  }

  // Show status message
  function showStatus(type, message) {
    statusMessage.className = "status " + type;
    statusMessage.innerHTML = message;
    statusMessage.style.display = "block";
  }

  // Listen for click on migrate button
  migrateButton.addEventListener("click", function () {
    statusMessage.style.display = "none";
    getCurrentTabInfo();
  });

  // Listen for messages from background script during the migration process
  chrome.runtime.onMessage.addListener(function (message) {
    if (message.action === "migrationUpdate") {
      showStatus("info", message.status);
    }
  });
});
