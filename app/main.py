from fastapi import FastAPI, UploadFile, File, HTTPException, Path, Form, Query, Request
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from app.database import create_db_and_tables
from app.models import Script, ExecutionHistory, Schedule, ScheduleType, ScheduleStatus
from app.database import get_session
from sqlmodel import Session
from typing import List
from sqlmodel import select

import os
import shutil
import subprocess
import asyncio
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

app = FastAPI(title="ScriptPilot", description="Automated Script Management & Scheduling Platform")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

# Initialize the background scheduler
scheduler = BackgroundScheduler()
scheduler.start()

@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    # Load existing schedules from database
    load_schedules_from_db()

@app.on_event("shutdown")
def on_shutdown():
    scheduler.shutdown()

# Directory to store uploaded scripts
UPLOAD_DIR = "app/scripts"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def load_schedules_from_db():
    """Load all active schedules from the database and add them to the scheduler"""
    try:
        with get_session() as session:
            active_schedules = session.exec(
                select(Schedule).where(Schedule.status == ScheduleStatus.ACTIVE)
            ).all()
            
            for schedule in active_schedules:
                add_schedule_to_scheduler(schedule)
                
        print(f"Loaded {len(active_schedules)} active schedules from database")
    except Exception as e:
        print(f"Error loading schedules: {e}")

def add_schedule_to_scheduler(schedule: Schedule):
    """Add a schedule to the APScheduler"""
    try:
        # Remove existing job if it exists
        try:
            scheduler.remove_job(f"schedule_{schedule.id}")
        except:
            pass  # Job doesn't exist, that's fine
        
        # Create trigger based on schedule type
        trigger = None
        
        if schedule.schedule_type == ScheduleType.ONCE:
            trigger = DateTrigger(run_date=schedule.start_time)
            
        elif schedule.schedule_type == ScheduleType.DAILY:
            trigger = IntervalTrigger(days=1, start_date=schedule.start_time, end_date=schedule.end_time)
            
        elif schedule.schedule_type == ScheduleType.WEEKLY:
            trigger = IntervalTrigger(weeks=1, start_date=schedule.start_time, end_date=schedule.end_time)
            
        elif schedule.schedule_type == ScheduleType.MONTHLY:
            # Run monthly on the same day of month
            trigger = CronTrigger(
                day=schedule.start_time.day,
                hour=schedule.start_time.hour,
                minute=schedule.start_time.minute,
                start_date=schedule.start_time,
                end_date=schedule.end_time
            )
            
        elif schedule.schedule_type == ScheduleType.CRON and schedule.cron_expression:
            # Parse cron expression
            cron_parts = schedule.cron_expression.split()
            if len(cron_parts) == 5:
                minute, hour, day, month, day_of_week = cron_parts
                trigger = CronTrigger(
                    minute=minute, hour=hour, day=day, 
                    month=month, day_of_week=day_of_week,
                    start_date=schedule.start_time, end_date=schedule.end_time
                )
        
        if trigger:
            scheduler.add_job(
                execute_scheduled_script,
                trigger,
                args=[schedule.id],
                id=f"schedule_{schedule.id}",
                name=f"Schedule: {schedule.name}",
                misfire_grace_time=300  # 5 minutes grace time
            )
            
            # Update next_run time
            with get_session() as session:
                db_schedule = session.get(Schedule, schedule.id)
                if db_schedule:
                    job = scheduler.get_job(f"schedule_{schedule.id}")
                    if job:
                        db_schedule.next_run = job.next_run_time
                        session.commit()
                        
    except Exception as e:
        print(f"Error adding schedule {schedule.id} to scheduler: {e}")

def execute_scheduled_script(schedule_id: int):
    """Execute a script as part of a schedule"""
    try:
        with get_session() as session:
            schedule = session.get(Schedule, schedule_id)
            if not schedule or schedule.status != ScheduleStatus.ACTIVE:
                return
            
            script = session.get(Script, schedule.script_id)
            if not script:
                print(f"Script {schedule.script_id} not found for schedule {schedule_id}")
                return
            
            print(f"Executing scheduled script: {script.filename} (Schedule: {schedule.name})")
            
            # Execute the script
            file_path = os.path.join(UPLOAD_DIR, script.filename)
            if not os.path.exists(file_path):
                print(f"Script file not found: {file_path}")
                return
            
            # Determine command
            file_ext = os.path.splitext(script.filename)[1].lower()
            if file_ext == ".py":
                command = ["python", script.filename]
            elif file_ext == ".ps1":
                command = ["powershell", "-ExecutionPolicy", "Bypass", "-File", script.filename]
            elif file_ext == ".sh":
                command = ["bash", script.filename]
            else:
                print(f"Unsupported script type: {file_ext}")
                return
            
            # Execute
            start_time = datetime.utcnow()
            try:
                result = subprocess.run(
                    command,
                    cwd=UPLOAD_DIR,
                    capture_output=True,
                    text=True,
                    timeout=300.0
                )
                
                execution_time = (datetime.utcnow() - start_time).total_seconds()
                
                # Save execution history
                execution_record = ExecutionHistory(
                    script_id=schedule.script_id,
                    schedule_id=schedule_id,
                    filename=script.filename,
                    language=script.language,
                    exit_code=result.returncode,
                    execution_time_seconds=round(execution_time, 2),
                    stdout=result.stdout,
                    stderr=result.stderr,
                    executed_at=start_time,
                    success=result.returncode == 0,
                    triggered_by="schedule"
                )
                
                session.add(execution_record)
                
                # Update schedule info
                schedule.last_run = start_time
                schedule.run_count += 1
                
                # Check if we've reached max runs
                if schedule.max_runs and schedule.run_count >= schedule.max_runs:
                    schedule.status = ScheduleStatus.COMPLETED
                    scheduler.remove_job(f"schedule_{schedule_id}")
                    print(f"Schedule {schedule.name} completed after {schedule.run_count} runs")
                else:
                    # Update next run time
                    job = scheduler.get_job(f"schedule_{schedule_id}")
                    if job:
                        schedule.next_run = job.next_run_time
                
                session.commit()
                
                print(f"Scheduled execution completed: {script.filename}, exit_code: {result.returncode}")
                
            except subprocess.TimeoutExpired:
                # Handle timeout
                execution_record = ExecutionHistory(
                    script_id=schedule.script_id,
                    schedule_id=schedule_id,
                    filename=script.filename,
                    language=script.language,
                    exit_code=-1,
                    execution_time_seconds=300.0,
                    stdout="",
                    stderr="",
                    executed_at=start_time,
                    success=False,
                    error_message="Script execution timed out (5 minutes maximum)",
                    triggered_by="schedule"
                )
                
                session.add(execution_record)
                schedule.last_run = start_time
                schedule.run_count += 1
                session.commit()
                
                print(f"Scheduled execution timed out: {script.filename}")
                
    except Exception as e:
        print(f"Error executing scheduled script {schedule_id}: {e}")

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Serve the main dashboard HTML page"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/upload/")
async def upload_script(
    file: UploadFile = File(...),
    description: str = Form(default="")
):
    filename = file.filename
    file_ext = os.path.splitext(filename)[1].lower()

    if file_ext not in [".py", ".ps1", ".sh"]:
        raise HTTPException(status_code=400, detail="Unsupported file type.")

    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Determine language
    language_map = {
        ".py": "Python",
        ".ps1": "PowerShell",
        ".sh": "Bash"
    }
    language = language_map.get(file_ext, "Unknown")

    # Save metadata to DB
    with get_session() as session:
        script = Script(filename=filename, language=language, description=description)
        session.add(script)
        session.commit()

    return JSONResponse(content={"message": f"{filename} uploaded and recorded successfully."})

@app.get("/scripts/")
def list_scripts():
    try:
        files = os.listdir(UPLOAD_DIR)
        return {"scripts": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/scripts/db/", response_model=List[Script])
def list_scripts_from_db():
    with get_session() as session:
        scripts = session.exec(select(Script)).all()
        return scripts

@app.get("/scripts/search/", response_model=List[Script])
def search_scripts(
    filename: str = Query(default=None),
    language: str = Query(default=None),
    description: str = Query(default=None)
):
    with get_session() as session:
        query = select(Script)

        if filename:
            query = query.where(Script.filename.contains(filename))
        if language:
            query = query.where(Script.language.contains(language))
        if description:
            query = query.where(Script.description.contains(description))

        results = session.exec(query).all()
        return results

@app.post("/scripts/{script_id}/execute/")
async def execute_script(script_id: int):
    """Execute a script by its database ID"""
    
    # Get script from database
    with get_session() as session:
        script = session.get(Script, script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found in database")
    
    # Check if file exists
    file_path = os.path.join(UPLOAD_DIR, script.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Script file not found on disk")
    
    # Determine the command to run based on file extension
    file_ext = os.path.splitext(script.filename)[1].lower()
    
    if file_ext == ".py":
        command = ["python", script.filename]  # Use just filename since we set cwd
    elif file_ext == ".ps1":
        command = ["powershell", "-ExecutionPolicy", "Bypass", "-File", script.filename]
    elif file_ext == ".sh":
        command = ["bash", script.filename]
    else:
        raise HTTPException(status_code=400, detail="Unsupported script type")
    
    try:
        # Execute the script with timeout
        start_time = datetime.utcnow()
        
        # Run the script with a timeout of 300 seconds (5 minutes)
        # Use subprocess.run for Windows compatibility
        result = subprocess.run(
            command,
            cwd=UPLOAD_DIR,  # Set working directory to scripts folder
            capture_output=True,
            text=True,
            timeout=300.0  # 5 minute timeout
        )
        
        end_time = datetime.utcnow()
        execution_time = (end_time - start_time).total_seconds()
        
        # Create execution history record
        execution_record = ExecutionHistory(
            script_id=script_id,
            filename=script.filename,
            language=script.language,
            exit_code=result.returncode,
            execution_time_seconds=round(execution_time, 2),
            stdout=result.stdout,
            stderr=result.stderr,
            executed_at=start_time,
            success=result.returncode == 0,
            triggered_by="manual"
        )
        
        # Save execution history to database
        with get_session() as session:
            session.add(execution_record)
            session.commit()
            session.refresh(execution_record)
        
        return {
            "execution_id": execution_record.id,
            "script_id": script_id,
            "filename": script.filename,
            "language": script.language,
            "exit_code": result.returncode,
            "execution_time_seconds": round(execution_time, 2),
            "stdout": result.stdout,
            "stderr": result.stderr,
            "executed_at": start_time.isoformat(),
            "success": result.returncode == 0
        }
        
    except subprocess.TimeoutExpired:
        # Save timeout execution to history
        execution_record = ExecutionHistory(
            script_id=script_id,
            filename=script.filename,
            language=script.language,
            exit_code=-1,  # Special code for timeout
            execution_time_seconds=300.0,  # Max timeout
            stdout="",
            stderr="",
            executed_at=start_time,
            success=False,
            error_message="Script execution timed out (5 minutes maximum)",
            triggered_by="manual"
        )
        
        with get_session() as session:
            session.add(execution_record)
            session.commit()
        
        raise HTTPException(
            status_code=408, 
            detail="Script execution timed out (5 minutes maximum)"
        )
    except FileNotFoundError:
        # Save interpreter not found to history
        execution_record = ExecutionHistory(
            script_id=script_id,
            filename=script.filename,
            language=script.language,
            exit_code=-2,  # Special code for missing interpreter
            execution_time_seconds=0.0,
            stdout="",
            stderr="",
            executed_at=start_time,
            success=False,
            error_message=f"Required interpreter not found for {script.language} scripts",
            triggered_by="manual"
        )
        
        with get_session() as session:
            session.add(execution_record)
            session.commit()
        
        raise HTTPException(
            status_code=500, 
            detail=f"Required interpreter not found for {script.language} scripts"
        )
    except Exception as e:
        import traceback
        error_details = f"Execution failed: {str(e)}\nTraceback: {traceback.format_exc()}"
        
        # Save general execution error to history
        execution_record = ExecutionHistory(
            script_id=script_id,
            filename=script.filename,
            language=script.language,
            exit_code=-3,  # Special code for general errors
            execution_time_seconds=0.0,
            stdout="",
            stderr="",
            executed_at=start_time,
            success=False,
            error_message=error_details,
            triggered_by="manual"
        )
        
        with get_session() as session:
            session.add(execution_record)
            session.commit()
        
        raise HTTPException(
            status_code=500, 
            detail=error_details
        )

@app.post("/scripts/execute/{filename}")
async def execute_script_by_filename(filename: str):
    """Execute a script by its filename"""
    
    # Get script from database
    with get_session() as session:
        script = session.exec(
            select(Script).where(Script.filename == filename)
        ).first()
        
        if not script:
            raise HTTPException(status_code=404, detail="Script not found in database")
    
    # Delegate to the main execution function
    return await execute_script(script.id)

@app.get("/executions/", response_model=List[ExecutionHistory])
def list_execution_history(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    script_id: int = Query(default=None),
    success: bool = Query(default=None),
    filename: str = Query(default=None)
):
    """Get execution history with optional filtering and pagination"""
    
    with get_session() as session:
        query = select(ExecutionHistory).order_by(ExecutionHistory.executed_at.desc())
        
        # Apply filters
        if script_id is not None:
            query = query.where(ExecutionHistory.script_id == script_id)
        if success is not None:
            query = query.where(ExecutionHistory.success == success)
        if filename:
            query = query.where(ExecutionHistory.filename.contains(filename))
        
        # Apply pagination
        query = query.offset(offset).limit(limit)
        
        executions = session.exec(query).all()
        return executions

@app.get("/executions/{execution_id}", response_model=ExecutionHistory)
def get_execution_details(execution_id: int):
    """Get detailed information about a specific execution"""
    
    with get_session() as session:
        execution = session.get(ExecutionHistory, execution_id)
        if not execution:
            raise HTTPException(status_code=404, detail="Execution not found")
        return execution

@app.get("/scripts/{script_id}/executions/", response_model=List[ExecutionHistory])
def get_script_execution_history(
    script_id: int,
    limit: int = Query(default=20, le=100)
):
    """Get execution history for a specific script"""
    
    with get_session() as session:
        # Verify script exists
        script = session.get(Script, script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")
        
        # Get executions for this script
        query = select(ExecutionHistory).where(
            ExecutionHistory.script_id == script_id
        ).order_by(ExecutionHistory.executed_at.desc()).limit(limit)
        
        executions = session.exec(query).all()
        return executions

@app.get("/executions/stats/")
def get_execution_statistics():
    """Get overall execution statistics"""
    
    with get_session() as session:
        # Total executions
        total_executions = session.exec(
            select(ExecutionHistory).where(ExecutionHistory.id.isnot(None))
        ).all()
        
        total_count = len(total_executions)
        successful_count = len([e for e in total_executions if e.success])
        failed_count = total_count - successful_count
        
        # Average execution time
        avg_execution_time = 0.0
        if total_executions:
            avg_execution_time = sum(e.execution_time_seconds for e in total_executions) / total_count
        
        # Most executed scripts
        script_execution_counts = {}
        for execution in total_executions:
            script_execution_counts[execution.filename] = script_execution_counts.get(execution.filename, 0) + 1
        
        most_executed = sorted(script_execution_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        
        return {
            "total_executions": total_count,
            "successful_executions": successful_count,
            "failed_executions": failed_count,
            "success_rate": round((successful_count / total_count * 100) if total_count > 0 else 0, 2),
            "average_execution_time_seconds": round(avg_execution_time, 2),
            "most_executed_scripts": [{"filename": filename, "count": count} for filename, count in most_executed]
        }

# ===== SCHEDULE MANAGEMENT ENDPOINTS =====

@app.post("/schedules/", response_model=Schedule)
def create_schedule(
    script_id: int = Form(...),
    name: str = Form(...),
    schedule_type: ScheduleType = Form(...),
    start_time: datetime = Form(...),
    end_time: datetime = Form(default=None),
    cron_expression: str = Form(default=None),
    max_runs: int = Form(default=None)
):
    """Create a new schedule for a script"""
    
    # Verify script exists
    with get_session() as session:
        script = session.get(Script, script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")
        
        # Create schedule
        schedule = Schedule(
            script_id=script_id,
            name=name,
            schedule_type=schedule_type,
            start_time=start_time,
            end_time=end_time,
            cron_expression=cron_expression,
            max_runs=max_runs,
            status=ScheduleStatus.ACTIVE
        )
        
        session.add(schedule)
        session.commit()
        session.refresh(schedule)
        
        # Add to scheduler
        add_schedule_to_scheduler(schedule)
        
        return schedule

@app.get("/schedules/", response_model=List[Schedule])
def list_schedules(
    status: ScheduleStatus = Query(default=None),
    script_id: int = Query(default=None),
    limit: int = Query(default=50, le=200)
):
    """List all schedules with optional filtering"""
    
    with get_session() as session:
        query = select(Schedule).order_by(Schedule.created_at.desc())
        
        if status:
            query = query.where(Schedule.status == status)
        if script_id:
            query = query.where(Schedule.script_id == script_id)
            
        query = query.limit(limit)
        schedules = session.exec(query).all()
        return schedules

@app.get("/schedules/{schedule_id}", response_model=Schedule)
def get_schedule(schedule_id: int):
    """Get a specific schedule by ID"""
    
    with get_session() as session:
        schedule = session.get(Schedule, schedule_id)
        if not schedule:
            raise HTTPException(status_code=404, detail="Schedule not found")
        return schedule

@app.put("/schedules/{schedule_id}/status/")
def update_schedule_status(schedule_id: int, status: ScheduleStatus = Form(...)):
    """Update the status of a schedule (pause, resume, etc.)"""
    
    with get_session() as session:
        schedule = session.get(Schedule, schedule_id)
        if not schedule:
            raise HTTPException(status_code=404, detail="Schedule not found")
        
        old_status = schedule.status
        schedule.status = status
        schedule.updated_at = datetime.utcnow()
        
        # Handle scheduler changes
        if status == ScheduleStatus.ACTIVE and old_status != ScheduleStatus.ACTIVE:
            # Resume/activate schedule
            add_schedule_to_scheduler(schedule)
        elif status != ScheduleStatus.ACTIVE and old_status == ScheduleStatus.ACTIVE:
            # Pause/deactivate schedule
            try:
                scheduler.remove_job(f"schedule_{schedule_id}")
            except:
                pass  # Job might not exist
        
        session.commit()
        
        return {"message": f"Schedule status updated to {status}", "schedule_id": schedule_id}

@app.delete("/schedules/{schedule_id}")
def delete_schedule(schedule_id: int):
    """Delete a schedule"""
    
    with get_session() as session:
        schedule = session.get(Schedule, schedule_id)
        if not schedule:
            raise HTTPException(status_code=404, detail="Schedule not found")
        
        # Remove from scheduler
        try:
            scheduler.remove_job(f"schedule_{schedule_id}")
        except:
            pass  # Job might not exist
        
        session.delete(schedule)
        session.commit()
        
        return {"message": f"Schedule {schedule_id} deleted successfully"}

@app.post("/schedules/{schedule_id}/run-now/")
def run_schedule_now(schedule_id: int):
    """Manually trigger a scheduled script to run immediately"""
    
    with get_session() as session:
        schedule = session.get(Schedule, schedule_id)
        if not schedule:
            raise HTTPException(status_code=404, detail="Schedule not found")
        
        # Execute the scheduled script in the background
        try:
            execute_scheduled_script(schedule_id)
            return {"message": f"Schedule '{schedule.name}' executed successfully"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to execute schedule: {str(e)}")

@app.get("/schedules/stats/")
def get_schedule_statistics():
    """Get scheduling statistics"""
    
    with get_session() as session:
        all_schedules = session.exec(select(Schedule)).all()
        
        total_schedules = len(all_schedules)
        active_schedules = len([s for s in all_schedules if s.status == ScheduleStatus.ACTIVE])
        paused_schedules = len([s for s in all_schedules if s.status == ScheduleStatus.PAUSED])
        completed_schedules = len([s for s in all_schedules if s.status == ScheduleStatus.COMPLETED])
        
        # Get scheduled executions
        scheduled_executions = session.exec(
            select(ExecutionHistory).where(ExecutionHistory.triggered_by == "schedule")
        ).all()
        
        total_scheduled_runs = len(scheduled_executions)
        successful_scheduled_runs = len([e for e in scheduled_executions if e.success])
        
        # Upcoming executions (next 24 hours)
        upcoming_jobs = []
        from datetime import timezone
        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(hours=24)
        
        for job in scheduler.get_jobs():
            if job.next_run_time and job.next_run_time <= cutoff:
                upcoming_jobs.append({
                    "schedule_id": job.id.replace("schedule_", ""),
                    "name": job.name,
                    "next_run": job.next_run_time.isoformat()
                })
        
        return {
            "total_schedules": total_schedules,
            "active_schedules": active_schedules,
            "paused_schedules": paused_schedules,
            "completed_schedules": completed_schedules,
            "total_scheduled_executions": total_scheduled_runs,
            "successful_scheduled_executions": successful_scheduled_runs,
            "scheduled_success_rate": round((successful_scheduled_runs / total_scheduled_runs * 100) if total_scheduled_runs > 0 else 0, 2),
            "upcoming_executions_24h": len(upcoming_jobs),
            "upcoming_executions": upcoming_jobs[:10]  # Show next 10
        }

# Add this endpoint after the existing script endpoints

@app.get("/scripts/{script_id}/content")
async def get_script_content(script_id: int):
    """Get script content for editing"""
    try:
        with get_session() as session:
            script = session.get(Script, script_id)
            if not script:
                raise HTTPException(status_code=404, detail="Script not found")
            
            # Read the actual file content
            file_path = os.path.join(UPLOAD_DIR, script.filename)
            if not os.path.exists(file_path):
                raise HTTPException(status_code=404, detail="Script file not found")
            
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            return {
                "id": script.id,
                "filename": script.filename,
                "language": script.language,
                "description": script.description,
                "content": content,
                "created_at": script.upload_time,
                "updated_at": script.upload_time
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading script: {str(e)}")

@app.put("/scripts/{script_id}/content")
async def update_script_content(script_id: int, content_data: dict):
    """Update script content"""
    try:
        with get_session() as session:
            script = session.get(Script, script_id)
            if not script:
                raise HTTPException(status_code=404, detail="Script not found")
            
            # Update the actual file content
            file_path = os.path.join(UPLOAD_DIR, script.filename)
            if not os.path.exists(file_path):
                raise HTTPException(status_code=404, detail="Script file not found")
            
            # Write the new content to the file
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content_data.get('content', ''))
            
            # Update description if provided
            if 'description' in content_data:
                script.description = content_data['description']
                session.commit()
            
            return {
                "message": "Script content updated successfully",
                "script_id": script_id,
                "filename": script.filename,
                "updated_at": datetime.utcnow()
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating script: {str(e)}")

@app.delete("/scripts/{script_id}")
async def delete_script(script_id: int):
    """Delete a script and its associated file"""
    try:
        with get_session() as session:
            script = session.get(Script, script_id)
            if not script:
                raise HTTPException(status_code=404, detail="Script not found")
            
            # Delete the actual file
            file_path = os.path.join(UPLOAD_DIR, script.filename)
            if os.path.exists(file_path):
                os.remove(file_path)
            
            # Delete from database
            session.delete(script)
            session.commit()
            
            return {
                "message": "Script deleted successfully",
                "script_id": script_id,
                "filename": script.filename
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting script: {str(e)}")
