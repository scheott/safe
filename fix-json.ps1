# Fix JSON encoding issues
Write-Host "🔧 Fixing JSON files..." -ForegroundColor Yellow

# Root package.json (clean version)
$rootPackage = '{
  "name": "safesignal",
  "private": true,
  "workspaces": [
    "extension",
    "website"
  ],
  "scripts": {
    "dev": "concurrently \"npm run dev:extension\" \"npm run dev:website\" \"npm run dev:api\"",
    "dev:extension": "cd extension && npm run dev",
    "dev:website": "cd website && npm run dev", 
    "dev:api": "cd api && uvicorn src.main:app --reload --host 0.0.0.0 --port 8000",
    "build": "npm run build:extension && npm run build:website",
    "build:extension": "cd extension && npm run build",
    "build:website": "cd website && npm run build"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}'

# Extension package.json (clean version)  
$extensionPackage = '{
  "name": "safesignal-extension",
  "version": "1.0.0",
  "description": "SafeSignal Chrome Extension",
  "scripts": {
    "dev": "webpack --mode development --watch",
    "build": "webpack --mode production"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.246",
    "copy-webpack-plugin": "^11.0.0",
    "css-loader": "^6.8.1",
    "webpack": "^5.88.0",
    "webpack-cli": "^5.1.0"
  }
}'

# Website package.json (clean version)
$websitePackage = '{
  "name": "safesignal-website",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "13.5.4",
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.31",
    "tailwindcss": "^3.3.3",
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18"
  }
}'

# Write files with proper encoding
[System.IO.File]::WriteAllText("package.json", $rootPackage)
[System.IO.File]::WriteAllText("extension/package.json", $extensionPackage)  
[System.IO.File]::WriteAllText("website/package.json", $websitePackage)

Write-Host "✅ Fixed JSON files!" -ForegroundColor Green
Write-Host ""
Write-Host "Now run:" -ForegroundColor Cyan
Write-Host "npm install" -ForegroundColor White