# ScriptPilot Security Setup Script (PowerShell)
# This script helps set up the enhanced security features on Windows

Write-Host "🚀 ScriptPilot Security Setup" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green

# Check if we're in the right directory
if (-not (Test-Path "requirements.txt")) {
    Write-Host "❌ Error: Please run this script from the ScriptPilot root directory" -ForegroundColor Red
    exit 1
}

# Create .env file if it doesn't exist
if (-not (Test-Path ".env")) {
    Write-Host "📝 Creating .env file from template..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "✅ Created .env file. Please update it with your configuration." -ForegroundColor Green
} else {
    Write-Host "⚠️  .env file already exists. Skipping creation." -ForegroundColor Yellow
}

# Install Python dependencies
Write-Host "📦 Installing Python dependencies..." -ForegroundColor Yellow
try {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        python -m pip install -r requirements.txt
    } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
        python3 -m pip install -r requirements.txt
    } else {
        throw "Python not found"
    }
    Write-Host "✅ Python dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Error installing Python dependencies: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Please make sure Python and pip are installed and in your PATH" -ForegroundColor Red
    exit 1
}

# Check Redis availability (for Windows, we'll provide instructions)
Write-Host "🔍 Checking Redis availability..." -ForegroundColor Yellow
if (Get-Command redis-cli -ErrorAction SilentlyContinue) {
    try {
        $redisTest = redis-cli ping 2>$null
        if ($redisTest -eq "PONG") {
            Write-Host "✅ Redis is running" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Redis is installed but not running." -ForegroundColor Yellow
            Write-Host "Please start Redis manually or install it as a Windows service." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "⚠️  Redis installed but cannot connect." -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  Redis not found." -ForegroundColor Yellow
    Write-Host "For Windows, please install Redis:" -ForegroundColor Yellow
    Write-Host "1. Download from: https://github.com/microsoftarchive/redis/releases" -ForegroundColor Cyan
    Write-Host "2. Or use WSL: wsl --install" -ForegroundColor Cyan
    Write-Host "3. Or use Docker: docker run -d -p 6379:6379 redis:alpine" -ForegroundColor Cyan
    Write-Host "4. Or use a cloud Redis service like Redis Cloud" -ForegroundColor Cyan
}

# Generate a secure secret key
Write-Host "🔐 Generating secure secret key..." -ForegroundColor Yellow
try {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(32))"
    } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
        $SECRET_KEY = python3 -c "import secrets; print(secrets.token_urlsafe(32))"
    } else {
        throw "Python not found"
    }
    
    # Update .env file with generated secret key
    $envContent = Get-Content ".env" -Raw
    $envContent = $envContent -replace "SECRET_KEY=your-super-secret-key-change-this-in-production", "SECRET_KEY=$SECRET_KEY"
    Set-Content ".env" $envContent
    
    Write-Host "✅ Secret key generated and added to .env" -ForegroundColor Green
} catch {
    Write-Host "❌ Error generating secret key: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Create database directory if it doesn't exist
if (-not (Test-Path "app")) {
    New-Item -ItemType Directory -Path "app" -Force | Out-Null
}

# Run database migrations
Write-Host "🗄️  Setting up database..." -ForegroundColor Yellow
try {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        python -c 'from app.database import create_db_and_tables; create_db_and_tables(); print("Database initialized")'
    } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
        python3 -c 'from app.database import create_db_and_tables; create_db_and_tables(); print("Database initialized")'
    } else {
        throw "Python not found"
    }
    Write-Host "✅ Database initialized" -ForegroundColor Green
} catch {
    Write-Host "❌ Error setting up database: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Make sure all dependencies are installed correctly." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎉 Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "1. Review and update the .env file with your configuration" -ForegroundColor White
Write-Host "2. Start the application: uvicorn app.main:app --reload" -ForegroundColor White
Write-Host "3. Visit http://localhost:8000/login to access the application" -ForegroundColor White
Write-Host ""
Write-Host "🔑 Default admin credentials:" -ForegroundColor Cyan
Write-Host "   Username: admin" -ForegroundColor White
Write-Host "   Password: admin123" -ForegroundColor White
Write-Host "   ⚠️  Please change these credentials after first login!" -ForegroundColor Yellow
Write-Host ""
Write-Host "📚 Security features enabled:" -ForegroundColor Cyan
Write-Host "   ✅ User authentication with JWT" -ForegroundColor Green
Write-Host "   ✅ Role-based access control (Admin, Editor, Viewer)" -ForegroundColor Green
Write-Host "   ✅ Two-factor authentication (2FA)" -ForegroundColor Green
Write-Host "   ✅ Password hashing with bcrypt" -ForegroundColor Green
Write-Host "   ✅ Session management with Redis" -ForegroundColor Green
Write-Host "   ✅ Audit logging" -ForegroundColor Green
Write-Host "   ✅ Login attempt tracking" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Pro tip: If Redis is not available, session management will be limited" -ForegroundColor Yellow
Write-Host "   but the application will still work for basic authentication." -ForegroundColor Yellow
