#!/usr/bin/env python3
"""
Simple test script for ScriptPilot execution
"""

import sys
import datetime

print("Hello from ScriptPilot!")
print(f"Current time: {datetime.datetime.now()}")
print(f"Python version: {sys.version}")
print("Script executed successfully!")

# Test some basic functionality
numbers = [1, 2, 3, 4, 5]
print(f"Sum of {numbers} = {sum(numbers)}")
