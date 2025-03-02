# Prometheus

A sophisticated BitMEX Grid Trading Bot designed for professional cryptocurrency trading with adaptive grid strategies.

## Overview

Prometheus implements an advanced grid trading system for BitMEX that automatically places buy and sell orders at calculated price intervals. The system creates a dynamic grid of orders that can capture profits from price volatility within a specified range, with intelligent adaptations based on market conditions.

## Key Features

- **Adaptive Grid Trading**
  - Dynamic grid spacing based on Average True Range (ATR)
  - Asymmetric grid positioning aligned with detected market trends
  - Automatically fills detected grid gaps during operation

- **Intelligent Order Management**
  - Precise order matching for round-trip trade tracking
  - Automatic gap detection and repair in order grid
  - Smart order sizing that varies with price levels

- **Market Trend Detection**
  - Real-time trend analysis using multiple technical indicators
  - Adjusts grid asymmetry based on trend direction and strength
  - Optimizes profit potential by widening grid in trend direction

- **Advanced Risk Management**
  - Position size limits to control exposure
  - Order count limits to manage API usage and risk
  - Configurable parameters for fine-tuning risk profile

- **Operational Features**
  - Live trading and simulation (dry run) modes
  - WebSocket integration for real-time market data
  - Persistent state management across sessions
  - Comprehensive metrics collection via InfluxDB (optional)
  - Robust error handling and automatic recovery

## Installation

### Prerequisites

- Node.js (v16 or later)
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

4. Configure your environment:
```bash
cp .env.example .env
```

5. Edit the `.env` file with your BitMEX API credentials and preferences

## Configuration

The `.env` file controls the main application settings:

```
# BitMEX API Credentials
BITMEX_API_KEY=your_api_key
BITMEX_API_SECRET=your_api_secret

# Trading Configuration
TRADING_SYMBOL=XBTUSD
DRY_RUN=true  # Set to false for live trading

# Data Directory (for state persistence)
DATA_DIR=./data

# InfluxDB Configuration (Optional)
INFLUX_ENABLED=false
INFLUX_HOST=http://localhost:8086
INFLUX_TOKEN=your_influx_token
INFLUX_DATABASE=prometheus_grid
INFLUX_DEBUG=false
```

## Advanced Configuration

Fine-tune trading behavior by modifying constants in `src/constants.ts`:

### Grid Parameters
- `ORDER_COUNT`: Number of orders on each side of the grid
- `ORDER_DISTANCE`: Base distance between orders in USD
- `ORDER_SIZE`: Base size of each order in BTC
- `ENFORCE_ORDER_DISTANCE`: Whether to strictly enforce minimum distance between orders

### Risk Management
- `MAX_POSITION_SIZE_BTC`: Maximum allowed position size in BTC
- `MAX_OPEN_ORDERS`: Maximum number of open orders allowed
- `FEE_RATE`: Trading fee rate in percentage

### Dynamic Grid Features
- `INFINITY_GRID_ENABLED`: Enable grid that automatically shifts with market movement
- `GRID_SHIFT_THRESHOLD`: When to shift grid based on price movement
- `GRID_SHIFT_OVERLAP`: Percentage of orders to keep when shifting
- `GRID_AUTO_SHIFT_CHECK_INTERVAL`: How often to check for grid shifts

### Variable Order Sizing
- `VARIABLE_ORDER_SIZE_ENABLED`: Enable dynamic order sizing based on price levels
- `BASE_ORDER_SIZE`: Reference order size for calculations
- `MAX_ORDER_SIZE_MULTIPLIER`: Maximum multiplier for order size at low prices
- `MIN_ORDER_SIZE_MULTIPLIER`: Minimum multiplier for order size at high prices

### Technical Indicators
- `ATR_PERIOD`: Period for ATR calculation
- `ATR_MULTIPLIER`: Multiplier for ATR to determine grid spacing
- `ATR_MINIMUM_GRID_DISTANCE`: Minimum allowed grid distance
- `ATR_MAXIMUM_GRID_DISTANCE`: Maximum allowed grid distance
- `TREND_RSI_PERIOD`: RSI period for trend detection
- `TREND_FAST_EMA_PERIOD`: Fast EMA period for trend detection
- `TREND_SLOW_EMA_PERIOD`: Slow EMA period for trend detection

## Usage

### Dry Run Mode (Simulation)

Test without placing real orders:

```bash
npm run dry-run
```

### Live Trading

⚠️ **WARNING**: This will place real orders using your BitMEX account funds. 

```bash
npm start
```

### Development Mode

For development with live reloading:

```bash
npm run dev
```

## System Architecture

Prometheus consists of several specialized components:

- **LiveOrderManager**: Core system that manages the grid of orders, processes trades, and handles fills
- **LiveWebSocket**: Connects to BitMEX WebSocket API for real-time market data and execution updates
- **BitMEXAPI**: Handles REST API interactions with BitMEX with smart rate limiting
- **TrendAnalyzer**: Performs technical analysis to detect market trends for grid optimization
- **StateManager**: Provides persistence of trading state and statistics
- **MetricsManager**: Tracks comprehensive trading metrics to InfluxDB
- **StatsLogger**: Handles structured logging with trading statistics

## Performance Metrics

When InfluxDB integration is enabled, Prometheus tracks detailed metrics:

- **Trading Performance**: P&L, fees, win/loss ratio
- **Execution Data**: Order fills, execution prices, slippage
- **Market Analysis**: ATR values, trend direction and strength
- **Grid Statistics**: Order spacing, asymmetry factors, grid shifts
- **System Health**: Heartbeats, reconnections, API rate limit usage

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

Trading cryptocurrencies involves significant risk and can result in the loss of your invested capital. This software is provided for educational purposes only. You should not risk money that you cannot afford to lose. The creators of this software are not responsible for any financial losses incurred while using this software.

BitMEX is a complex trading platform with significant leverage capabilities. Always start with small amounts and thoroughly test before committing significant capital.
