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
    case 'searcheBay':
      handleEbaySearch(message.query)
        .then(response => sendResponse({ success: true, data: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'enhanceTitle':
      handleTitleEnhancement(message.title)
        .then(response => sendResponse({ success: true, data: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'analyzeImage':
      handleImageAnalysis(message.imageUrl)
        .then(response => sendResponse({ success: true, data: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'checkResellability':
      handleResellabilityCheck(message.title)
        .then(response => sendResponse({ success: true, data: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'getSettings':
      getExtensionSettings()
        .then(settings => sendResponse(settings));
      return true;
  }
});

async function handleResellabilityCheck(title) {
  try {
    const settings = await chrome.storage.sync.get(['openaiApiKey']);
    
    if (!settings.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Is this a PHYSICAL PRODUCT that could be resold on eBay? Respond with only YES or NO: "${title}"`
        }],
        max_tokens: 5,
        temperature: 0.1
      })
    });
    
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim().toLowerCase();
    
    return result === 'yes';
    
  } catch (error) {
    console.error('FlipFinder Pro: Resellability check failed:', error);
    return true; // Default to showing if AI fails
  }
}

async function handleEbaySearch(query) {
  try {
    const settings = await chrome.storage.sync.get(['ebayClientId']);
    
    if (!settings.ebayClientId) {
      throw new Error('eBay API credentials not configured');
    }
    
    const ebayUrl = `https://svcs.ebay.com/services/search/FindingService/v1?` +
      `OPERATION-NAME=findCompletedItems&` +
      `SERVICE-VERSION=1.0.0&` +
      `SECURITY-APPNAME=${settings.ebayClientId}&` +
      `RESPONSE-DATA-FORMAT=JSON&` +
      `keywords=${encodeURIComponent(query)}&` +
      `itemFilter(0).name=SoldItemsOnly&` +
      `itemFilter(0).value=true&` +
      `itemFilter(1).name=ListingType&` +
      `itemFilter(1).value=AuctionWithBIN&` +
      `itemFilter(1).value=FixedPrice&` +
      `sortOrder=EndTimeSoonest&` +
      `paginationInput.entriesPerPage=20`;
    
    const response = await fetch(ebayUrl);
    const data = await response.json();
    
    if (!data.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item) {
      return [];
    }
    
    const items = data.findCompletedItemsResponse[0].searchResult[0].item;
    
    const soldItems = items
      .filter(item => item.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')
      .slice(0, 3)
      .map(item => ({
        title: item.title?.[0] || '',
        price: parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0),
        endTime: item.listingInfo?.[0]?.endTime?.[0] || ''
      }))
      .filter(item => item.price > 0);
    
    await updateApiUsageCount();
    return soldItems;
    
  } catch (error) {
    console.error('FlipFinder Pro: eBay search failed:', error);
    throw error;
  }
}

async function handleTitleEnhancement(title) {
  try {
    const settings = await chrome.storage.sync.get(['openaiApiKey']);
    
    if (!settings.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `You are helping with product identification for reselling. Given this Facebook Marketplace title: "${title}"

If this title is specific enough to find exact product matches (like "iPhone 15 Pro Max 256GB"), respond with: SUFFICIENT

If this title is too vague but you can confidently guess the specific product (like "Yeti Mic" -> "Blue Yeti USB Microphone"), respond with the enhanced product name.

If this title is too vague and you cannot confidently determine the specific product, respond with: TOO_VAGUE

Title to analyze: "${title}"`
        }],
        max_tokens: 50,
        temperature: 0.1
      })
    });
    
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim();
    
    await updateApiUsageCount();
    
    if (result === 'SUFFICIENT' || result === 'TOO_VAGUE') {
      return null;
    }
    
    return result;
    
  } catch (error) {
    console.error('FlipFinder Pro: Title enhancement failed:', error);
    throw error;
  }
}

async function handleImageAnalysis(imageUrl) {
  try {
    const settings = await chrome.storage.sync.get(['openaiApiKey']);
    
    if (!settings.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this product image and provide a specific product name that would be suitable for searching sold listings on eBay. Include brand, model, and key specifications if visible. Be specific and concise.'
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl }
            }
          ]
        }],
        max_tokens: 100,
        temperature: 0.1
      })
    });
    
    const data = await response.json();
    await updateApiUsageCount();
    
    return data.choices?.[0]?.message?.content?.trim();
    
  } catch (error) {
    console.error('FlipFinder Pro: Image analysis failed:', error);
    throw error;
  }
}

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