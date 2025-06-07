// FlipFinder Pro - Popup Script
console.log('FlipFinder Pro: Popup loaded');

class PopupController {
  constructor() {
    this.elements = {};
    this.init();
  }

  init() {
    this.bindElements();
    this.attachEventListeners();
    this.loadSettings();
    this.loadStats();
  }

  bindElements() {
    // Get all UI elements
    this.elements = {
      enableToggle: document.getElementById('enable-toggle'),
      negativeToggle: document.getElementById('negative-toggle'),
      profitThreshold: document.getElementById('profit-threshold'),
      ebayClientId: document.getElementById('ebay-client-id'),
      openaiApiKey: document.getElementById('openai-api-key'),
      saveSettings: document.getElementById('save-settings'),
      testConnection: document.getElementById('test-connection'),
      clearCache: document.getElementById('clear-cache'),
      status: document.getElementById('status'),
      upgradeBanner: document.getElementById('upgrade-banner'),
      
      // Stats elements
      productsAnalyzed: document.getElementById('products-analyzed'),
      profitableDeals: document.getElementById('profitable-deals'),
      totalProfit: document.getElementById('total-profit'),
      apiUsage: document.getElementById('api-usage')
    };
  }

  attachEventListeners() {
    // Toggle switches
    this.elements.enableToggle.addEventListener('click', () => {
      this.toggleSwitch(this.elements.enableToggle);
    });

    this.elements.negativeToggle.addEventListener('click', () => {
      this.toggleSwitch(this.elements.negativeToggle);
    });

    // Buttons
    this.elements.saveSettings.addEventListener('click', () => {
      this.saveSettings();
    });

    this.elements.testConnection.addEventListener('click', () => {
      this.testApiConnection();
    });

    this.elements.clearCache.addEventListener('click', () => {
      this.clearCache();
    });

    // Auto-save on input changes
    this.elements.profitThreshold.addEventListener('input', () => {
      this.autoSave();
    });
  }

  toggleSwitch(toggle) {
    toggle.classList.toggle('active');
    this.autoSave();
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.sync.get([
        'enabled',
        'showNegativeProfits',
        'minProfitThreshold',
        'ebayClientId',
        'openaiApiKey'
      ]);

      // Update UI with saved settings
      if (settings.enabled !== false) {
        this.elements.enableToggle.classList.add('active');
      } else {
        this.elements.enableToggle.classList.remove('active');
      }

      if (settings.showNegativeProfits !== false) {
        this.elements.negativeToggle.classList.add('active');
      } else {
        this.elements.negativeToggle.classList.remove('active');
      }

      this.elements.profitThreshold.value = settings.minProfitThreshold || 10;
      this.elements.ebayClientId.value = settings.ebayClientId || '';
      this.elements.openaiApiKey.value = settings.openaiApiKey || '';

    } catch (error) {
      console.error('FlipFinder Pro: Error loading settings:', error);
      this.showStatus('Error loading settings', 'error');
    }
  }

  async loadStats() {
    try {
      const stats = await chrome.storage.sync.get([
        'productsAnalyzed',
        'profitableDeals',
        'totalPotentialProfit',
        'apiUsageCount'
      ]);

      // Update stats display
      this.elements.productsAnalyzed.textContent = stats.productsAnalyzed || 0;
      this.elements.profitableDeals.textContent = stats.profitableDeals || 0;
      this.elements.totalProfit.textContent = `$${stats.totalPotentialProfit || 0}`;
      this.elements.apiUsage.textContent = `${stats.apiUsageCount || 0}/1000`;

      // Show upgrade banner if approaching limit
      if ((stats.apiUsageCount || 0) > 800) {
        this.elements.upgradeBanner.classList.remove('hidden');
      }

    } catch (error) {
      console.error('FlipFinder Pro: Error loading stats:', error);
    }
  }

  async saveSettings() {
    try {
      const settings = {
        enabled: this.elements.enableToggle.classList.contains('active'),
        showNegativeProfits: this.elements.negativeToggle.classList.contains('active'),
        minProfitThreshold: parseInt(this.elements.profitThreshold.value) || 10,
        ebayClientId: this.elements.ebayClientId.value.trim(),
        openaiApiKey: this.elements.openaiApiKey.value.trim()
      };

      // Validate required fields
      if (!settings.ebayClientId) {
        this.showStatus('eBay Client ID is required', 'error');
        return;
      }

      if (!settings.openaiApiKey) {
        this.showStatus('OpenAI API key is required', 'error');
        return;
      }

      // Save to storage
      await chrome.storage.sync.set(settings);

      // Update content script with new settings
      chrome.tabs.query({ url: '*://www.facebook.com/marketplace/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'settingsUpdated',
            settings: settings
          }, () => {
            // Ignore errors if tab is not ready
            chrome.runtime.lastError;
          });
        });
      });

      this.showStatus('Settings saved successfully!', 'success');

    } catch (error) {
      console.error('FlipFinder Pro: Error saving settings:', error);
      this.showStatus('Error saving settings', 'error');
    }
  }

  async autoSave() {
    // Auto-save settings without showing status message
    try {
      const settings = {
        enabled: this.elements.enableToggle.classList.contains('active'),
        showNegativeProfits: this.elements.negativeToggle.classList.contains('active'),
        minProfitThreshold: parseInt(this.elements.profitThreshold.value) || 10
      };

      await chrome.storage.sync.set(settings);

    } catch (error) {
      console.error('FlipFinder Pro: Error auto-saving:', error);
    }
  }

  async testApiConnection() {
    this.showStatus('Testing API connections...', 'info');

    try {
      const settings = await chrome.storage.sync.get(['ebayClientId', 'openaiApiKey']);

      if (!settings.ebayClientId || !settings.openaiApiKey) {
        this.showStatus('Please enter both API credentials first', 'error');
        return;
      }

      // Test eBay API
      const ebayTest = await this.testEbayApi(settings.ebayClientId);
      if (!ebayTest.success) {
        this.showStatus(`eBay API Error: ${ebayTest.error}`, 'error');
        return;
      }

      // Test OpenAI API
      const openaiTest = await this.testOpenAiApi(settings.openaiApiKey);
      if (!openaiTest.success) {
        this.showStatus(`OpenAI API Error: ${openaiTest.error}`, 'error');
        return;
      }

      this.showStatus('✅ All API connections working!', 'success');

    } catch (error) {
      console.error('FlipFinder Pro: Error testing APIs:', error);
      this.showStatus('Error testing API connections', 'error');
    }
  }

  async testEbayApi(clientId) {
    try {
      // Make a simple test call to eBay Finding API
      const response = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?` +
        `OPERATION-NAME=findItemsByKeywords&` +
        `SERVICE-VERSION=1.0.0&` +
        `SECURITY-APPNAME=${clientId}&` +
        `RESPONSE-DATA-FORMAT=JSON&` +
        `keywords=test&` +
        `paginationInput.entriesPerPage=1`);

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      
      if (data.findItemsByKeywordsResponse?.[0]?.ack?.[0] === 'Success') {
        return { success: true };
      } else {
        return { success: false, error: 'Invalid response from eBay' };
      }

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async testOpenAiApi(apiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Test' }],
          max_tokens: 5
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: errorData.error?.message || `HTTP ${response.status}` };
      }

      return { success: true };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async clearCache() {
    try {
      // Clear extension cache
      await chrome.storage.local.clear();

      // Reset stats
      await chrome.storage.sync.set({
        productsAnalyzed: 0,
        profitableDeals: 0,
        totalPotentialProfit: 0
      });

      // Reload stats display
      this.loadStats();

      // Clear cache in content scripts
      chrome.tabs.query({ url: '*://www.facebook.com/marketplace/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'clearCache' }, () => {
            chrome.runtime.lastError; // Ignore errors
          });
        });
      });

      this.showStatus('Cache cleared successfully!', 'success');

    } catch (error) {
      console.error('FlipFinder Pro: Error clearing cache:', error);
      this.showStatus('Error clearing cache', 'error');
    }
  }

  showStatus(message, type = 'info') {
    this.elements.status.textContent = message;
    this.elements.status.className = `status ${type}`;
    this.elements.status.classList.remove('hidden');

    // Auto-hide status after 3 seconds
    setTimeout(() => {
      this.elements.status.classList.add('hidden');
    }, 3000);
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});