import os
from datetime import datetime, timedelta
from typing import Optional, Union
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import pyotp
import qrcode
from io import BytesIO
import base64
import redis
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Email imports moved to EmailService class to avoid import conflicts

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-super-secret-key-change-this")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# Redis Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
try:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
except:
    print("Warning: Redis not available. Session management will be limited.")
    redis_client = None

# HTTP Bearer for JWT
security = HTTPBearer()

class AuthUtils:
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash"""
        return pwd_context.verify(plain_password, hashed_password)

    @staticmethod
    def get_password_hash(password: str) -> str:
        """Hash a password"""
        return pwd_context.hash(password)

    @staticmethod
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Create a JWT access token"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode.update({"exp": expire, "type": "access"})
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt

    @staticmethod
    def create_refresh_token(data: dict) -> str:
        """Create a JWT refresh token"""
        to_encode = data.copy()
        expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        to_encode.update({"exp": expire, "type": "refresh"})
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt

    @staticmethod
    def verify_token(token: str, token_type: str = "access") -> Optional[dict]:
        """Verify and decode a JWT token"""
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            
            # Check token type
            if payload.get("type") != token_type:
                return None
                
            return payload
        except JWTError:
            return None

    @staticmethod
    def blacklist_token(token: str, expire_time: int = None):
        """Add token to blacklist (requires Redis)"""
        if redis_client:
            if expire_time is None:
                expire_time = ACCESS_TOKEN_EXPIRE_MINUTES * 60
            redis_client.setex(f"blacklist:{token}", expire_time, "true")

    @staticmethod
    def is_token_blacklisted(token: str) -> bool:
        """Check if token is blacklisted"""
        if redis_client:
            return redis_client.exists(f"blacklist:{token}")
        return False

class TwoFactorAuth:
    @staticmethod
    def generate_secret() -> str:
        """Generate a new TOTP secret"""
        return pyotp.random_base32()

    @staticmethod
    def generate_qr_code(secret: str, username: str, app_name: str = "ScriptPilot") -> str:
        """Generate QR code for TOTP setup"""
        totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
            name=username,
            issuer_name=app_name
        )
        
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(totp_uri)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to base64
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        return f"data:image/png;base64,{img_base64}"

    @staticmethod
    def verify_totp(secret: str, token: str) -> bool:
        """Verify a TOTP token"""
        totp = pyotp.TOTP(secret)
        return totp.verify(token, valid_window=1)  # Allow 1 window (30 seconds) tolerance

    @staticmethod
    def generate_backup_codes(count: int = 8) -> list:
        """Generate backup codes for 2FA"""
        import secrets
        import string
        
        codes = []
        for _ in range(count):
            code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
            # Format as XXXX-XXXX
            formatted_code = f"{code[:4]}-{code[4:]}"
            codes.append(formatted_code)
        
        return codes

class EmailService:
    @staticmethod
    def send_email(to_email: str, subject: str, body: str, is_html: bool = False):
        """Send email notification"""
        try:
            # Import email modules locally to avoid conflicts
            from email.mime.text import MimeText
            from email.mime.multipart import MimeMultipart
            import smtplib
            
            smtp_server = os.getenv("SMTP_SERVER")
            smtp_port = int(os.getenv("SMTP_PORT", "587"))
            smtp_username = os.getenv("SMTP_USERNAME")
            smtp_password = os.getenv("SMTP_PASSWORD")
            email_from = os.getenv("EMAIL_FROM")

            if not all([smtp_server, smtp_username, smtp_password, email_from]):
                print("Email configuration incomplete. Skipping email send.")
                return False

            msg = MimeMultipart()
            msg['From'] = email_from
            msg['To'] = to_email
            msg['Subject'] = subject

            if is_html:
                msg.attach(MimeText(body, 'html'))
            else:
                msg.attach(MimeText(body, 'plain'))

            server = smtplib.SMTP(smtp_server, smtp_port)
            server.starttls()
            server.login(smtp_username, smtp_password)
            text = msg.as_string()
            server.sendmail(email_from, to_email, text)
            server.quit()
            
            return True
        except Exception as e:
            print(f"Failed to send email: {e}")
            return False

    @staticmethod
    def send_login_notification(user_email: str, user_name: str, ip_address: str):
        """Send login notification email"""
        subject = "ScriptPilot - New Login Detected"
        body = f"""
        Hello {user_name},

        A new login to your ScriptPilot account was detected:

        Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC
        IP Address: {ip_address}

        If this wasn't you, please secure your account immediately.

        Best regards,
        ScriptPilot Security Team
        """
        
        return EmailService.send_email(user_email, subject, body)

class SessionManager:
    @staticmethod
    def store_session(user_id: int, session_data: dict, expire_seconds: int = 1800):
        """Store session data in Redis"""
        if redis_client:
            session_key = f"session:{user_id}"
            redis_client.setex(session_key, expire_seconds, str(session_data))

    @staticmethod
    def get_session(user_id: int) -> Optional[dict]:
        """Get session data from Redis"""
        if redis_client:
            session_key = f"session:{user_id}"
            session_data = redis_client.get(session_key)
            if session_data:
                return eval(session_data)  # Note: Use json.loads in production
        return None

    @staticmethod
    def delete_session(user_id: int):
        """Delete session data"""
        if redis_client:
            session_key = f"session:{user_id}"
            redis_client.delete(session_key)

def get_current_user_from_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency to get current user from JWT token"""
    from app.models import User
    from app.database import get_session
    from sqlmodel import select
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token = credentials.credentials
    
    # Check if token is blacklisted
    if AuthUtils.is_token_blacklisted(token):
        raise credentials_exception
    
    # Verify token
    payload = AuthUtils.verify_token(token, "access")
    if payload is None:
        raise credentials_exception
    
    user_id: int = payload.get("sub")
    if user_id is None:
        raise credentials_exception
    
    # Get user from database
    with get_session() as session:
        user = session.get(User, user_id)
        if user is None:
            raise credentials_exception
        
        # Check if user is active
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled"
            )
        
        return user

def require_role(required_roles: Union[str, list]):
    """Dependency factory to require specific roles"""
    if isinstance(required_roles, str):
        required_roles = [required_roles]
    
    def role_dependency(current_user = Depends(get_current_user_from_token)):
        if current_user.role not in required_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        return current_user
    
    return role_dependency

# Convenience dependencies for common roles
require_admin = require_role("admin")
require_admin_or_editor = require_role(["admin", "editor"])
