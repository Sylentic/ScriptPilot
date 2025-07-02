#!/bin/bash

# ScriptPilot Security Setup Script
# This script helps set up the enhanced security features

echo "🚀 ScriptPilot Security Setup"
echo "=============================="

# Check if we're in the right directory
if [ ! -f "requirements.txt" ]; then
    echo "❌ Error: Please run this script from the ScriptPilot root directory"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ Created .env file. Please update it with your configuration."
else
    echo "⚠️  .env file already exists. Skipping creation."
fi

# Install Python dependencies
echo "📦 Installing Python dependencies..."
if command -v pip3 &> /dev/null; then
    pip3 install -r requirements.txt
elif command -v pip &> /dev/null; then
    pip install -r requirements.txt
else
    echo "❌ Error: pip not found. Please install Python and pip first."
    exit 1
fi

echo "✅ Python dependencies installed"

# Check Redis availability
echo "🔍 Checking Redis availability..."
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "✅ Redis is running"
    else
        echo "⚠️  Redis is installed but not running. Starting Redis..."
        if command -v redis-server &> /dev/null; then
            redis-server --daemonize yes
            echo "✅ Redis started"
        else
            echo "❌ Could not start Redis automatically"
        fi
    fi
else
    echo "⚠️  Redis not found. Installing Redis..."
    
    # Detect OS and install Redis
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y redis-server
        elif command -v yum &> /dev/null; then
            sudo yum install -y redis
        elif command -v pacman &> /dev/null; then
            sudo pacman -S redis
        else
            echo "❌ Could not detect package manager. Please install Redis manually."
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install redis
            brew services start redis
        else
            echo "❌ Homebrew not found. Please install Redis manually."
        fi
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        # Windows
        echo "❌ Please install Redis for Windows manually:"
        echo "   Download from: https://github.com/MicrosoftArchive/redis/releases"
    fi
fi

# Generate a secure secret key
echo "🔐 Generating secure secret key..."
if command -v python3 &> /dev/null; then
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
elif command -v python &> /dev/null; then
    SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(32))")
else
    echo "❌ Error: Python not found."
    exit 1
fi

# Update .env file with generated secret key
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/SECRET_KEY=your-super-secret-key-change-this-in-production/SECRET_KEY=$SECRET_KEY/" .env
else
    # Linux
    sed -i "s/SECRET_KEY=your-super-secret-key-change-this-in-production/SECRET_KEY=$SECRET_KEY/" .env
fi

echo "✅ Secret key generated and added to .env"

# Create database directory if it doesn't exist
mkdir -p app

# Run database migrations
echo "🗄️  Setting up database..."
if command -v python3 &> /dev/null; then
    python3 -c "
from app.database import create_db_and_tables
create_db_and_tables()
print('✅ Database initialized')
"
else
    python -c "
from app.database import create_db_and_tables
create_db_and_tables()
print('✅ Database initialized')
"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Review and update the .env file with your configuration"
echo "2. Start the application: uvicorn app.main:app --reload"
echo "3. Visit http://localhost:8000/login to access the application"
echo ""
echo "🔑 Default admin credentials:"
echo "   Username: admin"
echo "   Password: admin123"
echo "   ⚠️  Please change these credentials after first login!"
echo ""
echo "📚 Security features enabled:"
echo "   ✅ User authentication with JWT"
echo "   ✅ Role-based access control (Admin, Editor, Viewer)"
echo "   ✅ Two-factor authentication (2FA)"
echo "   ✅ Password hashing with bcrypt"
echo "   ✅ Session management with Redis"
echo "   ✅ Audit logging"
echo "   ✅ Login attempt tracking"
echo ""
