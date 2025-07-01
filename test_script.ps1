# PowerShell Test Script for ScriptPilot
# This script demonstrates basic PowerShell functionality

Write-Host "=" * 50
Write-Host "ScriptPilot PowerShell Test Script"
Write-Host "=" * 50

Write-Host "Script started at: $(Get-Date)"
Write-Host "PowerShell version: $($PSVersionTable.PSVersion)"
Write-Host "Computer: $env:COMPUTERNAME"
Write-Host "User: $env:USERNAME"

Write-Host "`nProcessing..."
for ($i = 1; $i -le 5; $i++) {
    Write-Host "Step $i/5 - Processing data..."
    Start-Sleep -Milliseconds 500
}

Write-Host "`nGathering system information..."
$systemInfo = @{
    "OS" = (Get-WmiObject Win32_OperatingSystem).Caption
    "Total RAM (GB)" = [math]::Round((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 2)
    "Processor" = (Get-WmiObject Win32_Processor).Name
    "Uptime" = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
}

$systemInfo.GetEnumerator() | ForEach-Object {
    Write-Host "$($_.Key): $($_.Value)"
}

Write-Host "`nTask completed successfully!"
Write-Host "Script finished at: $(Get-Date)"
Write-Host "=" * 50

# Exit with success code
exit 0
