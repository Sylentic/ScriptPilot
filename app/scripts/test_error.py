#!/usr/bin/env python3
"""
Test script that will fail - for testing error logging
"""

print("This script will fail!")

# This will cause a runtime error
result = 1 / 0
print("This line won't be reached")
