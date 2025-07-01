#!/usr/bin/env python3
"""
Test Python Script - Hello World
This is a sample script to test ScriptPilot functionality.
"""

import sys
import time
from datetime import datetime

def main():
    print("=" * 50)
    print("ScriptPilot Test Script")
    print("=" * 50)
    print(f"Script started at: {datetime.now()}")
    print(f"Python version: {sys.version}")
    print(f"Platform: {sys.platform}")
    
    # Simulate some work
    print("\nProcessing...")
    for i in range(1, 6):
        print(f"Step {i}/5 - Processing data...")
        time.sleep(0.5)
    
    print("\nTask completed successfully!")
    print(f"Script finished at: {datetime.now()}")
    print("=" * 50)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
