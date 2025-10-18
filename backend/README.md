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
TELE_API_ID=your_telegram_api_id
TELE_API_HASH=your_telegram_api_hash
TELE_PHONE_NO=+your_phone_number_with_country_code

# PUB Channel Configuration
PUB_CHANNEL_USERNAME=@pub_channel_username
PUB_CREDENTIALS_BUCKET=telegram-sessions

# Application Settings
APP_ENV=development
PORT=8000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# JWT Configuration
JWT_SECRET=your-secret-key
JWT_EXPIRES_MIN=10080
```

### 4. Telegram Session Setup

The application uses Telegram's session-based authentication to avoid repeated login prompts. Follow these steps to set up your Telegram session:

#### **Step 1: Generate Session File**

First, you'll need to create a session file locally:

1. Create a simple Python script to generate the session:

```python
from telethon import TelegramClient
import os
from dotenv import load_dotenv

load_dotenv()

api_id = os.getenv("TELE_API_ID")
api_hash = os.getenv("TELE_API_HASH")
phone = os.getenv("TELE_PHONE_NO")

# This will create a session.session file
client = TelegramClient("session", int(api_id), api_hash)

async def main():
    await client.start(phone=phone)
    print("Session created successfully!")
    await client.disconnect()

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

2. Run the script and follow the authentication prompts:
   - Enter the verification code sent to your phone
   - If two-factor authentication is enabled, enter your password

3. This will create a `session.session` file in your project directory

#### **Step 2: Upload Session to Supabase Storage**

1. **Create Storage Bucket**: In your Supabase dashboard, create a storage bucket named `telegram-sessions`

2. **Prepare Session File**: Rename your session file using the naming convention:
   ```
   session.session_{phone_number_without_plus}
   ```
   
   **Examples**:
   - Phone: `+6512345678` → Filename: `session.session_6512345678`
   - Phone: `+1234567890` → Filename: `session.session_1234567890`

3. **Upload to Supabase**: Upload the renamed file to the `telegram-sessions` bucket

4. **Set Bucket Permissions**: Ensure your service role has read access to the bucket

#### **Session Management**

The application automatically handles session management:

1. **Startup**: Downloads the session file from Supabase storage
2. **Authentication**: Uses the session file for automatic login
3. **Storage**: Saves the session as `session.session` in the backend directory
4. **Error Handling**: Graceful fallback if session retrieval fails

### 5. Run the Application

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

Automated monitoring of PUB flood alerts with session-based authentication:

- **Session Management**: Automatic retrieval of Telegram session from Supabase storage
- **Credential Security**: Session files stored securely in Supabase with proper naming convention
- **Real-time Processing**: Telegram client listens for new alerts using stored session
- **Data Extraction**: Parses alert messages for structured data
- **Database Storage**: Stores processed alerts for API access
- **Error Recovery**: Automatic reconnection and error handling
- **Authentication Flow**: 
  1. Download session file from Supabase (`session.session_{phone_number}`)
  2. Initialize Telegram client with existing session
  3. Start monitoring without manual authentication

#### **Session File Naming Convention**

Session files in Supabase storage follow this pattern:
- **Storage Path**: `telegram-sessions/session.session_{phone_number}`
- **Phone Format**: Remove `+` and any formatting characters
- **Examples**:
  - `+65 1234 5678` → `session.session_6512345678`
  - `+1-234-567-8900` → `session.session_12345678900`

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

## 🔧 Troubleshooting

### Telegram Authentication

**Issue**: "Session file not found" error
**Solution**: 
1. Verify session file exists in Supabase `pub_tele_creds` bucket
2. Check filename follows convention: `session.session_{phone_number_no}`
3. Ensure phone number in `.env` matches the session file

### Common Setup Issues

**Issue**: Environment variables not loading
**Solution**:
1. Ensure `.env` file is in the root directory
2. Check variable names match exactly (case-sensitive)
3. Restart the application after changes

**Issue**: Database connection errors
**Solution**:
1. Verify Supabase URL and keys are correct
2. Check network connectivity
3. Ensure database is running and accessible




**BAWaterBender Backend** - Comprehensive flood management system for Singapore 🇸🇬