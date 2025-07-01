from sqlmodel import SQLModel, Field
from typing import Optional
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

class Script(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    filename: str
    language: str
    upload_time: datetime = Field(default_factory=datetime.utcnow)
    description: Optional[str] = None

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
    
    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: Optional[str] = None  # Future: user who created it

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
