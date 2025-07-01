#!/usr/bin/env python3
"""
Simple test data population script
"""

import requests
import json
import time

# API base URL
BASE_URL = "http://localhost:8000"

def test_upload_scripts():
    """Upload test scripts to the system"""
    print("Testing script upload...")
    
    # Test uploading Python script
    try:
        with open('test_script.py', 'rb') as f:
            files = {'file': ('test_script.py', f, 'text/plain')}
            data = {'description': 'Test Python script for demonstration'}
            response = requests.post(f"{BASE_URL}/upload/", files=files, data=data)
            if response.status_code == 200:
                print("✓ Python script uploaded successfully")
            else:
                print(f"✗ Python script upload failed: {response.text}")
    except Exception as e:
        print(f"✗ Python script upload error: {e}")
    
    # Test uploading PowerShell script
    try:
        with open('test_script.ps1', 'rb') as f:
            files = {'file': ('test_script.ps1', f, 'text/plain')}
            data = {'description': 'Test PowerShell script for system information'}
            response = requests.post(f"{BASE_URL}/upload/", files=files, data=data)
            if response.status_code == 200:
                print("✓ PowerShell script uploaded successfully")
            else:
                print(f"✗ PowerShell script upload failed: {response.text}")
    except Exception as e:
        print(f"✗ PowerShell script upload error: {e}")

def test_api_endpoints():
    """Test various API endpoints"""
    print("\nTesting API endpoints...")
    
    # Test listing scripts
    try:
        response = requests.get(f"{BASE_URL}/scripts/db/")
        if response.status_code == 200:
            scripts = response.json()
            print(f"✓ Found {len(scripts)} scripts in database")
            return scripts
        else:
            print(f"✗ Failed to list scripts: {response.text}")
            return []
    except Exception as e:
        print(f"✗ Error listing scripts: {e}")
        return []

def test_script_execution(scripts):
    """Test executing a script"""
    if not scripts:
        print("No scripts available for execution test")
        return
    
    print("\nTesting script execution...")
    
    # Execute the first Python script
    python_scripts = [s for s in scripts if s['language'] == 'Python']
    if python_scripts:
        script_id = python_scripts[0]['id']
        try:
            response = requests.post(f"{BASE_URL}/scripts/{script_id}/execute/")
            if response.status_code == 200:
                result = response.json()
                print(f"✓ Script executed successfully (exit_code: {result['exit_code']})")
            else:
                print(f"✗ Script execution failed: {response.text}")
        except Exception as e:
            print(f"✗ Script execution error: {e}")
    else:
        print("No Python scripts found for execution test")

def test_schedule_creation(scripts):
    """Test creating a schedule"""
    if not scripts:
        print("No scripts available for schedule test")
        return
    
    print("\nTesting schedule creation...")
    
    script_id = scripts[0]['id']
    from datetime import datetime, timedelta
    
    # Create a schedule for 2 minutes from now
    start_time = datetime.now() + timedelta(minutes=2)
    
    try:
        data = {
            'script_id': script_id,
            'name': 'Test Schedule',
            'schedule_type': 'once',
            'start_time': start_time.strftime('%Y-%m-%dT%H:%M'),
            'max_runs': 1
        }
        
        response = requests.post(f"{BASE_URL}/schedules/", data=data)
        if response.status_code == 200:
            schedule = response.json()
            print(f"✓ Schedule created successfully (ID: {schedule['id']})")
        else:
            print(f"✗ Schedule creation failed: {response.text}")
    except Exception as e:
        print(f"✗ Schedule creation error: {e}")

def test_stats():
    """Test statistics endpoints"""
    print("\nTesting statistics...")
    
    try:
        response = requests.get(f"{BASE_URL}/executions/stats/")
        if response.status_code == 200:
            stats = response.json()
            print(f"✓ Execution stats: {stats['total_executions']} executions, {stats['success_rate']}% success rate")
        else:
            print(f"✗ Failed to get execution stats: {response.text}")
    except Exception as e:
        print(f"✗ Error getting execution stats: {e}")
    
    try:
        response = requests.get(f"{BASE_URL}/schedules/stats/")
        if response.status_code == 200:
            stats = response.json()
            print(f"✓ Schedule stats: {stats['total_schedules']} schedules, {stats['active_schedules']} active")
        else:
            print(f"✗ Failed to get schedule stats: {response.text}")
    except Exception as e:
        print(f"✗ Error getting schedule stats: {e}")

def main():
    print("ScriptPilot API Test Suite")
    print("=" * 40)
    
    # Wait a moment for server to be ready
    time.sleep(2)
    
    # Test uploads
    test_upload_scripts()
    
    # Wait a moment
    time.sleep(1)
    
    # Test API endpoints
    scripts = test_api_endpoints()
    
    # Test execution
    test_script_execution(scripts)
    
    # Wait a moment
    time.sleep(1)
    
    # Test schedules
    test_schedule_creation(scripts)
    
    # Test stats
    test_stats()
    
    print("\n" + "=" * 40)
    print("Test suite completed!")
    print("Visit http://localhost:8000 to see the web interface")

if __name__ == "__main__":
    main()
