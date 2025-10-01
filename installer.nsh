!macro customPages
  Page custom CustomPageCreate CustomPageLeave
!macroend

Function CustomPageCreate
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ; Add static text
  ${NSD_CreateLabel} 0 0 100% 12u "Choose your configuration:"
  Pop $Label

  ; Add a checkbox example
  ${NSD_CreateCheckBox} 0 20u 100% 12u "Enable Advanced Features"
  Pop $CheckBox

  nsDialogs::Show
FunctionEnd

Function CustomPageLeave
  ${NSD_GetState} $CheckBox $0
  StrCmp $0 1 +2
    ; Checkbox not checked
  ; You can store this in $INSTDIR\config.txt or pass to installer
FunctionEnd
