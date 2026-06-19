# Antigravity Piper TTS Chatbot

A high-fidelity, offline-first web application featuring a React-Vite frontend (Vercel-ready) and a Python FastAPI backend running the Piper Text-to-Speech (TTS) engine.

## Features

1. **AI Voice Chat**: Talk to a conversational assistant that responds to your questions and automatically speaks back in natural Hindi (or English depending on the prompt).
2. **Text Document TTS Converter**: Upload any `.txt` file, configure the output path, filename, and chunking parameters, and synthesize it into an optimized, space-saving MP3 audio file.
3. **Sleek Glassmorphic Frontend**: Built with React, TypeScript, and Vanilla CSS containing ambient background glowing effects, stylized scrollbars, a dynamic logging console, and customized interactive audio players.
4. **Self-Contained & Offline-Ready**: The Piper acoustic model files (`.onnx` and `.onnx.json`) are copied directly into the project repository, removing absolute path dependencies and enabling completely offline local speech generation.

---

## Folder Structure

```
piper-tts-chatbot/
├── backend/
│   ├── main.py              # FastAPI server routes & Gemini/Local chatbot logic
│   ├── tts_pipeline.py      # Core Piper text chunking & MP3 export pipeline
│   ├── requirements.txt     # Backend python dependencies
│   ├── models/              # Self-contained folder for speech models
│   │   ├── hi_IN-female-medium.onnx
│   │   └── hi_IN-female-medium.onnx.json
│   ├── outputs/             # Server local audio storage (chat/file outputs)
│   └── venv/                # Python Virtual Environment
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx          # Dashboard layout & routing
│   │   ├── App.css          # Core CSS variables & component styles
│   │   ├── index.css        # Global CSS resets & fonts
│   │   └── components/
│   │       ├── ChatSection.tsx      # Chat assistant pane
│   │       └── ConverterSection.tsx # File upload converter pane
└── README.md                # Documentation
```

---

## Local Setup & Running

### Prerequisites
- **Python 3.13+** installed.
- **Node.js** (including `npm`) installed.
- **FFmpeg** installed and configured in your system's `PATH` (necessary for pydub's MP3 exporting).

### 1. Run the Backend
Navigate to the `backend` folder, activate the virtual environment, and start the FastAPI server:

```bash
cd backend

# Activate virtual environment (Windows)
venv\Scripts\activate

# Install dependencies (already installed during setup, but just in case)
pip install -r requirements.txt

# (Optional) Set your Gemini API key to unlock the intelligent AI chatbot
# If not set, the bot will use a local rule-based response engine.
set GEMINI_API_KEY=your_gemini_api_key_here

# Start the server
python main.py
```
The backend server will start on `http://localhost:8000`.

### 2. Run the Frontend
In a new terminal window, navigate to the `frontend` folder, install packages, and start the Vite developer server:

```bash
cd frontend

# Install Node modules
npm install

# Start Vite dev server
npm run dev
```
Open your browser and navigate to `http://localhost:5173`.

---

## Offline Design Details

- **Voice Models**: The system is pre-loaded with the Hindi female voice (`hi_IN-female-medium`). When the backend initializes, it checks the local `./models/` directory for the `.onnx` and `.onnx.json` configuration files, guaranteeing it works entirely offline.
- **Size Optimization**: The backend slices large texts into smaller character chunks (default max 2000 chars) to prevent memory bloating. It synthesizes each chunk separately, merges the resulting WAV files, and converts the final track into a **96kbps Mono MP3** using FFmpeg. This reduces file sizes by over 50% compared to typical stereo WAV exports while maintaining pristine speech quality.

---

## Deployment Guide

### Frontend (Vercel)
The React frontend is fully prepared for Vercel out of the box.
1. Install the Vercel CLI: `npm install -g vercel`
2. Run `vercel` from the `frontend/` directory.
3. Once deployed, copy the production deployment URL.
4. Modify `frontend/src/App.tsx` (or set a build environment variable) to point `backendUrl` to your deployed backend's URL.

### Backend (Render / Heroku / Self-Hosted VM)
You can host the Python backend on services like Render, Fly.io, or any virtual machine:
1. Ensure the platform has **FFmpeg** installed. On Render, you can use the official Python buildpack and add the FFmpeg path or use a custom Dockerfile.
2. In your deployment configuration, set the `GEMINI_API_KEY` environment variable.
3. The backend will automatically handle cloud environments: since paths like `D:\audio` are not writable on cloud Linux servers, FastAPI will gracefully fall back to saving output files inside the local `outputs/file_outputs/` directory and serving them through HTTP endpoints.
