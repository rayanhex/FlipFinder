// FlipFinder Pro - Content Script for Facebook Marketplace
console.log('FlipFinder Pro: Extension loaded');

// Configuration
const CONFIG = {
  MIN_CONFIDENCE_THRESHOLD: 0.7
};

// Main class to handle Facebook Marketplace integration
class FlipFinderExtension {
  constructor() {
    this.processedListings = new Set();
    this.settings = {};
    console.log('FlipFinder Pro: Constructor called');
    this.init();
  }

  async init() {
    console.log('FlipFinder Pro: Init starting');
    try {
      // Load settings from storage
      await this.loadSettings();
      console.log('FlipFinder Pro: Settings loaded', this.settings);
      
      this.addCustomStyles();
      console.log('FlipFinder Pro: Styles added');
      
      this.startObserving();
      console.log('FlipFinder Pro: Observer started');
      
      this.processExistingListings();
      console.log('FlipFinder Pro: Processing existing listings');
      
    } catch (error) {
      console.error('FlipFinder Pro: Init error:', error);
    }
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
    console.log('FlipFinder Pro: Looking for existing listings');
    const listings = this.findMarketplaceListings();
    console.log(`FlipFinder Pro: Found ${listings.length} existing listings`);
    
    // Test with just the first listing
    if (listings.length > 0) {
      console.log('FlipFinder Pro: Testing with first listing only');
      const firstListing = listings[0];
      console.log('FlipFinder Pro: First listing element:', firstListing);
      
      // Call function directly without async
      this.testProcessListing(firstListing);
    }
  }

  testProcessListing(element) {
    console.log('FlipFinder Pro: *** ENTERING testProcessListing ***');
    
    try {
      // Just add a badge directly
      const badge = document.createElement('div');
      badge.textContent = 'TEST BADGE';
      badge.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: red;
        color: white;
        padding: 5px;
        border-radius: 5px;
        z-index: 9999;
        font-size: 12px;
      `;
      
      element.style.position = 'relative';
      element.appendChild(badge);
      
      console.log('FlipFinder Pro: Test badge added successfully');
      
    } catch (error) {
      console.error('FlipFinder Pro: Error in testProcessListing:', error);
    }
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
    console.log('FlipFinder Pro: Searching for marketplace listings');
    
    const selectors = [
      'div[role="article"]', // Main listing containers
      'a[role="link"]', // Linked listings
    ];
    
    const allElements = [];
    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      console.log(`FlipFinder Pro: Found ${elements.length} elements with selector: ${selector}`);
      allElements.push(...elements);
    });
    
    const marketplaceListings = allElements.filter(el => this.isMarketplaceListing(el));
    console.log(`FlipFinder Pro: Filtered to ${marketplaceListings.length} marketplace listings`);
    
    return marketplaceListings;
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
      
      console.log(`FlipFinder Pro: Processing resellable item: ${listingData.title} - ${listingData.price}`);
      
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

  async searcheBaySoldListings(query) {
    // Use Chrome extension messaging to call eBay API from background script
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'searcheBay',
        query: query
      });
      
      if (response.success) {
        return response.data;
      } else {
        console.error('FlipFinder Pro: eBay search failed:', response.error);
        return [];
      }
      
    } catch (error) {
      console.error('FlipFinder Pro: eBay search error:', error);
      return [];
    }
  }

  async enhanceTitleWithAI(title) {
    // Use Chrome extension messaging for OpenAI API calls
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'enhanceTitle',
        title: title
      });
      
      if (response.success) {
        return response.data;
      } else {
        console.error('FlipFinder Pro: Title enhancement failed:', response.error);
        return null;
      }
      
    } catch (error) {
      console.error('FlipFinder Pro: Title enhancement error:', error);
      return null;
    }
  }

  async analyzeImageWithAI(imageUrl) {
    // Use Chrome extension messaging for image analysis
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'analyzeImage',
        imageUrl: imageUrl
      });
      
      if (response.success) {
        return response.data;
      } else {
        console.error('FlipFinder Pro: Image analysis failed:', response.error);
        return null;
      }
      
    } catch (error) {
      console.error('FlipFinder Pro: Image analysis error:', error);
      return null;
    }
  }

  async getUserToken() {
    // Get user's subscription token (stored securely)
    const result = await chrome.storage.sync.get(['userToken']);
    return result.userToken || '';
  }

  // Check if product is resellable on eBay using AI
  async isResellableProduct(listingData) {
    try {
      if (!this.settings.openaiApiKey) {
        // If no API key, use basic keyword filtering
        return this.isResellableProductBasic(listingData.title);
      }
      
      const response = await chrome.runtime.sendMessage({
        action: 'checkResellability',
        title: listingData.title
      });
      
      if (response.success) {
        return response.data;
      } else {
        console.warn('FlipFinder Pro: AI filtering failed, using basic filter');
        return this.isResellableProductBasic(listingData.title);
      }
      
    } catch (error) {
      console.error('FlipFinder Pro: AI filtering error:', error);
      return this.isResellableProductBasic(listingData.title);
    }
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
    
    const { profit, profitMargin, sampleSize, isDemo } = profitData;
    
    // Determine badge style based on profit
    let badgeClass = 'flipfinder-profit-badge';
    let emoji = '💰';
    
    if (profit < 0) {
      badgeClass += ' negative';
      emoji = '❌';
    } else if (profit < 20) {
      badgeClass += ' low-profit';
      emoji = '💵';
    } else if (profit >= 100) {
      badgeClass += ' insane-profit';
      emoji = '🚀';
    } else if (profit >= 50) {
      badgeClass += ' high-profit';
      emoji = '💎';
    }
    
    badge.className = badgeClass;
    
    // 🎯 DEMO MODE INDICATOR - Remove "DEMO" text when eBay API is ready
    const demoText = isDemo ? ' (DEMO)' : '';
    
    badge.innerHTML = `
      ${emoji} ${profit}
      <div class="flipfinder-details">${profitMargin}% margin (${sampleSize} sold)${demoText}</div>
    `;
  }

  removeBadge(element) {
    const badge = element.querySelector('[data-flipfinder="true"]');
    if (badge) badge.remove();
  }
}

// Initialize extension when page loads
console.log('FlipFinder Pro: Script executing, document state:', document.readyState);

function initializeExtension() {
  console.log('FlipFinder Pro: Initializing extension');
  console.log('FlipFinder Pro: Current URL:', window.location.href);
  
  // Check if we're on Facebook Marketplace
  if (!window.location.href.includes('facebook.com/marketplace')) {
    console.log('FlipFinder Pro: Not on Facebook Marketplace, skipping initialization');
    return;
  }
  
  try {
    new FlipFinderExtension();
  } catch (error) {
    console.error('FlipFinder Pro: Failed to initialize:', error);
  }
}

if (document.readyState === 'loading') {
  console.log('FlipFinder Pro: Document still loading, waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
  console.log('FlipFinder Pro: Document ready, initializing immediately');
  initializeExtension();
}