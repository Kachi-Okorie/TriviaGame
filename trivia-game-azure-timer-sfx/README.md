# 6‑Player Trivia (Socket.IO)
Real-time trivia for up to 6 players with first-to-buzz lock and a host dashboard that shows live answers and controls scoring.

## Features
- 6 players join with their name (phones/laptops)
- First buzzer locks out others until host resets
- Multiple-choice questions (A-D)
- Players select answers; host sees them live in real time
- Reveal correct answer with auto-scoring (+10) and buzz bonus (+5 if the first buzzer answered correctly)
- Manual score adjustment by the host
- Previous/Next question navigation
- Reload questions from `data/questions.json` without restarting

## Quick Start
1. Install Node.js 18+
2. In a terminal:
```bash
cd trivia-game
npm install
npm start
```
3. Open these pages:
   - Host dashboard: http://localhost:3000/host
   - Player screen:  http://localhost:3000/player

> Tip: Put the host on a big display. Have up to 6 players join from their devices on the same network.

## Editing Questions
- Edit `data/questions.json`. Format:
```json
[
  {
    "text": "Question text?",
    "options": {"A": "Option A", "B": "Option B", "C": "Option C", "D": "Option D"},
    "correct": "B"
  }
]
```
- On the Host dashboard, click **Reload Questions** to apply changes.

## Game Flow
1. Players join (up to 6).
2. Host clicks **Start Game** (moves to Question 1).
3. Players may:
   - **Buzz**: first click locks buzzer for everyone (visible on host).
   - **Select an answer** (A–D): host sees all answers live.
4. Host clicks **Reveal & Score**:
   - Correct answers are scored automatically (+10).
   - If the **buzzed** player answered correctly, they get a +5 bonus.
5. Host navigates **Next** to continue. Use **Reset Buzz** any time.

## Notes
- Disconnected players remain listed so the host can keep scores; host can remove them by restarting the server or editing code to add a kick button (already available via `host:kick` event from console).
- Security is minimal (intended for friendly games on a LAN). For production, add auth and rooms.


---

## Azure Deployment

### Option A — Azure App Service (fast + supports WebSockets)
Requirements: Azure CLI logged in (`az login`), a resource group, Node 18+

```bash
# Variables
RG=trivia-rg
LOC=australiaeast
APPPLAN=trivia-plan
WEBAPP=trivia-6p-$RANDOM

# Create resources
az group create -n $RG -l $LOC
az appservice plan create -g $RG -n $APPPLAN --sku B1 --is-linux
az webapp create -g $RG -p $APPPLAN -n $WEBAPP --runtime "NODE:20-lts"

# Enable WebSockets (required for Socket.IO)
az webapp config set -g $RG -n $WEBAPP --web-sockets-enabled true

# Zip deploy
zip -r app.zip . -x '*.git*'
az webapp deployment source config-zip -g $RG -n $WEBAPP --src app.zip

echo "Host:   https://$WEBAPP.azurewebsites.net/host"
echo "Player: https://$WEBAPP.azurewebsites.net/player"
```

### Option B — GitHub Actions
1. Push this repo to GitHub (default branch `main`).
2. In Azure Portal, open your Web App → **Get Publish Profile**.
3. In GitHub repo → **Settings → Secrets and variables → Actions**:
   - `AZURE_WEBAPP_NAME` = your app name
   - `AZURE_WEBAPP_PUBLISH_PROFILE` = paste publish profile XML
4. Commit to `main` to trigger the workflow `.github/workflows/deploy.yml`.

### Notes
- This app listens on `process.env.PORT` (used by Azure). No extra config needed.
- If players are on a different domain, ensure CORS and HTTPS are enabled (already default).
- For larger scale or regional redundancy, consider Azure Front Door + multiple Web Apps. New push
