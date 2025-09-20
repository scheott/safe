# SafeSignal

Gentle web safety guidance for seniors and their families.

## Quick Start

1. **Setup Environment**
   ```powershell
   # Copy and fill environment variables
   Copy-Item .env.example .env
   ```

2. **Install Dependencies**
   ```powershell
   # Root dependencies (workspace manager)
   npm install
   
   # Extension dependencies
   cd extension; npm install; cd ..
   
   # Website dependencies  
   cd website; npm install; cd ..
   
   # API dependencies
   cd api; pip install -r requirements.txt; cd ..
   ```

3. **Development**
   ```powershell
   # Start all services (extension build, website, API)
   npm run dev
   ```
   
   - Extension: Load `extension/dist` in Chrome
   - Website: http://localhost:3000
   - API: http://localhost:8000

## Architecture

- **Extension** (`/extension`): Chrome MV3 extension with content script badge
- **Website** (`/website`): Next.js marketing site + demo
- **API** (`/api`): FastAPI backend for URL analysis and billing

## Development Workflow

1. Extension development: `npm run dev:extension` (builds on file changes)
2. Website development: `npm run dev:website` (Next.js dev server)
3. API development: `npm run dev:api` (uvicorn with reload)

Load the extension in Chrome:
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" â†’ select `extension/dist/`

## Project Structure

```
safesignal/
â”œâ”€â”€ extension/          # Chrome extension
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ content/    # Content script (badge injection)
â”‚   â”‚   â”œâ”€â”€ background/ # Service worker
â”‚   â”‚   â””â”€â”€ popup/      # Extension popup UI
â”‚   â””â”€â”€ public/         # Static assets
â”œâ”€â”€ website/            # Marketing website  
â”‚   â””â”€â”€ src/app/        # Next.js 13 app router
â”œâ”€â”€ api/                # FastAPI backend
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ routes/     # API endpoints
â”‚       â”œâ”€â”€ models/     # Database models
â”‚       â””â”€â”€ services/   # Business logic
â””â”€â”€ docs/               # Documentation
```

## License

Proprietary - SafeSignal, Inc.
