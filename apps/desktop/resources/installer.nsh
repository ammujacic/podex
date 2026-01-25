; Podex Windows Installer Script (NSIS)
; This file is included by electron-builder during Windows packaging

!macro customInstall
  ; Register podex:// protocol handler
  DetailPrint "Registering podex:// protocol handler..."
  WriteRegStr HKCU "Software\Classes\podex" "" "URL:Podex Protocol"
  WriteRegStr HKCU "Software\Classes\podex" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\podex\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\podex\shell" "" ""
  WriteRegStr HKCU "Software\Classes\podex\shell\open" "" ""
  WriteRegStr HKCU "Software\Classes\podex\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ; Unregister podex:// protocol handler
  DetailPrint "Unregistering podex:// protocol handler..."
  DeleteRegKey HKCU "Software\Classes\podex"
!macroend
