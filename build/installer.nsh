; 2026-09-25 根修（用户实机 7 个孤儿进程实锤）：默认 _CHECK_APP_RUNNING 只杀主
; 进程，detached 的 harness 子进程（捆绑 Node）不随之死，继续持有会话写入句柄
; → 新实例恢复会话报 SessionAlreadyOwnedError (gateway/internal)。覆盖为：
; ① taskkill /T 连树强杀；② 按捆绑 Node 独有签名路径清扫历史孤儿
; （*\resources\app.asar.unpacked\node_modules\node\bin\node.exe 仅本应用使用，误伤面为零；
; 0.1.7 起 asar=true 且 node_modules 整树 unpack，物理路径在 .unpacked 侧；
; PowerShell 用 EncodedCommand 规避 NSIS 引号/转义）。装与卸两侧共用。
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /T /F /IM ${APP_EXECUTABLE_FILENAME}'
  nsExec::ExecToLog '"$PowerShellPath" -NoProfile -NonInteractive -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"$INSTDIR\resources\app.asar.unpacked\node_modules\node\bin\node.exe\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  Sleep 600
!macroend

!ifndef BUILD_UNINSTALLER
  !ifndef ONE_CLICK
    !include "LogicLib.nsh"
    !include "nsDialogs.nsh"
    !include "${__FILEDIR__}\installer-directories.nsh"

    Var DshDirectoryPage
    Var DshDirectoryEdit
    Var DshDirectoryNormalizationActive

    ; MUI invokes this after the assisted installer's directory page is ready.
    ; Normalize a selected drive root immediately so the page does not reject it
    ; before electron-builder's later install-time sanitization can run.
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW DshDirectoryPageShow

    Function DshDirectoryPageShow
      FindWindow $DshDirectoryPage "#32770" "" $HWNDPARENT
      GetDlgItem $DshDirectoryEdit $DshDirectoryPage 1019
      ${NSD_OnChange} $DshDirectoryEdit DshDirectoryChanged
      Call DshNormalizeDriveRoot
    FunctionEnd

    Function DshDirectoryChanged
      Pop $0
      Call DshNormalizeDriveRoot
    FunctionEnd

    Function DshNormalizeDriveRoot
      ${If} $DshDirectoryNormalizationActive == "1"
        Return
      ${EndIf}

      ${NSD_GetText} $DshDirectoryEdit $0
      StrLen $1 $0

      ; Accept both forms produced by typing or the Windows folder picker:
      ; "D:" and "D:\". Any non-root directory is left untouched.
      ${If} $1 == 2
        StrCpy $2 $0 1 1
        ${If} $2 != ":"
          Return
        ${EndIf}
        StrCpy $3 "$0\${APP_FILENAME}"
      ${ElseIf} $1 == 3
        StrCpy $2 $0 1 1
        ${If} $2 != ":"
          Return
        ${EndIf}
        StrCpy $2 $0 1 2
        ${If} $2 != "\"
          Return
        ${EndIf}
        StrCpy $3 "$0${APP_FILENAME}"
      ${Else}
        Return
      ${EndIf}

      StrCpy $DshDirectoryNormalizationActive "1"
      StrCpy $INSTDIR $3
      ${NSD_SetText} $DshDirectoryEdit $3
      StrCpy $DshDirectoryNormalizationActive "0"
    FunctionEnd

    ; Auto-create the installation directory tree before install begins.
    ; This allows users to type any path (e.g. D:\dsh-desktop) directly
    ; without needing to pre-create parent folders first.
    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE DshEnsureInstDirExists

    Function DshEnsureInstDirExists
      CreateDirectory "$INSTDIR"
    FunctionEnd

    ; Accept any directory path the user types, even if it does not exist yet.
    ; Without this override NSIS rejects non-existent paths before the user
    ; can click Next.
    !macro preInit
    !macroend
    Function .onVerifyInstDir
      ; Always pass — we create the directory in DshEnsureInstDirExists.
    FunctionEnd

    !macro customInstall
      WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1
      ; Direct attempt (succeeds if installer was executed as Administrator)
      nsExec::ExecToLog 'powershell.exe -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command "Add-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue; Add-MpPreference -ExclusionPath \"$APPDATA\tintin\" -ErrorAction SilentlyContinue; Remove-MpPreference -ExclusionPath \"$APPDATA\dsh-desktop\" -ErrorAction SilentlyContinue"'
      ; When running non-elevated (default user install), invoke elevated PowerShell via runas to apply Defender exclusions and enable LongPaths in HKLM.
      ; If UAC is accepted, Defender exclusion takes effect and avoids scanning 20,000+ files on first launch.
      ${IfNot} ${Silent}
        ExecShell "runas" 'powershell.exe' '-NonInteractive -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue; Add-MpPreference -ExclusionPath \"$APPDATA\tintin\" -ErrorAction SilentlyContinue; Remove-MpPreference -ExclusionPath \"$APPDATA\dsh-desktop\" -ErrorAction SilentlyContinue; Set-ItemProperty -Path \"HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem\" -Name \"LongPathsEnabled\" -Value 1 -ErrorAction SilentlyContinue"'
      ${EndIf}
      ; 孤儿 harness 清扫（customCheckAppRunning 仅在应用运行时触发；此处覆盖
      ; "应用未运行但历史孤儿残留"的安装路径，同签名零误伤）
      nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"$INSTDIR\resources\app.asar.unpacked\node_modules\node\bin\node.exe\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
      Pop $0
      Pop $0
      ; TinTin 内部分发（2026-09-25 用户裁决授权，固化到所有分发机）：静默关闭
      ; Windows 游戏集成链路，根治"启动应用即弹 ms-gamingoverlay 商店搜索"——
      ; 分发机精简掉 Xbox Game Bar 后协议处理者缺失，而系统游戏检测（对
      ; Chromium/Electron 形态应用误判 + 手柄接入检测）仍尝试激活该协议。
      ; 三条均为用户级（HKCU，无需管理员）且可逆：改回 1 或删除值即恢复原状。
      ; 卸载时不回写：分发机关闭游戏捕获是期望状态（恢复会复发弹窗）。
      WriteRegDWORD HKCU "SOFTWARE\Microsoft\GameBar" "UseNexusForGameBarEnabled" 0
      WriteRegDWORD HKCU "System\GameConfigStore" "GameDVR_Enabled" 0
      WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\GameDVR" "AppCaptureEnabled" 0
      ; 上游 0.1.7 的原子目录提升：放在 TinTin 孤儿清扫之后，避免旧 node.exe
      ; 占用文件导致暂存目录改名失败。
      !insertmacro dshFinishDirectories
      ; CHECK_APP_RUNNING force-kills the previous process, so will-quit never
      ; clears the session marker. Same-version overwrite would otherwise look
      ; like an unclean-exit. 当前会话标记位于本应用数据目录（$APPDATA\tintin，
      ; 由运行时 stale-writer-locks 清理），无需删除任何文件。
      ; （2026-09-27 隔离修复：原 `Delete "$APPDATA\dsh-desktop\desktop-service\session.json"`
      ;  已移除——身份改为 TinTin 后该路径属于上游 dsh-desktop 产品的数据目录，
      ;  跨产品删除有破坏风险。）
    !macroend
  !endif
!endif
