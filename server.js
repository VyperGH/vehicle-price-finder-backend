const express = require('express');
   const cors = require('cors');
   const rateLimit = require('express-rate-limit');
   require('dotenv').config();

   const app = express();
   const PORT = process.env.PORT || 3001;

   app.use(express.json());
   app.use(cors({
     origin: function(origin, callback) {
       // Allow requests with no origin (like mobile apps or curl)
       if (!origin) return callback(null, true);
       
       const allowedOrigins = [
         'http://localhost:3000',
         'https://claude.ai'
       ];
       
       // Check if origin ends with .claude.ai
       if (origin.endsWith('.claude.ai') || allowedOrigins.includes(origin)) {
         callback(null, true);
       } else {
         callback(null, true); // Allow all for now to test
       }
     },
     credentials: true
   }));

   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 100
   });

   app.use('/api/', limiter);

   const cache = new Map();
   const CACHE_DURATION = 30 * 60 * 1000;

   function getCacheKey(endpoint, params) {
     return `${endpoint}-${JSON.stringify(params)}`;
   }

   function getFromCache(key) {
     const cached = cache.get(key);
     if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
       return cached.data;
     }
     cache.delete(key);
     return null;
   }

   function setCache(key, data) {
     cache.set(key, {
       data,
       timestamp: Date.now()
     });
   }

   app.get('/api/health', (req, res) => {
     res.json({ 
       status: 'ok', 
       timestamp: new Date().toISOString(),
       cache_size: cache.size,
       api_key_configured: !!process.env.MARKETCHECK_API_KEY
     });
   });

   app.get('/api/vehicles/search', async (req, res) => {
     try {
       const { make, model, year, zip, radius = 50, rows = 10 } = req.query;

       if (!make || !model || !year || !zip) {
         return res.status(400).json({ 
           error: 'Missing required parameters: make, model, year, zip' 
         });
       }

       const cacheKey = getCacheKey('search', { make, model, year, zip, radius });
       const cachedData = getFromCache(cacheKey);
       
       if (cachedData) {
         console.log('Cache hit for:', cacheKey);
         return res.json({ ...cachedData, cached: true });
       }

       if (!process.env.MARKETCHECK_API_KEY) {
         return res.status(500).json({ 
           error: 'Marketcheck API key not configured',
           message: 'Please add MARKETCHECK_API_KEY to your .env file'
         });
       }

       console.log(`Fetching from Marketcheck API: ${year} ${make} ${model} near ${zip}`);

       const params = new URLSearchParams({
         api_key: process.env.MARKETCHECK_API_KEY,
         make: make,
         model: model,
         year: year,
         zip: zip,
         radius: radius,
         rows: rows,
         start: 0
       });

       const response = await fetch(
         `https://api.marketcheck.com/v2/search/car/active?${params}`,
         {
           headers: {
             'Accept': 'application/json'
           }
         }
       );

       if (!response.ok) {
         const errorText = await response.text();
         console.error('Marketcheck API error:', response.status, errorText);
         
         return res.status(response.status).json({ 
           error: 'Marketcheck API request failed',
           status: response.status,
           details: errorText
         });
       }

       const data = await response.json();

       if (!data.listings || data.listings.length === 0) {
         return res.json({ 
           listings: [],
           num_found: 0,
           message: 'No listings found for this vehicle'
         });
       }

       setCache(cacheKey, data);
       res.json(data);

     } catch (error) {
       console.error('Error in /api/vehicles/search:', error);
       res.status(500).json({ 
         error: 'Internal server error',
         message: error.message 
       });
     }
   });

   app.listen(PORT, () => {
     console.log(`
   🚗 Vehicle Price Finder API
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ✓ Server running on port ${PORT}
   ✓ Environment: ${process.env.NODE_ENV || 'development'}
   ✓ Marketcheck API: ${process.env.MARKETCHECK_API_KEY ? '✓ Configured' : '✗ Not configured'}
   
   Available endpoints:
     GET  /api/health
     GET  /api/vehicles/search
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     `);
   });