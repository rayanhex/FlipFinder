// FlipFinder Pro - Content Script for Facebook Marketplace
console.log('FlipFinder Pro: Extension loaded');

// Configuration
const CONFIG = {
  API_BASE_URL: 'http://localhost:3000', // Your backend API
  MIN_CONFIDENCE_THRESHOLD: 0.7,
  DEMO_MODE: false // 🎯 TOGGLE THIS TO FALSE WHEN BACKEND IS READY
};

// Main class to handle Facebook Marketplace integration
class FlipFinderExtension {
  constructor() {
    this.processedListings = new Set();
    this.settings = {};
    this.init();
  }

  async init() {
    // Load settings from storage
    await this.loadSettings();
    this.addCustomStyles();
    this.startObserving();
    this.processExistingListings();
  }

  async loadSettings() {
    try {
      this.settings = await chrome.storage.sync.get([
        'enabled',
        'minProfitThreshold',
        'showNegativeProfits',
        'ebayClientId',
        'openaiApiKey'
      ]);
      
      // Set defaults if not found
      this.settings.enabled = this.settings.enabled !== false;
      this.settings.minProfitThreshold = this.settings.minProfitThreshold || 10;
      this.settings.showNegativeProfits = this.settings.showNegativeProfits !== false;
      
    } catch (error) {
      console.error('FlipFinder Pro: Error loading settings:', error);
      this.settings = { enabled: true, minProfitThreshold: 10, showNegativeProfits: true };
    }
  }

  addCustomStyles() {
    if (document.getElementById('flipfinder-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'flipfinder-styles';
    style.textContent = `
      .flipfinder-profit-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: linear-gradient(135deg, #00C851, #007E33);
        color: white;
        padding: 6px 10px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: flipfinder-pulse 2s infinite;
      }
      
      .flipfinder-profit-badge.analyzing {
        background: linear-gradient(135deg, #FF6B00, #FF8F00);
        animation: flipfinder-spin 1s linear infinite;
      }
      
      .flipfinder-profit-badge.low-profit {
        background: linear-gradient(135deg, #FFB74D, #FF9800);
      }
      
      .flipfinder-profit-badge.negative {
        background: linear-gradient(135deg, #F44336, #D32F2F);
      }
      
      @keyframes flipfinder-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }
      
      @keyframes flipfinder-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      .flipfinder-details {
        font-size: 10px;
        margin-top: 2px;
        opacity: 0.9;
      }
    `;
    document.head.appendChild(style);
  }

  startObserving() {
    // Watch for new listings being loaded (Facebook's infinite scroll)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) { // Element node
            this.processNewListings(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  processExistingListings() {
    // Process listings that are already on the page
    const listings = this.findMarketplaceListings();
    listings.forEach(listing => this.processListing(listing));
  }

  processNewListings(container) {
    // Process new listings that were dynamically added
    const listings = container.querySelectorAll ? 
      Array.from(container.querySelectorAll('div[role="article"], a[role="link"]')).filter(el => 
        this.isMarketplaceListing(el)
      ) : [];
    
    if (this.isMarketplaceListing(container)) {
      listings.push(container);
    }
    
    listings.forEach(listing => this.processListing(listing));
  }

  findMarketplaceListings() {
    // Find all marketplace listings on current page
    const selectors = [
      'div[role="article"]', // Main listing containers
      'a[role="link"]', // Linked listings
    ];
    
    const allElements = [];
    selectors.forEach(selector => {
      allElements.push(...document.querySelectorAll(selector));
    });
    
    return allElements.filter(el => this.isMarketplaceListing(el));
  }

  isMarketplaceListing(element) {
    // Check if element is actually a marketplace listing
    if (!element) return false;
    
    // Look for price indicators and marketplace-specific patterns
    const priceElement = element.querySelector('[data-testid*="price"]');
    const hasPrice = priceElement || /\$[\d,]+/.test(element.textContent);
    
    const hasImage = element.querySelector('img');
    const isInMarketplace = window.location.href.includes('/marketplace');
    
    return hasPrice && hasImage && isInMarketplace;
  }

  async processListing(listingElement) {
    const listingId = this.getListingId(listingElement);
    if (this.processedListings.has(listingId)) return;
    
    this.processedListings.add(listingId);
    
    try {
      // Extract listing data
      const listingData = this.extractListingData(listingElement);
      if (!listingData.title || !listingData.price) return;
      
      // 🎯 NEW: Check if this is a resellable physical product
      const isResellable = await this.isResellableProduct(listingData);
      if (!isResellable) {
        console.log(`FlipFinder Pro: Skipping non-resellable item: ${listingData.title}`);
        return;
      }
      
      // Add analyzing badge
      this.addAnalyzingBadge(listingElement);
      
      // Process profit calculation
      const profitData = await this.calculateProfit(listingData);
      
      // Update badge with results
      this.updateProfitBadge(listingElement, profitData);
      
    } catch (error) {
      console.error('FlipFinder Pro: Error processing listing:', error);
      this.removeBadge(listingElement);
    }
  }

  getListingId(element) {
    // Create unique ID for listing to avoid reprocessing
    const href = element.querySelector('a')?.href || '';
    const text = element.textContent.slice(0, 50);
    
    // Clean the string to only include safe characters for btoa
    const cleanString = (href + text)
      .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII characters
      .slice(0, 100); // Limit length
    
    try {
      return btoa(cleanString).slice(0, 20);
    } catch (error) {
      // Fallback if btoa still fails
      return Math.random().toString(36).substring(2, 15);
    }
  }

  extractListingData(element) {
    // Extract title, price, and image from Facebook listing
    let title = '';
    let price = 0;
    let imageUrl = '';
    
    // Extract title (try multiple selectors)
    const titleSelectors = [
      'span[dir="auto"]',
      'div[dir="auto"]',
      'h3',
      '.x1i10hfl'
    ];
    
    for (const selector of titleSelectors) {
      const titleElement = element.querySelector(selector);
      if (titleElement && titleElement.textContent.length > 5) {
        title = titleElement.textContent.trim();
        break;
      }
    }
    
    // Extract price
    const priceText = element.textContent.match(/\$[\d,]+/);
    if (priceText) {
      price = parseInt(priceText[0].replace(/\$|,/g, ''));
    }
    
    // Extract image URL
    const img = element.querySelector('img');
    if (img) {
      imageUrl = img.src || img.dataset.src || '';
    }
    
    return { title, price, imageUrl };
  }

  addAnalyzingBadge(element) {
    // Add "Analyzing..." badge while processing
    const badge = document.createElement('div');
    badge.className = 'flipfinder-profit-badge analyzing';
    badge.innerHTML = '🔍 Analyzing...';
    badge.setAttribute('data-flipfinder', 'true');
    
    // Position relative to listing
    const container = element.querySelector('img')?.parentElement || element;
    if (container) {
      container.style.position = 'relative';
      container.appendChild(badge);
    }
  }

  async calculateProfit(listingData) {
    // 🎯 DEMO MODE - Remove this entire block when eBay API is ready
    if (CONFIG.DEMO_MODE) {
      return this.generateDemoProfit(listingData);
    }
    
    try {
      // Step 1: Try exact title match on eBay
      let eBaySearchQuery = listingData.title;
      let eBayResults = await this.searcheBaySoldListings(eBaySearchQuery);
      
      // Step 2: If no good matches, use AI to enhance title
      if (eBayResults.length < 3) {
        const enhancedTitle = await this.enhanceTitleWithAI(listingData.title);
        if (enhancedTitle && enhancedTitle !== listingData.title) {
          eBaySearchQuery = enhancedTitle;
          eBayResults = await this.searcheBaySoldListings(eBaySearchQuery);
        }
      }
      
      // Step 3: If still no good matches, analyze image
      if (eBayResults.length < 3 && listingData.imageUrl) {
        const imageAnalysis = await this.analyzeImageWithAI(listingData.imageUrl);
        if (imageAnalysis) {
          eBaySearchQuery = imageAnalysis;
          eBayResults = await this.searcheBaySoldListings(eBaySearchQuery);
        }
      }
      
      if (eBayResults.length === 0) {
        return { error: 'No matches found' };
      }
      
      // Calculate average sold price
      const avgSoldPrice = eBayResults.reduce((sum, item) => sum + item.price, 0) / eBayResults.length;
      const profit = avgSoldPrice - listingData.price;
      const profitMargin = ((profit / listingData.price) * 100).toFixed(1);
      
      return {
        profit: Math.round(profit),
        profitMargin: profitMargin,
        avgSoldPrice: Math.round(avgSoldPrice),
        fbPrice: listingData.price,
        sampleSize: eBayResults.length,
        searchQuery: eBaySearchQuery
      };
      
    } catch (error) {
      console.error('FlipFinder Pro: Error calculating profit:', error);
      return { error: 'Calculation failed' };
    }
  }

  // 🎯 DEMO MODE FUNCTION - DELETE THIS ENTIRE FUNCTION WHEN EBAY API IS READY
  generateDemoProfit(listingData) {
    // Simulate realistic profit scenarios based on price ranges
    const { price } = listingData;
    
    // Different profit scenarios based on item price
    const scenarios = [
      { profit: Math.round(price * 0.3), margin: 30, samples: 3 }, // 30% profit
      { profit: Math.round(price * 0.5), margin: 50, samples: 3 }, // 50% profit  
      { profit: Math.round(price * 0.8), margin: 80, samples: 3 }, // 80% profit
      { profit: Math.round(price * 1.2), margin: 120, samples: 3 }, // 120% profit
      { profit: -Math.round(price * 0.1), margin: -10, samples: 3 }, // Loss
      { profit: Math.round(price * 0.1), margin: 10, samples: 3 }, // Small profit
    ];
    
    // Weighted selection (favor profitable scenarios for demo)
    const weights = [20, 25, 20, 15, 5, 15]; // Higher chance of good profits
    const randomIndex = this.weightedRandom(weights);
    const scenario = scenarios[randomIndex];
    
    return {
      profit: scenario.profit,
      profitMargin: scenario.margin.toFixed(1),
      avgSoldPrice: price + scenario.profit,
      fbPrice: price,
      sampleSize: scenario.samples,
      searchQuery: `${listingData.title} (Demo)`,
      isDemo: true // Flag to identify demo data
    };
  }

  // 🎯 DEMO MODE HELPER - DELETE THIS FUNCTION WHEN EBAY API IS READY
  weightedRandom(weights) {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < weights.length; i++) {
      random -= weights[i];
      if (random <= 0) return i;
    }
    return 0;
  }

  async searcheBaySoldListings(query) {
    // Call your backend API instead of eBay directly
    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}/api/ebay/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await this.getUserToken()}` // User's subscription token
        },
        body: JSON.stringify({
          query: query,
          itemFilter: 'SoldItemsOnly',
          limit: 3
        })
      });
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.soldItems || [];
      
    } catch (error) {
      console.error('FlipFinder Pro: Backend API error:', error);
      return [];
    }
  }

  async enhanceTitleWithAI(title) {
    // Call your backend API for OpenAI requests
    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}/api/ai/enhance-title`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await this.getUserToken()}`
        },
        body: JSON.stringify({
          title: title
        })
      });
      
      if (!response.ok) {
        throw new Error(`AI API Error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.enhancedTitle;
      
    } catch (error) {
      console.error('FlipFinder Pro: AI API error:', error);
      return null;
    }
  }

  async analyzeImageWithAI(imageUrl) {
    // Call your backend API for image analysis
    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}/api/ai/analyze-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await this.getUserToken()}`
        },
        body: JSON.stringify({
          imageUrl: imageUrl
        })
      });
      
      if (!response.ok) {
        throw new Error(`Image AI Error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.productName;
      
    } catch (error) {
      console.error('FlipFinder Pro: Image analysis error:', error);
      return null;
    }
  }

  // 🎯 NEW: Check if product is resellable on eBay
  async isResellableProduct(listingData) {
    // 🎯 DEMO MODE - Skip AI filtering for demo
    if (CONFIG.DEMO_MODE) {
      return this.isResellableProductDemo(listingData.title);
    }
    
    try {
      if (!this.settings.openaiApiKey) {
        // If no API key, use basic keyword filtering
        return this.isResellableProductBasic(listingData.title);
      }
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.settings.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `Analyze this Facebook Marketplace listing title: "${listingData.title}"

Is this a PHYSICAL PRODUCT that could be resold on eBay? 

RESPOND WITH ONLY: YES or NO

Examples:
- "iPhone 15 Pro Max" → YES (physical electronics)
- "Canon camera" → YES (physical item)
- "I need employees" → NO (hiring/services)
- "Hair removal service" → NO (service)
- "Missing dog" → NO (not for sale)
- "Room for rent" → NO (real estate/rental)
- "Car repair" → NO (service)
- "Tutoring available" → NO (service)
- "Nike shoes" → YES (physical item)

Title: "${listingData.title}"`
          }],
          max_tokens: 10,
          temperature: 0.1
        })
      });
      
      if (!response.ok) {
        console.warn('FlipFinder Pro: AI filtering failed, using basic filter');
        return this.isResellableProductBasic(listingData.title);
      }
      
      const data = await response.json();
      const result = data.choices?.[0]?.message?.content?.trim().toLowerCase();
      
      return result === 'yes';
      
    } catch (error) {
      console.error('FlipFinder Pro: AI filtering error:', error);
      // Fallback to basic filtering
      return this.isResellableProductBasic(listingData.title);
    }
  }

  // 🎯 DEMO MODE FILTER - DELETE WHEN GOING LIVE
  isResellableProductDemo(title) {
    // Simple keyword filtering for demo mode
    const nonResellableKeywords = [
      'hiring', 'employees', 'job', 'work', 'employment',
      'hair removal', 'massage', 'service', 'repair',
      'missing', 'lost', 'found', 'reward',
      'rent', 'rental', 'lease', 'roommate', 'room for',
      'tutoring', 'lessons', 'teaching', 'coaching',
      'cleaning', 'handyman', 'contractor'
    ];
    
    const titleLower = title.toLowerCase();
    return !nonResellableKeywords.some(keyword => titleLower.includes(keyword));
  }

  // Basic keyword filtering (fallback when AI fails)
  isResellableProductBasic(title) {
    const nonResellableKeywords = [
      'hiring', 'employees', 'job', 'work', 'employment',
      'hair removal', 'massage', 'service', 'repair',
      'missing', 'lost', 'found', 'reward',
      'rent', 'rental', 'lease', 'roommate', 'room for',
      'tutoring', 'lessons', 'teaching', 'coaching',
      'cleaning', 'handyman', 'contractor', 'babysitting',
      'dog walking', 'pet sitting', 'lawn care', 'snow removal'
    ];
    
    const resellableKeywords = [
      'iphone', 'samsung', 'apple', 'laptop', 'computer',
      'camera', 'canon', 'nikon', 'sony', 'xbox', 'playstation',
      'nintendo', 'shoes', 'nike', 'adidas', 'jordan',
      'watch', 'rolex', 'jewelry', 'ring', 'necklace',
      'furniture', 'chair', 'table', 'couch', 'tv',
      'tablet', 'ipad', 'headphones', 'speakers'
    ];
    
    const titleLower = title.toLowerCase();
    
    // If contains non-resellable keywords, reject
    if (nonResellableKeywords.some(keyword => titleLower.includes(keyword))) {
      return false;
    }
    
    // If contains resellable keywords, accept
    if (resellableKeywords.some(keyword => titleLower.includes(keyword))) {
      return true;
    }
    
    // If unclear and has a reasonable price, probably resellable
    return true; // Default to showing badge if unsure
  }
  updateProfitBadge(element, profitData) {
    const badge = element.querySelector('[data-flipfinder="true"]');
    if (!badge) return;
    
    if (profitData.error) {
      badge.innerHTML = '❌ No data';
      badge.className = 'flipfinder-profit-badge negative';
      return;
    }
    
    const { profit, profitMargin, avgSoldPrice, isDemo } = profitData;
    
    // Determine badge style based on profit
    let badgeClass = 'flipfinder-profit-badge';
    let profitText = `Profit: $${profit}`;
    
    if (profit < 0) {
      badgeClass += ' negative';
      profitText = `Loss: $${Math.abs(profit)}`;
    } else if (profit < 20) {
      badgeClass += ' low-profit';
    } else if (profit < 50) {
      badgeClass += ' good-profit';
    } else {
      badgeClass += ' best-profit';
    }
    
    badge.className = badgeClass;
    
    const demoText = isDemo ? ' (DEMO)' : '';
    
    badge.innerHTML = `
      eBay Price: $${avgSoldPrice}
      <div class="flipfinder-details">${profitText} (${profitMargin}%)${demoText}</div>
    `;
  }
  removeBadge(element) {
    const badge = element.querySelector('[data-flipfinder="true"]');
    if (badge) badge.remove();
  }
}

// Initialize extension when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new FlipFinderExtension();
  });
} else {
  new FlipFinderExtension();
}