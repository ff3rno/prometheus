# Prometheus

A sophisticated BitMEX Grid Trading Bot designed for efficient cryptocurrency trading on the BitMEX exchange.

## Overview

Prometheus is an automated trading bot implementing a grid trading strategy on BitMEX. Grid trading involves placing buy and sell orders at regular price intervals, creating a grid of orders that can profit from price volatility within a range.

## Features

- **Grid Trading Strategy** - Places orders at configurable intervals to capitalize on price movements
- **Live Trading & Dry Run Modes** - Test with no risk using the dry run mode
- **Real-Time Data Processing** - WebSocket integration for live market data
- **State Persistence** - Trading session state is saved and can be resumed
- **Metrics Integration** - Optional InfluxDB integration for performance tracking
- **Smart API Management** - Rate limiting and exponential backoff for API interaction
- **Auto-Reconnection** - Robust WebSocket reconnection with exponential backoff
- **Comprehensive Logging** - Detailed activity logs for monitoring

## Installation

### Prerequisites

- Node.js (v14 or later)
- npm or yarn
- BitMEX account with API credentials (for live trading)
- InfluxDB (optional, for metrics collection)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/prometheus.git
cd prometheus
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Create a `.env` file in the project root with your configuration (see Configuration section).

## Configuration

Create a `.env` file with the following variables:

```
# BitMEX API Credentials
BITMEX_API_KEY=your_api_key
BITMEX_API_SECRET=your_api_secret

# Trading Configuration
TRADING_SYMBOL=XBTUSD
DRY_RUN=true  # Set to false for live trading

# Data Directory
DATA_DIR=./data

# InfluxDB Configuration (Optional)
INFLUX_ENABLED=false
INFLUX_HOST=http://localhost:8086
INFLUX_TOKEN=your_influx_token
INFLUX_DATABASE=prometheus_grid
```

## Usage

### Dry Run Mode

Run the bot in dry run mode (no real orders will be placed):

```bash
npm run dry-run
```

### Live Trading Mode

⚠️ **WARNING**: This will place real orders using your BitMEX account. 

```bash
npm start
```

### Development Mode

For development with live reloading:

```bash
npm run dev
```

### Print Orders

To view the current order grid:

```bash
npm run print-orders
```

## Configuration Options

The trading behavior can be customized by modifying the constants in `src/constants.ts`:

- `ORDER_COUNT`: Number of orders on each side of the grid
- `ORDER_DISTANCE`: Price distance between grid orders
- `ORDER_SIZE`: Size of each order in BTC

## Key Components

- **LiveOrderManager**: Manages the order grid, processes trades, and handles order fills
- **LiveWebSocket**: Connects to BitMEX WebSocket API to receive real-time market data
- **BitMEXAPI**: Handles all REST API interactions with BitMEX
- **StateManager**: Provides state persistence across bot restarts
- **MetricsManager**: Records trading metrics to InfluxDB (when enabled)

## Data Storage

The bot stores state in a JSON file located in the data directory. This includes:
- Active orders
- Completed trades
- Cumulative P&L
- Trading statistics

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

Trading cryptocurrencies involves significant risk and can result in the loss of your invested capital. This software is provided for educational purposes only and you should not risk money that you cannot afford to lose. The creators of this software are not responsible for any financial losses incurred while using this software.

Always start with small amounts and test thoroughly before committing significant capital.
