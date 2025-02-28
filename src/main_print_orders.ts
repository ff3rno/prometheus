// BitMEX API Client for retrieving open orders
// Based on: https://raw.githubusercontent.com/BitMEX/api-connectors/refs/heads/master/official-http/node-fetch/index.js

import axios, { AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';
import { URL } from 'url';
import signale from 'signale';
import dotenv from 'dotenv';

dotenv.config();

// API Configuration - replace with your API keys
const API_KEY = process.env.BITMEX_API_KEY || '';
const API_SECRET = process.env.BITMEX_API_SECRET || '';
const BASE_URL = 'https://www.bitmex.com';

// Interface for BitMEX order response
interface BitMEXOrder {
  orderID: string;
  symbol: string;
  side: string;
  orderQty: number;
  price?: number;
  stopPx?: number;
  ordType: string;
  ordStatus: string;
  timestamp: string;
  leavesQty: number;
  text: string;
  [key: string]: any; // For any additional fields
}

/**
 * Generates the signature for BitMEX API authentication
 */
function generateSignature(
  secret: string,
  verb: string,
  path: string,
  expires: number,
  data: string = ''
): string {
  const message = verb + path + expires + data;
  return crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
}

/**
 * Makes a request to the BitMEX API
 */
async function makeRequest(
  method: string,
  endpoint: string,
  data: Record<string, any> = {}
): Promise<any> {
  const url = new URL(endpoint, BASE_URL);
  const path = url.pathname;
  
  // For GET requests, append query parameters to path
  const queryParams = method === 'GET' ? new URLSearchParams(data).toString() : '';
  const fullPath = queryParams ? `${path}?${queryParams}` : path;
  
  // Create expires and signature
  const expires = Math.round(Date.now() / 1000) + 60; // 1 minute in the future
  const signature = generateSignature(
    API_SECRET,
    method,
    fullPath,
    expires,
    method === 'GET' ? '' : JSON.stringify(data)
  );
  
  // Set up request configuration
  const config: AxiosRequestConfig = {
    method,
    url: url.toString() + (queryParams && method === 'GET' ? `?${queryParams}` : ''),
    headers: {
      'Content-Type': 'application/json',
      'api-expires': expires.toString(),
      'api-key': API_KEY,
      'api-signature': signature
    }
  };
  
  // Add request body for non-GET requests
  if (method !== 'GET' && Object.keys(data).length > 0) {
    config.data = data;
  }
  
  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      signale.error(`Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    } else {
      signale.error('Error making request:', error);
    }
    throw error;
  }
}

/**
 * Fetches open orders from the BitMEX API
 */
async function getOpenOrders(): Promise<BitMEXOrder[]> {
  try {
    const queryParams = {
      filter: JSON.stringify({ open: true }),
      reverse: true
    };
    
    return await makeRequest('GET', '/api/v1/order', queryParams);
  } catch (error) {
    signale.error('Failed to fetch open orders');
    return [];
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  if (!API_KEY || !API_SECRET) {
    signale.error('API key and secret must be provided as environment variables');
    signale.info('Set BITMEX_API_KEY and BITMEX_API_SECRET environment variables');
    process.exit(1);
  }
  
  try {
    signale.await('Fetching open orders from BitMEX...');
    const orders = await getOpenOrders();
    
    if (orders.length === 0) {
      signale.info('No open orders found');
    } else {
      signale.success(`Found ${orders.length} open orders:`);
      orders.forEach((order, index) => {
        signale.info(`Order #${index + 1}:`);
        console.log(JSON.stringify(order, null, 2));
        console.log('----------------------------------------------');
      });
    }
  } catch (error) {
    signale.fatal('An error occurred while fetching orders');
    process.exit(1);
  }
}

// Execute the main function
if (require.main === module) {
  main().catch((error) => {
    signale.fatal('Unhandled error:', error);
    process.exit(1);
  });
}
