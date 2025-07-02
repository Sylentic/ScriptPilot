from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import datetime
from enum import Enum

class ScheduleType(str, Enum):
    ONCE = "once"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    CRON = "cron"

class ScheduleStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"

class UserRole(str, Enum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    email: str = Field(index=True, unique=True)
    full_name: Optional[str] = None
    hashed_password: str
    role: UserRole = Field(default=UserRole.VIEWER)
    is_active: bool = Field(default=True)
    is_verified: bool = Field(default=False)
    
    # 2FA Settings
    two_factor_enabled: bool = Field(default=False)
    two_factor_secret: Optional[str] = None
    backup_codes: Optional[str] = None  # JSON string of backup codes
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: Optional[datetime] = None
    
    # Relationships
    scripts: List["Script"] = Relationship(back_populates="owner")
    schedules: List["Schedule"] = Relationship(back_populates="created_by_user")
    executions: List["ExecutionHistory"] = Relationship(back_populates="executed_by_user")
    login_attempts: List["LoginAttempt"] = Relationship(back_populates="user")

class LoginAttempt(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    username: str  # Store username even if user doesn't exist
    ip_address: str
    user_agent: Optional[str] = None
    success: bool
    failure_reason: Optional[str] = None
    attempted_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Relationships
    user: Optional[User] = Relationship(back_populates="login_attempts")

class UserSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    session_token: str = Field(index=True)
    ip_address: str
    user_agent: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime
    is_active: bool = Field(default=True)

class Script(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    filename: str
    language: str
    upload_time: datetime = Field(default_factory=datetime.utcnow)
    description: Optional[str] = None
    
    # Security additions
    owner_id: Optional[int] = Field(default=None, foreign_key="user.id")
    is_public: bool = Field(default=False)  # Whether script can be viewed by all users
    
    # Relationships
    owner: Optional[User] = Relationship(back_populates="scripts")
    schedules: List["Schedule"] = Relationship(back_populates="script")
    executions: List["ExecutionHistory"] = Relationship(back_populates="script")

class Schedule(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    script_id: int = Field(foreign_key="script.id")
    name: str  # User-friendly name for the schedule
    schedule_type: ScheduleType
    status: ScheduleStatus = Field(default=ScheduleStatus.ACTIVE)
    
    # Scheduling parameters
    start_time: datetime  # When to start the schedule
    end_time: Optional[datetime] = None  # When to stop (optional)
    cron_expression: Optional[str] = None  # For complex schedules
    
    # Execution tracking
    next_run: Optional[datetime] = None  # When is the next execution
    last_run: Optional[datetime] = None  # When was the last execution
    run_count: int = Field(default=0)  # How many times has it run
    max_runs: Optional[int] = None  # Maximum number of runs (optional)
    
    # Security additions
    created_by: Optional[int] = Field(default=None, foreign_key="user.id")
    
    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Relationships
    script: Script = Relationship(back_populates="schedules")
    created_by_user: Optional[User] = Relationship(back_populates="schedules")
    executions: List["ExecutionHistory"] = Relationship(back_populates="schedule")

class ExecutionHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    script_id: int = Field(foreign_key="script.id")
    schedule_id: Optional[int] = Field(default=None, foreign_key="schedule.id")  # Link to schedule if scheduled
    filename: str  # Store filename for easier querying
    language: str
    exit_code: int
    execution_time_seconds: float
    stdout: str
    stderr: str
    executed_at: datetime = Field(default_factory=datetime.utcnow)
    success: bool
    error_message: Optional[str] = None  # For execution errors
    triggered_by: str = Field(default="manual")  # "manual" or "schedule"
    
    # Security additions
    executed_by: Optional[int] = Field(default=None, foreign_key="user.id")
    
    # Relationships
    script: Script = Relationship(back_populates="executions")
    schedule: Optional[Schedule] = Relationship(back_populates="executions")
    executed_by_user: Optional[User] = Relationship(back_populates="executions")

class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    action: str  # "create", "update", "delete", "execute", "login", "logout"
    resource_type: str  # "script", "schedule", "user", "system"
    resource_id: Optional[int] = None
    details: Optional[str] = None  # JSON string with additional details
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
