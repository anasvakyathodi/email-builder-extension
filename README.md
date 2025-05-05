# Email Builder Template Migrator Chrome Extension

A Chrome extension to easily migrate email templates and campaigns from production to staging for the GoHighLevel platform.

## Features

- Automatically extracts campaign/template ID and location ID from the current tab URL
- Creates a new template in staging environment (regardless of whether source is a campaign or template)
- Copies all data from production to the new staging template
- Simple and intuitive user interface
- Provides real-time feedback on the migration process
- Supports both automatic and manual ID entry

## Installation

### Local Development Installation

1. Download or clone this repository

   ```bash
   git clone https://github.com/anasvakyathodi/email-builder-extension.git
   cd email-builder-extension
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" by toggling the switch in the top-right corner

4. Click "Load unpacked" and select the extension directory

5. The extension should now be installed and visible in your extensions list

### Project Structure

```
email-builder-extension/
├── manifest.json         # Chrome extension configuration
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality
├── background.js         # Background service worker for API calls
├── content.js            # Content script for page interaction
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # Documentation
```

### Key Configuration (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "Email Builder Template Migrator",
  "description": "Migrate email templates and campaigns from production to staging",
  "version": "1.0",
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": [
        "https://app.gohighlevel.com/*",
        "https://email-builder-prod.web.app/*"
      ],
      "js": ["content.js"]
    }
  ],
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [
    "https://app.gohighlevel.com/*",
    "https://email-builder-prod.web.app/*",
    "https://services.leadconnectorhq.com/*",
    "https://backend.leadconnectorhq.com/*",
    "http://staging.services.leadconnectorhq.internal/*"
  ]
}
```

## Usage

1. Navigate to a GoHighLevel email template or campaign page in production:

   - Template URL: `https://app.gohighlevel.com/location/{locationId}/emails/create/{templateId}/builder`
   - Campaign URL: `https://app.gohighlevel.com/location/{locationId}/emails/campaigns/create/{campaignId}`
   - Or email-builder-prod.web.app URLs

2. Click on the extension icon in your Chrome toolbar to open the popup

3. Enter your staging location ID in the provided field

4. Enter your authentication token (required for API calls)

5. Click "Migrate from Production" to start the migration process, or enable "Enter production IDs manually" if automatic detection doesn't work

6. The extension will:
   - Fetch the template/campaign data from production
   - Create a new template in staging
   - Update the staging template with the production data
   - Display the new template ID upon successful completion

## Technical Details

- **Content Script**: Extracts URL information from the current tab
- **Popup**: User interface for entering staging location ID, auth token, and initiating migration
- **Background Script**: Handles all API calls to avoid CORS issues
- **API Endpoints**:
  - Production data fetching (supports multiple endpoint formats)
  - Staging template creation
  - Staging template data updating

## Manual Entry Mode

If automatic detection fails, you can:

1. Check the "Enter production IDs manually" box
2. Enter the production location ID and entity ID manually
3. The extension will try to prefill these fields from the URL when possible

## Authentication

The extension requires a valid authentication token to make API calls. This token is used to authenticate with the production API to fetch template/campaign data.

## Security

This extension requires access to specific GoHighLevel domains to function properly:

- `https://app.gohighlevel.com/*`
- `https://email-builder-prod.web.app/*`
- `https://services.leadconnectorhq.com/*`
- `https://backend.leadconnectorhq.com/*`
- `http://staging.services.leadconnectorhq.internal/*`

## Troubleshooting

- **"Unable to extract information from the current URL"**: The extension will automatically enable manual entry mode with data prefilled from the URL
- **Authentication Errors**: Ensure you've entered a valid authentication token
- **API Errors**: Check that the staging location ID is correct and that you have the necessary permissions
- **Network Issues**: Ensure you can access both production and staging environments

## License

This project is licensed under the MIT License.
