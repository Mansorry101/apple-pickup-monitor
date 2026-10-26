' Launch the settings UI in a hidden window (ui-only mode).
' Paths are derived from this script location, so the folder can be moved anywhere.
' NOTE: keep this file ASCII-only - Windows Script Host reads .vbs as ANSI.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
proj = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = proj
' 0 = hidden window, True = wait for it to finish
sh.Run "cmd /c node ""src\index.js"" --ui-only", 0, True
