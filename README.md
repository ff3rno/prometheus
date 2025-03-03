# Prometheus

A sophisticated BitMEX Grid Trading Bot designed for professional cryptocurrency trading with adaptive grid strategies and advanced market analysis.

## Overview

Prometheus implements an advanced grid trading system for BitMEX that automatically places buy and sell orders at calculated price intervals. The system creates a dynamic grid of orders that captures profits from price volatility within a specified range, with intelligent adaptations based on market conditions, breakout detection, and trend analysis.

## Key Features

- **Adaptive Grid Trading**
  - Dynamic grid spacing based on Average True Range (ATR)
  - Asymmetric grid positioning aligned with detected market trends
  - Automated grid shifting when price approaches boundaries
  - Intelligent gap detection and repair during operation

- **Breakout Trading Mode**
  - Automated breakout detection beyond normal grid boundaries
  - Configurable profit targets and stop losses for breakout trades
  - Flexible position sizing based on volatility measurements
  - Automatic trade exit on timeout or target achievement

- **SEC Filing Monitor**
  - Real-time monitoring of SEC EDGAR filings
  - Automated downloading and analysis of important documents
  - Rate-limited API requests to comply with SEC guidelines
  - Persistent storage of filing history and analytics

- **Advanced Order Management**
  - Precise order matching for round-trip trade tracking
  - Smart order sizing that varies with price levels
  - Detailed profit and loss tracking at each grid level
  - Fill time distribution analysis for trading optimization

- **Market Analysis**
  - Real-time trend analysis using multiple technical indicators
  - Adjusts grid asymmetry based on trend direction and strength
  - Optimizes profit potential by widening grid in trend direction
  - Price volatility monitoring for adaptive trade sizing

- **Enhanced Risk Management**
  - Position size limits with dynamic adaptation
  - Intelligent position sizing based on market conditions
  - Order count limits to manage API usage and risk
  - Configurable parameters for fine-tuning risk profile

- **Comprehensive Metrics**
  - Detailed performance tracking via InfluxDB
  - Grid level profitability analysis
  - Fill time distribution metrics
  - Position and P&L monitoring
  - Grid boundary efficiency measurement
  - Rebalancing impact analysis

- **Operational Features**
  - Live trading and simulation (dry run) modes
  - WebSocket integration for real-time market data
  - Persistent state management across sessions
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

# SEC Monitor Configuration (Optional)
SEC_MONITOR_ENABLED=false
```

## Advanced Configuration

Fine-tune trading behavior by modifying constants in `src/constants.ts`:

### Grid Parameters
- `ORDER_COUNT`: Number of orders on each side of the grid
- `ORDER_DISTANCE`: Base distance between orders in USD
- `ORDER_SIZE`: Base size of each order in BTC
- `ENFORCE_ORDER_DISTANCE`: Whether to strictly enforce minimum distance between orders
- `GRID_LOWER_BOUND`: Lower price boundary for the grid
- `GRID_UPPER_BOUND`: Upper price boundary for the grid

### Risk Management
- `MAX_POSITION_SIZE_BTC`: Maximum allowed position size in BTC
- `MAX_OPEN_ORDERS`: Maximum number of open orders allowed
- `FEE_RATE`: Trading fee rate in percentage
- `POSITION_RISK_LIMIT`: Maximum risk exposure allowed

### Dynamic Grid Features
- `INFINITY_GRID_ENABLED`: Enable grid that automatically shifts with market movement
- `GRID_SHIFT_THRESHOLD`: When to shift grid based on price movement
- `GRID_SHIFT_OVERLAP`: Percentage of orders to keep when shifting
- `GRID_AUTO_SHIFT_CHECK_INTERVAL`: How often to check for grid shifts
- `GRID_SHIFT_THROTTLE_MS`: Minimum time between grid shifts

### Variable Order Sizing
- `VARIABLE_ORDER_SIZE_ENABLED`: Enable dynamic order sizing based on price levels
- `BASE_ORDER_SIZE`: Reference order size for calculations
- `MAX_ORDER_SIZE_MULTIPLIER`: Maximum multiplier for order size at low prices
- `MIN_ORDER_SIZE_MULTIPLIER`: Minimum multiplier for order size at high prices

### Breakout Trading
- `BREAKOUT_ENABLED`: Enable breakout trading functionality
- `BREAKOUT_ATR_MULTIPLIER`: ATR multiplier to determine breakout threshold
- `BREAKOUT_MAX_DURATION_MS`: Maximum duration of a breakout trade
- `BREAKOUT_TAKE_PROFIT_MULTIPLIER`: Take profit level as ATR multiplier
- `BREAKOUT_STOP_LOSS_MULTIPLIER`: Stop loss level as ATR multiplier
- `BREAKOUT_POSITION_SIZE`: Size of breakout trades relative to grid trades

### Technical Indicators
- `ATR_PERIOD`: Period for ATR calculation
- `ATR_MULTIPLIER`: Multiplier for ATR to determine grid spacing
- `ATR_MINIMUM_GRID_DISTANCE`: Minimum allowed grid distance
- `ATR_MAXIMUM_GRID_DISTANCE`: Maximum allowed grid distance
- `TREND_RSI_PERIOD`: RSI period for trend detection
- `TREND_FAST_EMA_PERIOD`: Fast EMA period for trend detection
- `TREND_SLOW_EMA_PERIOD`: Slow EMA period for trend detection

### SEC Monitor
- `SEC_POLL_INTERVAL_MS`: Interval between SEC feed checks
- `SEC_COMPANY_FILTER`: List of company CIKs to monitor
- `SEC_FILING_TYPES`: Types of filings to monitor

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

### SEC Monitor

Monitor SEC filings independently:

```bash
npm run sec-monitor
```

### Development Mode

For development with live reloading:

```bash
npm run dev
```

## System Architecture

Prometheus consists of several specialized components:

- **LiveOrderManager**: Core system that manages the grid of orders, processes trades, and handles fills
- **BreakoutDetector**: Detects and manages trades for breakout opportunities
- **LiveWebSocket**: Connects to BitMEX WebSocket API for real-time market data and execution updates
- **BitMEXAPI**: Handles REST API interactions with BitMEX with smart rate limiting
- **TrendAnalyzer**: Performs technical analysis to detect market trends for grid optimization
- **StateManager**: Provides persistence of trading state and statistics
- **MetricsManager**: Tracks comprehensive trading metrics to InfluxDB
- **StatsLogger**: Handles structured logging with trading statistics
- **SECMonitor**: Independent component for monitoring SEC filings

## Performance Metrics

When InfluxDB integration is enabled, Prometheus tracks detailed metrics:

- **Trading Performance**: P&L, fees, win/loss ratio
- **Execution Data**: Order fills, execution prices, slippage
- **Market Analysis**: ATR values, trend direction and strength
- **Grid Statistics**: Order spacing, asymmetry factors, grid shifts
- **System Health**: Heartbeats, reconnections, API rate limit usage
- **Grid Level Profitability**: Performance tracking at each price level
- **Fill Time Distribution**: Analysis of time between fills at each level
- **Grid Boundary Efficiency**: How often price hits grid boundaries
- **Grid Rebalancing**: Frequency and impact of grid shifts
- **Position Tracking**: Real-time position metrics including unrealized P&L
- **Breakout Performance**: Success rates and P&L for breakout trades

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
