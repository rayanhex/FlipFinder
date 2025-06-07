// FlipFinder Pro - Secure Backend API Server
// This hides your API keys from users and handles subscription validation

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['chrome-extension://*', 'https://flipfinder.pro'] // Allow your extension and website
}));
app.use(express.json());

// Your secret API keys (stored in environment variables)
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to verify user subscription
const verifySubscription = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }
    
    // Verify JWT token (contains user subscription info)
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if subscription is active (you'll implement this with your payment system)
    const isSubscriptionActive = await checkSubscriptionStatus(decoded.userId);
    
    if (!isSubscriptionActive) {
      return res.status(403).json({ error: 'Subscription expired or inactive' });
    }
    
    // Check API usage limits
    const apiUsage = await checkApiUsage(decoded.userId);
    if (apiUsage.exceeded) {
      return res.status(429).json({ error: 'API usage limit exceeded' });
    }
    
    req.user = decoded;
    next();
    
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Invalid authorization token' });
  }
};

// eBay API Proxy Endpoint
app.post('/api/ebay/search', verifySubscription, async (req, res) => {
  try {
    const { query, itemFilter, limit } = req.body;
    
    // Make request to eBay API with YOUR credentials
    const ebayUrl = `https://svcs.ebay.com/services/search/FindingService/v1?` +
      `OPERATION-NAME=findCompletedItems&` +
      `SERVICE-VERSION=1.0.0&` +
      `SECURITY-APPNAME=${EBAY_CLIENT_ID}&` +
      `RESPONSE-DATA-FORMAT=JSON&` +
      `keywords=${encodeURIComponent(query)}&` +
      `itemFilter(0).name=SoldItemsOnly&` +
      `itemFilter(0).value=true&` +
      `itemFilter(1).name=ListingType&` +
      `itemFilter(1).value=AuctionWithBIN&` +
      `itemFilter(1).value=FixedPrice&` +
      `sortOrder=EndTimeSoonest&` +
      `paginationInput.entriesPerPage=${limit || 20}`;
    
    const response = await fetch(ebayUrl);
    const data = await response.json();
    
    if (!data.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item) {
      return res.json({ soldItems: [] });
    }
    
    const items = data.findCompletedItemsResponse[0].searchResult[0].item;
    
    // Process and filter results
    const soldItems = items
      .filter(item => item.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')
      .slice(0, limit || 3)
      .map(item => ({
        title: item.title?.[0] || '',
        price: parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0),
        endTime: item.listingInfo?.[0]?.endTime?.[0] || ''
      }))
      .filter(item => item.price > 0);
    
    // Track API usage
    await incrementApiUsage(req.user.userId, 'ebay_search');
    
    res.json({ soldItems });
    
  } catch (error) {
    console.error('eBay API error:', error);
    res.status(500).json({ error: 'eBay API request failed' });
  }
});

// OpenAI Title Enhancement Endpoint
app.post('/api/ai/enhance-title', verifySubscription, async (req, res) => {
  try {
    const { title } = req.body;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
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
    
    let enhancedTitle = null;
    if (result !== 'SUFFICIENT' && result !== 'TOO_VAGUE') {
      enhancedTitle = result;
    }
    
    // Track API usage
    await incrementApiUsage(req.user.userId, 'ai_enhance_title');
    
    res.json({ enhancedTitle });
    
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'AI enhancement failed' });
  }
});

// OpenAI Image Analysis Endpoint
app.post('/api/ai/analyze-image', verifySubscription, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
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
    const productName = data.choices?.[0]?.message?.content?.trim();
    
    // Track API usage
    await incrementApiUsage(req.user.userId, 'ai_analyze_image');
    
    res.json({ productName });
    
  } catch (error) {
    console.error('Image analysis error:', error);
    res.status(500).json({ error: 'Image analysis failed' });
  }
});

// User Authentication Endpoint (for generating JWT tokens)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, subscriptionKey } = req.body;
    
    // Verify subscription with your payment provider (Stripe, Paddle, etc.)
    const subscription = await verifySubscriptionKey(email, subscriptionKey);
    
    if (!subscription.valid) {
      return res.status(401).json({ error: 'Invalid subscription' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: subscription.userId,
        email: email,
        plan: subscription.plan
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({ 
      token,
      user: {
        email,
        plan: subscription.plan,
        expiresAt: subscription.expiresAt
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Helper functions (you'll implement these)
async function checkSubscriptionStatus(userId) {
  // Check with your payment provider if subscription is active
  // Return true/false
  return true; // Placeholder
}

async function checkApiUsage(userId) {
  // Check if user has exceeded their monthly API limits
  // Return { exceeded: boolean, current: number, limit: number }
  return { exceeded: false, current: 0, limit: 1000 }; // Placeholder
}

async function incrementApiUsage(userId, apiType) {
  // Track API usage for billing/limits
  console.log(`API usage: ${userId} used ${apiType}`);
}

async function verifySubscriptionKey(email, subscriptionKey) {
  // Verify with payment provider
  return { valid: true, userId: 'user123', plan: 'pro', expiresAt: Date.now() + 30*24*60*60*1000 }; // Placeholder
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`FlipFinder Pro API server running on port ${PORT}`);
});

module.exports = app;