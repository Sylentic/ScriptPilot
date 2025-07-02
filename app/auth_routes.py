from fastapi import APIRouter, HTTPException, status, Depends, Request, Form
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
from sqlmodel import Session, select
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
import json

from app.database import get_db_session
from app.models import User, LoginAttempt, UserSession, AuditLog, UserRole
from app.auth import (
    AuthUtils, TwoFactorAuth, EmailService, SessionManager,
    get_current_user_from_token, require_admin, require_admin_or_editor
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Pydantic models for requests/responses
class UserCreate(BaseModel):
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    password: str
    role: UserRole = UserRole.VIEWER

class UserLogin(BaseModel):
    username: str
    password: str
    totp_code: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    full_name: Optional[str]
    role: UserRole
    is_active: bool
    is_verified: bool
    two_factor_enabled: bool
    created_at: datetime
    last_login: Optional[datetime]

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    user: UserResponse

class TwoFactorSetupResponse(BaseModel):
    secret: str
    qr_code: str
    backup_codes: list

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class PasswordReset(BaseModel):
    email: EmailStr

def get_client_ip(request: Request) -> str:
    """Get client IP address"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host

def log_login_attempt(session: Session, username: str, ip_address: str, 
                     user_agent: str, success: bool, user_id: int = None, 
                     failure_reason: str = None):
    """Log login attempt"""
    attempt = LoginAttempt(
        user_id=user_id,
        username=username,
        ip_address=ip_address,
        user_agent=user_agent,
        success=success,
        failure_reason=failure_reason
    )
    session.add(attempt)
    session.commit()

def create_audit_log(session: Session, user_id: int, action: str, 
                    resource_type: str, resource_id: int = None, 
                    details: str = None, ip_address: str = None, 
                    user_agent: str = None):
    """Create audit log entry"""
    log = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
        ip_address=ip_address,
        user_agent=user_agent
    )
    session.add(log)
    session.commit()

@router.post("/register", response_model=UserResponse)
async def register_user(
    user_data: UserCreate,
    request: Request,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin)  # Only admins can create users
):
    """Register a new user (Admin only)"""
    
    # Check if username already exists
    existing_user = session.exec(
        select(User).where(User.username == user_data.username)
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Check if email already exists
    existing_email = session.exec(
        select(User).where(User.email == user_data.email)
    ).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create user
    hashed_password = AuthUtils.get_password_hash(user_data.password)
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        full_name=user_data.full_name,
        hashed_password=hashed_password,
        role=user_data.role,
        is_verified=True  # Auto-verify admin-created users
    )
    
    session.add(new_user)
    session.commit()
    session.refresh(new_user)
    
    # Create audit log
    create_audit_log(
        session, current_user.id, "create", "user", new_user.id,
        f"Created user {new_user.username} with role {new_user.role}",
        get_client_ip(request), request.headers.get("User-Agent")
    )
    
    return new_user

@router.post("/login", response_model=TokenResponse)
async def login(
    user_data: UserLogin,
    request: Request,
    session: Session = Depends(get_db_session)
):
    """User login with optional 2FA"""
    try:
        print(f"Login attempt for user: {user_data.username}")  # Debug log
        ip_address = get_client_ip(request)
        user_agent = request.headers.get("User-Agent", "")
        
        # Get user
        user = session.exec(
            select(User).where(User.username == user_data.username)
        ).first()
        
        if not user or not AuthUtils.verify_password(user_data.password, user.hashed_password):
            log_login_attempt(session, user_data.username, ip_address, user_agent, 
                             False, None, "Invalid credentials")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password"
            )
        
        if not user.is_active:
            log_login_attempt(session, user_data.username, ip_address, user_agent, 
                             False, user.id, "Account disabled")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled"
            )
        
        # Check 2FA if enabled
        if user.two_factor_enabled:
            if not user_data.totp_code:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="2FA code required"
                )
            
            # Verify TOTP code
            if not TwoFactorAuth.verify_totp(user.two_factor_secret, user_data.totp_code):
                # Check backup codes
                backup_codes = json.loads(user.backup_codes) if user.backup_codes else []
                if user_data.totp_code in backup_codes:
                    # Remove used backup code
                    backup_codes.remove(user_data.totp_code)
                    user.backup_codes = json.dumps(backup_codes)
                    session.commit()
                else:
                    log_login_attempt(session, user_data.username, ip_address, user_agent, 
                                     False, user.id, "Invalid 2FA code")
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid 2FA code"
                    )
        
        # Update last login
        user.last_login = datetime.utcnow()
        session.commit()
        
        # Create tokens
        access_token = AuthUtils.create_access_token(data={"sub": str(user.id)})
        refresh_token = AuthUtils.create_refresh_token(data={"sub": str(user.id)})
        
        # Log successful login
        log_login_attempt(session, user_data.username, ip_address, user_agent, True, user.id)
        
        # Create audit log
        create_audit_log(
            session, user.id, "login", "user", user.id,
            f"User {user.username} logged in",
            ip_address, user_agent
        )
        
        # Send login notification email (temporarily disabled for testing)
        # EmailService.send_login_notification(user.email, user.username, ip_address)
        
        # Convert User to UserResponse
        user_response = UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active,
            is_verified=user.is_verified,
            two_factor_enabled=user.two_factor_enabled,
            created_at=user.created_at,
            last_login=user.last_login
        )
        
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            user=user_response
        )
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        print(f"Login error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during login"
        )

@router.post("/logout")
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_db_session)
):
    """User logout"""
    # Get token from header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        # Blacklist the token
        AuthUtils.blacklist_token(token)
    
    # Delete session
    SessionManager.delete_session(current_user.id)
    
    # Create audit log
    create_audit_log(
        session, current_user.id, "logout", "user", current_user.id,
        f"User {current_user.username} logged out",
        get_client_ip(request), request.headers.get("User-Agent")
    )
    
    return {"message": "Successfully logged out"}

@router.get("/me", response_model=UserResponse)
async def get_current_user(current_user: User = Depends(get_current_user_from_token)):
    """Get current user information"""
    return current_user

@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
async def setup_2fa(
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_db_session)
):
    """Setup 2FA for current user"""
    if current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is already enabled"
        )
    
    # Generate secret and QR code
    secret = TwoFactorAuth.generate_secret()
    qr_code = TwoFactorAuth.generate_qr_code(secret, current_user.username)
    backup_codes = TwoFactorAuth.generate_backup_codes()
    
    # Store secret (not yet enabled)
    current_user.two_factor_secret = secret
    current_user.backup_codes = json.dumps(backup_codes)
    session.commit()
    
    return TwoFactorSetupResponse(
        secret=secret,
        qr_code=qr_code,
        backup_codes=backup_codes
    )

@router.post("/2fa/enable")
async def enable_2fa(
    totp_code: str = Form(...),
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_db_session)
):
    """Enable 2FA after verifying setup"""
    if current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is already enabled"
        )
    
    if not current_user.two_factor_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA setup not completed"
        )
    
    # Verify TOTP code
    if not TwoFactorAuth.verify_totp(current_user.two_factor_secret, totp_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid 2FA code"
        )
    
    # Enable 2FA
    current_user.two_factor_enabled = True
    session.commit()
    
    # Create audit log
    create_audit_log(
        session, current_user.id, "enable_2fa", "user", current_user.id,
        f"User {current_user.username} enabled 2FA"
    )
    
    return {"message": "2FA enabled successfully"}

@router.post("/2fa/disable")
async def disable_2fa(
    password: str = Form(...),
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_db_session)
):
    """Disable 2FA"""
    if not current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled"
        )
    
    # Verify password
    if not AuthUtils.verify_password(password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password"
        )
    
    # Disable 2FA
    current_user.two_factor_enabled = False
    current_user.two_factor_secret = None
    current_user.backup_codes = None
    session.commit()
    
    # Create audit log
    create_audit_log(
        session, current_user.id, "disable_2fa", "user", current_user.id,
        f"User {current_user.username} disabled 2FA"
    )
    
    return {"message": "2FA disabled successfully"}

@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_db_session)
):
    """Change user password"""
    # Verify current password
    if not AuthUtils.verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid current password"
        )
    
    # Update password
    current_user.hashed_password = AuthUtils.get_password_hash(password_data.new_password)
    current_user.updated_at = datetime.utcnow()
    session.commit()
    
    # Create audit log
    create_audit_log(
        session, current_user.id, "change_password", "user", current_user.id,
        f"User {current_user.username} changed password"
    )
    
    return {"message": "Password changed successfully"}

@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: User = Depends(require_admin),
    session: Session = Depends(get_db_session)
):
    """List all users (Admin only)"""
    users = session.exec(select(User)).all()
    return users

@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: int,
    new_role: UserRole,
    current_user: User = Depends(require_admin),
    session: Session = Depends(get_db_session)
):
    """Update user role (Admin only)"""
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    old_role = user.role
    user.role = new_role
    user.updated_at = datetime.utcnow()
    session.commit()
    
    # Create audit log
    create_audit_log(
        session, current_user.id, "update_role", "user", user_id,
        f"Changed role from {old_role} to {new_role} for user {user.username}"
    )
    
    return {"message": f"User role updated to {new_role}"}

@router.put("/users/{user_id}/status")
async def update_user_status(
    user_id: int,
    is_active: bool,
    current_user: User = Depends(require_admin),
    session: Session = Depends(get_db_session)
):
    """Activate/deactivate user (Admin only)"""
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Don't allow deactivating the last admin
    if not is_active and user.role == UserRole.ADMIN:
        admin_count = session.exec(
            select(User).where(User.role == UserRole.ADMIN, User.is_active == True)
        ).all()
        if len(admin_count) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate the last admin user"
            )
    
    user.is_active = is_active
    user.updated_at = datetime.utcnow()
    session.commit()
    
    # Create audit log
    action = "activate" if is_active else "deactivate"
    create_audit_log(
        session, current_user.id, action, "user", user_id,
        f"{action.capitalize()}d user {user.username}"
    )
    
    return {"message": f"User {'activated' if is_active else 'deactivated'}"}

@router.get("/audit-logs")
async def get_audit_logs(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(require_admin),
    session: Session = Depends(get_db_session)
):
    """Get audit logs (Admin only)"""
    logs = session.exec(
        select(AuditLog)
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    
    return logs

