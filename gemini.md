1. Project Overview
This project is a full-stack security application. It combines a Zero-Trust Intercept Module (hard gating via webcam and geolocation) with a Continuous Behavioral Biometrics System (keystroke and mouse tracking) to authenticate users seamlessly.

2. Technology Stack
Frontend: Vanilla HTML, CSS, JavaScript (No heavy frameworks to ensure tracking performance).

Backend: Node.js with Express.js.

Real-time Communication: Socket.io (for instant admin approval/denial).

Database (Mock/Local): SQLite (for storing user baseline profiles and access logs).

3. Antigravity Agent Instructions (Strict Directives)
Agent, please read this entire document before writing any code. Follow these execution rules:

Planning Mode First: Before writing code, generate an Implementation Plan and a Task List artifact. Wait for my approval before proceeding.

Step-by-Step Execution: Do not attempt to build the entire system at once. Complete the project in the exact "Phases" outlined below.

No Placeholders: Write complete, functional code. Ensure WebRTC (webcam) and Socket.io implementations are robust.

Verification: After completing each phase, use the Antigravity Browser Agent to test the feature and provide a Walkthrough artifact.

4. Implementation Phases
Phase 1: Project Setup & Foundation
Initialize a new Node.js project (npm init -y).

Install dependencies: express, socket.io, sqlite3, cors.

Create the following directory structure:

/public (for frontend HTML/CSS/JS files)

/src (for backend server and logic)

Create a basic server.js file that serves the /public directory and initializes Socket.io.

Phase 2: The Zero-Trust Intercept Module (Frontend & Backend)
Goal: Lock unverified users out until an admin grants permission.

Client (public/index.html & app.js):

Create a full-screen, un-closable CSS overlay (z-index: 9999, backdrop-filter: blur(20px)). Display text: "Pending Admin Approval...".

On page load, immediately trigger navigator.mediaDevices.getUserMedia to capture a single webcam photo (convert to Base64).

Trigger navigator.geolocation to get Latitude and Longitude.

Emit this data via Socket.io to the server using the event request_access.

Listen for access_granted (remove the blur overlay) or access_denied (redirect to a blank "Access Denied" page).

Server (src/server.js):

Listen for request_access. When received, broadcast this data to the Admin Dashboard via a new_access_request event.

Phase 3: The Admin Dashboard
Goal: Allow an admin to review requests in real-time.

Admin UI (public/admin.html & admin.js):

Create a clean UI grid that listens for new_access_request Socket.io events.

Dynamically render incoming requests. Display the Base64 photo, the GPS coordinates, and a timestamp.

Add two buttons to each request: "Allow" (green) and "Deny" (red).

When clicked, emit an admin_decision event back to the server containing the decision and the specific user's socket ID.

Server Logic:

Receive the admin_decision and route the access_granted or access_denied event strictly to the specific user's socket ID.

Phase 4: Behavioral Biometrics Tracker
Goal: Once unlocked, track the user's keystrokes and mouse movements continuously.

Tracker Script (public/tracker.js):

This script should only activate AFTER the access_granted socket event is received.

Keystrokes: Track keydown and keyup. Calculate typing speed (WPM) and key dwell time.

Mouse: Track mousemove (X/Y coordinates), speed of movement, and click events.

Data Packaging: Batch this data into a JSON array and send it to a backend REST API endpoint (POST /api/collect-behavior) every 5 seconds.

Backend Receiver (src/behavior.js):

Create the /api/collect-behavior endpoint.

Implement a mock "Anomaly Detection" function: For this MVP, calculate the average typing speed and mouse speed of the incoming batch. If the typing speed drops to 0 while mouse clicks are excessively high (or any simple mock deviation), flag the session as "Suspicious".

If flagged as Suspicious, emit an alert_high_risk event to the Admin Dashboard via Socket.io.

Phase 5: Final Integration & Testing
Ensure the Admin Dashboard displays live behavioral risk alerts alongside the initial access requests.

Ensure that if an admin clicks "Revoke Access" on the dashboard, the user's screen is immediately blurred again.

Agent: Please execute your internal browser test to verify that the webcam permission prompt appears and that the Socket.io connection successfully communicates between index.html and admin.html.

Understanding how these modules interact is crucial for building the system. Because we added the Zero-Trust Intercept (the webcam/location lock), the system now operates in two distinct phases: **The Entry Gate** and **Continuous Monitoring**.

Here is the step-by-step logical flow of how data moves through your modules.

### **The System Flowchart**

```text
[User] --> (Visits Site) --> [Intercept Module] (Screen Blurs, Captures Photo/GPS)
                                      |
                                  (Socket.io)
                                      v
                               [Admin Dashboard] --> (Admin Clicks 'Allow')
                                      |
                                  (Socket.io)
                                      v
[User] <-- (Screen Unblurs) <-- [Decision Engine] 
  |
  v
[Behavioral Tracker] (Silently logs typing & mouse data)
  |
  |--- (Sends batch every 5 seconds) ---> [Feature Extraction Module]
                                                  |
                                                  v
                                          [Anomaly Detection] (Compares to Baseline)
                                                  |
                                       ___________|___________
                                      |                       |
                               [Normal Match]          [Anomaly Detected]
                                (Do nothing)                  |
                                                              v
                                                      [Admin Dashboard] (Triggers Alert) -> (Admin Revokes)
```

---

### **Phase 1: The Entry Gate (Initial Access)**

1. **The Request:** A user attempts to log in or access the application. 
2. **The Lockout (Intercept Module):** Before the user can even type a password or interact with the page, the frontend immediately overlays a blurred, un-closable screen.
3. **Data Capture:** In the background, the client's browser captures a snapshot from their webcam and requests their GPS location.
4. **The Transmission:** This data (Photo + Location) is instantly transmitted to the Node.js backend via a real-time WebSocket connection (Socket.io).
5. **Admin Decision:** The backend routes this data to the **Admin Dashboard**. The admin reviews the photo and location, then clicks "Allow". 
6. **Access Granted:** The server sends an `access_granted` signal back to the specific user's browser. The blur overlay is removed, and the user can now interact with the system.

---

### **Phase 2: Continuous Monitoring (Behavioral Biometrics)**

1. **Tracking Begins:** The moment the screen unblurs, the **Behavioral Data Collection Module** (`tracker.js`) wakes up. 
2. **Data Harvesting:** As the user types their credentials and navigates the app, the tracker silently records:
   * Key press timestamps (to measure typing speed and pauses).
   * Key hold times (how long a key is depressed).
   * Mouse X/Y coordinates and movement velocity.
   * Click frequencies.
3. **Batching & Sending:** To avoid overwhelming the server, the tracker packages this data into a JSON array and sends it to the backend REST API (`/api/collect-behavior`) every few seconds.
4. **Feature Extraction:** The backend receives the raw data and converts it into measurable metrics (e.g., "Current average typing speed is 65 WPM").
5. **Anomaly Detection (The Decision Engine):** The system compares these current metrics against the user's stored baseline profile. 
   * *Is the typing speed suddenly 20 WPM slower?*
   * *Are the mouse movements erratic compared to their usual smooth scrolls?*
6. **The Verdict:** * **If Normal:** The system does nothing. The user continues working without interruption.
   * **If Suspicious:** The Decision Engine flags the session. It sends a high-risk alert back through Socket.io to the **Admin Dashboard**, allowing the admin to instantly revoke access and re-blur the user's screen.

---


