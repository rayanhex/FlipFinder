const http = require('http');
const url = require('url');
const querystring = require('querystring');

const server = http.createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.method === 'POST' && req.url === '/api/ebay/search') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const query = data.query;
        
        // Make eBay API call
        const ebayUrl = `https://svcs.ebay.com/services/search/FindingService/v1?` +
          `OPERATION-NAME=findCompletedItems&` +
          `SERVICE-VERSION=1.0.0&` +
          `SECURITY-APPNAME=RayanRas-FlipFind-PRD-2473fdffb-e91c5ba3&` +  // Replace with your actual App ID
          `RESPONSE-DATA-FORMAT=JSON&` +
          `keywords=${encodeURIComponent(query)}&` +
          `itemFilter(0).name=SoldItemsOnly&` +
          `itemFilter(0).value=true&` +
          `paginationInput.entriesPerPage=3`;
        
        const response = await fetch(ebayUrl);
        const ebayData = await response.json();
        
        // Process results
        const items = ebayData.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
        const soldItems = items
          .filter(item => item.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')
          .slice(0, 3)
          .map(item => ({
            title: item.title?.[0] || '',
            price: parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0),
            endTime: item.listingInfo?.[0]?.endTime?.[0] || ''
          }))
          .filter(item => item.price > 0);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ soldItems }));
        
      } catch (error) {
        console.error('Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3000, () => {
  console.log('Simple server running on port 3000');
});