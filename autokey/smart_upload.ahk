#Requires AutoHotkey v2.0
#Warn VarUnset, Off

; Path to the file that should be uploaded
filePath := "D:\suno\output\output.mp4"

; Check if the file exists
if !FileExist(filePath) {
    ; Notify user that the file is missing and the API will be called
    MsgBox("File not found. Calling API to generate the video...")

    ; Call local REST API using POST request
    url := "http://localhost:3001/api/create-video"
    
    try {
        ; Create HTTP request object
        http := ComObjCreate("WinHttp.WinHttpRequest.5.1")
        MsgBox("COM object created successfully!")
        
        ; Configure and send the request
        http.Open("POST", url, false)
        http.SetRequestHeader("Content-Type", "application/json")
        
        ; Send request (empty body - adjust if your API needs specific data)
        http.Send("")
        
        ; Check response status
        if (http.Status == 200) {
            MsgBox("API call successful! Status: " . http.Status)
        } else {
            MsgBox("API call failed! Status: " . http.Status . "`nResponse: " . http.ResponseText)
        }
        
    } catch as e {
        MsgBox("Failed to make API request: " . e.Message)
        ; Optionally continue or exit based on your needs
        ; ExitApp
    }

    ; Notify user and wait 3 minutes for the file to be generated
    MsgBox("Waiting 3 minutes for video generation...")
    Sleep(180000) ; 180,000 milliseconds = 3 minutes

    ; Re-check if the file now exists
    if !FileExist(filePath) {
        MsgBox("File still not found after 3 minutes. Exiting script.")
        ExitApp() ; Stop script to prevent further macro actions
    } else {
        MsgBox("File found! Proceeding with upload...")
    }
}

; Wait for the Open dialog to appear (with timeout)
try {
    WinWaitActive("Open", , 10) ; Wait up to 10 seconds
} catch {
    MsgBox("Open dialog not found within 10 seconds. Please ensure the upload dialog is open.")
    ExitApp()
}

; Move and resize the Open dialog window
try {
    WinMove(100, 100, 800, 600, "Open")
} catch {
    ; Window might not be movable, continue anyway
}

; Send the file path and confirm
SendText(filePath)
Sleep(500) ; Small delay to ensure text is entered
Send("{Enter}")

; Optional: Confirm the upload was initiated
MsgBox("File path sent to upload dialog.")