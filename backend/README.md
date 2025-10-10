# BAWaterBender Backend

A comprehensive flood management system backend built with FastAPI that handles water alert monitoring, ETL processing, and provides APIs for flood data visualization and analysis.

## 🏗️ Architecture Overview

The backend is structured as a modular FastAPI application with the following key components:

```
backend/
├── app/                    # FastAPI application core
├── config/                 # Centralized configuration
├── common/                 # Shared utilities and database connections
├── etl/                    # Extract, Transform, Load operations
├── models/                 # Data models and schemas
└── requirements.txt        # Python dependencies
```

## 🚀 Quick Start

### Prerequisites

- Python 3.11 or higher
- PostgreSQL database (via Supabase)
- Telegram API credentials (for weather alerts)

### 1. Environment Setup

Create and activate a virtual environment:

```bash
# Create virtual environment
python3 -m venv venv

# Activate on macOS/Linux
source venv/bin/activate

# Activate on Windows
venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Environment Configuration

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Database Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Telegram API (for weather alerts)
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=your_phone_number

# Application Settings
APP_ENV=development
PORT=8000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# JWT Configuration
JWT_SECRET=your-secret-key
JWT_EXPIRES_MIN=10080
```

### 4. Run the Application

```bash
python app.py
```

The API will be available at:
- **Development**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 📁 Component Details

### `/app` - FastAPI Application Core

The main application directory containing the FastAPI setup and routing.

#### **`app/main.py`**
- FastAPI application instance
- CORS middleware configuration
- Router integration
- Telegram weather alerts initialization

#### **`app/routers/`**
- **`router.py`**: Main API router with `/api` prefix
- **`health/`**: Health check endpoints
- **`weather_alerts/`**: Weather alert API endpoints

#### **`app/core/`**
- **`security.py`**: JWT authentication and authorization utilities

#### **`app/models/`**
- **`schemas.py`**: Pydantic models for request/response validation

### `/config` - Configuration Management

Centralized configuration module for all application settings.

#### **`config/config.py`**
- Environment-based configuration
- Database connection settings
- External service configurations
- Security settings (JWT, CORS)

### `/common` - Shared Utilities

Common utilities and services used across the application.

#### **`common/db.py`**
- Supabase database connection management
- Thread-safe database operations
- Connection pooling

#### **`common/logger.py`**
- Centralized logging configuration
- Log formatting and output management

### `/etl` - Data Processing Pipeline

Extract, Transform, Load operations for various data sources.

#### **`etl/pub/`** - PUB Weather Alerts
- **`weather_alerts.py`**: Telegram bot for real-time flood alerts
- **`utils.py`**: Alert parsing and processing utilities
- **`run_flood_pipeline.py`**: Automated flood data processing

#### **`etl/onemap/`** - OneMap Integration
- **`onemap.py`**: OneMap API client
- **`onemap_extended.py`**: Extended OneMap functionality

#### **`etl/amenities/`** - Amenity Analysis
- **`amenity_accessibility.py`**: Accessibility calculations
- **`amenity_category_classifier.py`**: ML-based categorization
- **`road_network_mapping.py`**: Road network analysis

#### **`etl/historical_floods/`** - Historical Analysis
- **`kde_analysis.py`**: Kernel density estimation for flood patterns
- **`spatiotemporal_floods.py`**: Time-series flood analysis
- **`second_order_analysis.py`**: Advanced statistical analysis

#### **`etl/data/`** - Data Storage
- **CSV files**: Processed amenity and flood data
- **GeoJSON files**: Geographical boundary data
- **Cache files**: API response caching

### `/models` - Data Models

#### **`models/pub_models.py`**
- PUB-specific data models
- Weather alert schemas
- Flood event data structures

## 🔧 Development

### Running in Development Mode

The application automatically detects the environment and enables development features:

```bash
# Development mode (auto-reload enabled)
APP_ENV=development python app.py

# Production mode
APP_ENV=production python app.py
```

### API Endpoints

#### Health Check
```
GET /api/health
```

#### Weather Alerts
```
GET /api/weather-alerts
POST /api/weather-alerts
```

### ETL Operations

#### Manual ETL Execution

Run specific ETL processes:

```bash
# Process flood road segment matching
python etl/scripts/run_flood_road_segment_matching.py

# Amenity accessibility analysis
python etl/amenities/scripts/run_accessibility.py

# Upload geographic data
python etl/data/scripts/planning_area_geojson_upload.py
python etl/data/scripts/subzone_geojson_upload.py
```

## 🗄️ Database Schema

The application uses Supabase (PostgreSQL) with the following main tables:

- **`weather_alerts`**: Real-time flood alerts from PUB
- **`floods`**: Historical flood event data
- **`amenities`**: Points of interest and facilities
- **`road_network`**: Singapore road network data
- **`planning_area`**: Singapore planning area boundaries
- **`subzone`**: Singapore subzone boundaries

## 🔐 Security

### Authentication

The application uses JWT-based authentication:

- **Token Generation**: `/auth/login`
- **Token Validation**: Automatic middleware validation
- **Protected Routes**: Require valid JWT in Authorization header

### CORS Configuration

Cross-Origin Resource Sharing is configured for:
- Development: `localhost:3000`, `localhost:5173`
- Production: Configurable via `ALLOWED_ORIGINS` environment variable

## 📊 Monitoring and Logging

### Logging

Structured logging is implemented throughout the application:

- **Development**: Console output with detailed formatting
- **Production**: File-based logging with rotation
- **Log Levels**: DEBUG, INFO, WARNING, ERROR, CRITICAL

### Health Checks

Monitor application health via:
- **Basic Health**: `/api/health`
- **Database Health**: Automatic connection testing
- **External Services**: API dependency checks

## 🚨 Error Handling

The application implements comprehensive error handling:

- **HTTP Exceptions**: Proper status codes and error messages
- **Database Errors**: Connection and query error recovery
- **ETL Failures**: Graceful degradation and retry logic
- **External API Failures**: Timeout and fallback mechanisms

## 🔄 Background Tasks

### Telegram Weather Alerts

Automated monitoring of PUB flood alerts:

- **Real-time Processing**: Telegram bot listens for new alerts
- **Data Extraction**: Parses alert messages for structured data
- **Database Storage**: Stores processed alerts for API access
- **Error Recovery**: Automatic reconnection and error handling

### Scheduled ETL Jobs

Configurable data processing jobs:

- **Flood Data Updates**: Regular sync with external sources
- **Amenity Data Refresh**: Periodic updates from OneMap
- **Analytics Preprocessing**: Cached analysis results

## 📦 Deployment

### Docker Support

Build and run with Docker:

```bash
# Build image
docker build -t bawaterbender-backend .

# Run container
docker run -p 8000:8000 --env-file .env bawaterbender-backend
```

### Vercel Deployment

The application is configured for Vercel deployment:

- **`vercel.json`**: Deployment configuration
- **Environment Variables**: Set in Vercel dashboard
- **Build Process**: Automatic dependency installation

## 🧪 Testing

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/test_weather_alerts.py
```

### Test Structure

- **Unit Tests**: Individual component testing
- **Integration Tests**: API endpoint testing
- **ETL Tests**: Data processing validation

## 📈 Performance

### Optimization Features

- **Database Connection Pooling**: Efficient database resource usage
- **Response Caching**: Redis-based API response caching
- **Async Operations**: Non-blocking I/O for external API calls
- **Data Pagination**: Large dataset handling

### Monitoring

- **Response Time Tracking**: Built-in request timing
- **Database Query Optimization**: Query analysis and indexing
- **Memory Usage Monitoring**: Resource utilization tracking

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make changes and test thoroughly
4. Commit with descriptive messages
5. Push and create a Pull Request

### Code Standards

- **Python**: Follow PEP 8 style guidelines
- **Type Hints**: Use type annotations throughout
- **Documentation**: Document all functions and classes
- **Testing**: Write tests for new functionality

## 📞 Support

For issues and questions:

- **GitHub Issues**: [Project Issues](https://github.com/JialeSo/FYP_BAWaterBender/issues)
- **Documentation**: Check `/docs` API documentation
- **Logs**: Check application logs for error details

---

**BAWaterBender Backend** - Comprehensive flood management system for Singapore 🇸🇬