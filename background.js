// FlipFinder Pro - Background Service Worker
console.log('FlipFinder Pro: Background service worker loaded');

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('FlipFinder Pro: Extension installed');
    
    // Set default settings
    chrome.storage.sync.set({
      enabled: true,
      minProfitThreshold: 10,
      showNegativeProfits: true,
      apiUsageCount: 0
    });
    
    // Open welcome page
    chrome.tabs.create({
      url: 'https://flipfinder.pro/welcome' // You'll create this later
    });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'makeEbayApiCall':
      handleEbayApiCall(message.data)
        .then(response => sendResponse({ success: true, data: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep message channel open for async response
      
    case 'makeOpenAiApiCall':
      handleOpenAiApiCall(message.data)
        .then(response => sendResponse({ success: true, data: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'updateApiUsage':
      updateApiUsageCount();
      break;
      
    case 'getSettings':
      getExtensionSettings()
        .then(settings => sendResponse(settings));
      return true;
  }
});

async function handleEbayApiCall(requestData) {
  try {
    // Get stored API credentials
    const settings = await chrome.storage.sync.get(['ebayClientId']);
    
    if (!settings.ebayClientId) {
      throw new Error('eBay API credentials not configured');
    }
    
    // Make eBay API call with CORS headers
    const response = await fetch(requestData.url, {
      method: requestData.method || 'GET',
      headers: {
        'X-EBAY-API-APP-ID': settings.ebayClientId,
        'X-EBAY-API-SITE-ID': '0', // US site
        'Content-Type': 'application/json',
        ...requestData.headers
      },
      body: requestData.body ? JSON.stringify(requestData.body) : undefined
    });
    
    if (!response.ok) {
      throw new Error(`eBay API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Update API usage counter
    await updateApiUsageCount();
    
    return data;
    
  } catch (error) {
    console.error('FlipFinder Pro: eBay API call failed:', error);
    throw error;
  }
}

async function handleOpenAiApiCall(requestData) {
  try {
    // Get stored API credentials
    const settings = await chrome.storage.sync.get(['openaiApiKey']);
    
    if (!settings.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    // Make OpenAI API call
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    // Update API usage counter
    await updateApiUsageCount();
    
    return data;
    
  } catch (error) {
    console.error('FlipFinder Pro: OpenAI API call failed:', error);
    throw error;
  }
}

async function updateApiUsageCount() {
  try {
    const result = await chrome.storage.sync.get(['apiUsageCount']);
    const currentCount = result.apiUsageCount || 0;
    
    await chrome.storage.sync.set({
      apiUsageCount: currentCount + 1,
      lastApiCall: Date.now()
    });
    
    // Check if user is approaching limits (for future subscription logic)
    if (currentCount > 900) { // Warn at 90% of 1000 monthly limit
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6B00' });
    }
    
  } catch (error) {
    console.error('FlipFinder Pro: Error updating API usage:', error);
  }
}

async function getExtensionSettings() {
  try {
    const settings = await chrome.storage.sync.get([
      'enabled',
      'minProfitThreshold',
      'showNegativeProfits',
      'apiUsageCount',
      'ebayClientId',
      'openaiApiKey'
    ]);
    
    return settings;
    
  } catch (error) {
    console.error('FlipFinder Pro: Error getting settings:', error);
    return {};
  }
}

// Handle context menu (right-click) actions
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'analyzeProduct',
    title: 'Analyze with FlipFinder Pro',
    contexts: ['image', 'link'],
    documentUrlPatterns: ['*://www.facebook.com/marketplace/*']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'analyzeProduct') {
    // Send message to content script to analyze specific product
    chrome.tabs.sendMessage(tab.id, {
      action: 'analyzeSpecificProduct',
      data: {
        imageUrl: info.srcUrl,
        linkUrl: info.linkUrl
      }
    });
  }
});

// Periodic cleanup of processed listings cache
setInterval(() => {
  chrome.tabs.query({ url: '*://www.facebook.com/marketplace/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'clearCache' }, () => {
        // Ignore errors if tab is not ready
        chrome.runtime.lastError;
      });
    });
  });
}, 300000); // Clean cache every 5 minutes