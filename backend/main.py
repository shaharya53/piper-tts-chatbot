import os
import sys
import logging
import json
import urllib.request
import urllib.parse
import uuid
import time
import wave
import multiprocessing
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Import our pipeline helpers & modules
from tts_pipeline import split_text, extract_pcm, get_clean_filename
from pydub import AudioSegment
import onnxruntime
from piper.config import PiperConfig
from piper.voice import PiperVoice
from piper.phonemize_espeak import ESPEAK_DATA_DIR

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(title="Piper TTS Chatbot Server")

# Enable CORS for live environments (Frontend Vercel + Backend cloud server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
OUTPUTS_DIR = os.path.join(BASE_DIR, "outputs")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# Mount internal outputs
app.mount("/static/audio", StaticFiles(directory=OUTPUTS_DIR), name="static_audio")

# Default voice model
DEFAULT_VOICE = "hi_IN-female-medium.onnx"

# Global jobs store
JOBS = {}
JOBS_DB_PATH = os.path.join(OUTPUTS_DIR, "jobs_db.json")

def save_jobs():
    try:
        # Create a shallow copy to prevent writing volatile thread-specific properties (like raw thread handles)
        # and keep the dump operation simple
        with open(JOBS_DB_PATH, "w", encoding="utf-8") as f:
            json.dump(JOBS, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Error saving jobs database: {e}")

def load_jobs():
    global JOBS
    if os.path.exists(JOBS_DB_PATH):
        try:
            with open(JOBS_DB_PATH, "r", encoding="utf-8") as f:
                JOBS = json.load(f)
            # Mark previously running/paused tasks as failed since server crashed/restarted
            dirty = False
            for job_id, job in JOBS.items():
                if job.get("status") in ["processing", "paused"]:
                    job["status"] = "failed"
                    job["error"] = "Server restarted or went offline during conversion."
                    job["logs"].append(f"[ERROR] Server went offline. Job interrupted.")
                    dirty = True
            if dirty:
                save_jobs()
        except Exception as e:
            logger.error(f"Error loading jobs database: {e}")
            JOBS = {}
    else:
        JOBS = {}

load_jobs()

# Cached voice instances
_VOICE_CACHE = {}

class ChatRequest(BaseModel):
    message: str
    voice: str = None

def load_voice_optimized(model_path: str, config_path: str = None) -> PiperVoice:
    """Instantiates an InferenceSession with optimized CPU multi-threading session options."""
    abs_model_path = os.path.abspath(model_path)
    if abs_model_path in _VOICE_CACHE:
        return _VOICE_CACHE[abs_model_path]

    if config_path is None:
        config_path = f"{abs_model_path}.json"
        
    if not os.path.exists(abs_model_path):
        raise FileNotFoundError(f"Model file not found at: {abs_model_path}")
        
    logger.info(f"Instantiating optimized ONNX session for: {abs_model_path}")
    with open(config_path, "r", encoding="utf-8") as config_file:
        config_dict = json.load(config_file)
        
    # session options for CPU speed optimization
    sess_options = onnxruntime.SessionOptions()
    sess_options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
    
    # Restrict thread pools to 1 in cloud container environments (avoids CPU limit freezes/crashes)
    sess_options.intra_op_num_threads = 1
    sess_options.inter_op_num_threads = 1
    sess_options.execution_mode = onnxruntime.ExecutionMode.ORT_SEQUENTIAL
    
    providers = ["CPUExecutionProvider"]
    
    session = onnxruntime.InferenceSession(
        str(abs_model_path),
        sess_options=sess_options,
        providers=providers,
    )
    
    voice = PiperVoice(
        config=PiperConfig.from_dict(config_dict),
        session=session,
        espeak_data_dir=Path(ESPEAK_DATA_DIR),
        download_dir=Path(os.path.dirname(abs_model_path)),
    )
    _VOICE_CACHE[abs_model_path] = voice
    return voice

def call_gemini_api(prompt: str) -> str:
    """Calls Google Gemini API using urllib.request (zero external dependencies)."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.info("GEMINI_API_KEY not found in environment. Using fallback chatbot engine.")
        return get_fallback_response(prompt)
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    payload = {
        "contents": [{
            "parts": [{
                "text": (
                    "You are a helpful and polite Indian voice assistant. "
                    "Keep your responses short, conversational, and natural (max 2-3 sentences). "
                    "Prefer responding in clean Hindi language (written in Devnagari script) since the user "
                    "is using a Hindi voice model, but respond in English if they ask in English. "
                    f"User message: {prompt}"
                )
            }]
        }]
    }
    
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            candidates = res_data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "").strip()
            return "माफ़ कीजिये, मैं समझ नहीं पाई। क्या आप दोबारा कह सकते हैं?"
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return "नमस्ते! सर्वर कनेक्शन में कुछ समस्या है, पर मैं आपकी सहायता के लिए तैयार हूँ।"

def get_fallback_response(prompt: str) -> str:
    """Rule-based responses in Hindi and English when Gemini API key is missing."""
    p = prompt.lower()
    
    if any(x in p for x in ["hello", "hi", "नमस्ते", "हैलो"]):
        return "नमस्ते! मैं आपकी क्या सहायता कर सकती हूँ? आप कोई भी टेक्स्ट फ़ाइल अपलोड करके उसे आवाज़ में बदल सकते हैं।"
    elif any(x in p for x in ["नाम", "नाम क्या है", "who are you", "your name"]):
        return "मैं आपका व्यक्तिगत पिपर टीटीएस सहायक हूँ। मैं आपके लिखे हुए शब्दों को सुंदर आवाज़ में बदल सकती हूँ।"
    elif any(x in p for x in ["कैसे हो", "how are you"]):
        return "मैं बिल्कुल ठीक हूँ, धन्यवाद! आशा है आप भी अच्छे होंगे। आज हम कौन सा टेक्स्ट सुनें?"
    elif any(x in p for x in ["काम", "क्या कर सकते", "help", "features", "मदद"]):
        return "मैं आपके संदेशों को पढ़ सकती हूँ और आपके द्वारा अपलोड की गई टेक्स्ट फ़ाइलों को एमपी 3 ऑडियो में बदल सकती हूँ।"
    else:
        return (
            f"आपके संदेश '{prompt[:20]}...' के लिए धन्यवाद! "
            "अगर आप मुझसे और बुद्धिमान बातें करना चाहते हैं, तो कृपया बैकएंड में जेमिनी एपीआई की (GEMINI_API_KEY) सेट करें। "
            "तब तक, आप फ़ाइल कनवर्टर का उपयोग करके किसी भी पाठ को आवाज़ में बदल सकते हैं!"
        )

# Background Synthesis Task Loop
def run_synthesis_job(
    job_id: str,
    text: str,
    voice_path: str,
    chunks_dir: str,
    target_output_dir: str,
    filename_base: str,
    max_chars: int,
    use_custom_path: bool
):
    """Background task with pause/resume loops, user cancellation checks, and MP3 compilation."""
    job = JOBS[job_id]
    job["logs"].append(f"[INFO] [{time.strftime('%X')}] Reading document...")
    
    chunk_files = []
    try:
        # Split text into chunks
        chunks = split_text(text, max_chars)
        total_chunks = len(chunks)
        job["totalChunks"] = total_chunks
        job["logs"].append(f"[INFO] [{time.strftime('%X')}] Text sliced into {total_chunks} chunks.")
        
        # Load optimized voice
        voice = load_voice_optimized(voice_path)
        
        for i, chunk_text in enumerate(chunks):
            # Pause verification loop
            while job["status"] == "paused":
                time.sleep(0.2)
                
            # Cancellation verification check
            if job["status"] == "cancelled":
                job["logs"].append(f"[WARNING] [{time.strftime('%X')}] Task aborted by user. Cleaning up files...")
                for f in chunk_files:
                    if os.path.exists(f):
                        try: os.remove(f)
                        except: pass
                return
            
            job["logs"].append(f"[INFO] [{time.strftime('%X')}] Synthesizing chunk {i + 1}/{total_chunks}...")
            chunk_path = os.path.join(chunks_dir, f"job_{job_id}_chunk_{i:04d}.wav")
            
            pcm = extract_pcm(voice.synthesize(chunk_text))
            with wave.open(chunk_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(voice.config.sample_rate)
                wf.writeframes(pcm)
                
            chunk_files.append(chunk_path)
            job["chunksProcessed"] = i + 1
            
            # --- RENDER STABILITY ENHANCEMENTS START ---
            # Sleep slightly between chunks to prevent CPU spike crashes (Bad Gateway 502/503 errors)
            time.sleep(0.3)
            # Run garbage collection explicitly to keep memory footprint under 512MB
            import gc
            gc.collect()
            # --- RENDER STABILITY ENHANCEMENTS END ---
            
        # Final cancellation check before merging
        if job["status"] == "cancelled":
            job["logs"].append(f"[WARNING] [{time.strftime('%X')}] Task aborted by user. Cleaning up files...")
            for f in chunk_files:
                if os.path.exists(f):
                    try: os.remove(f)
                    except: pass
            return

        # Merge WAV Chunks
        job["logs"].append(f"[INFO] [{time.strftime('%X')}] Merging chunks...")
        temp_wav = os.path.join(target_output_dir, f"{filename_base}_temp_{job_id}.wav")
        final_mp3 = os.path.join(target_output_dir, f"{filename_base}.mp3")
        
        with wave.open(temp_wav, "wb") as out_wav:
            with wave.open(chunk_files[0], "rb") as first:
                out_wav.setparams(first.getparams())
            for file in chunk_files:
                with wave.open(file, "rb") as wf:
                    out_wav.writeframes(wf.readframes(wf.getnframes()))
                try:
                    os.remove(file)
                except Exception as e:
                    logger.warning(f"Could not remove chunk file {file}: {e}")
                    
        # Export to optimized 96k Mono MP3
        job["logs"].append(f"[INFO] [{time.strftime('%X')}] Encoding merged WAV to optimized 96k MP3...")
        audio = AudioSegment.from_wav(temp_wav)
        audio = audio.set_channels(1)
        audio.export(final_mp3, format="mp3", bitrate="96k")
        
        try:
            os.remove(temp_wav)
        except:
            pass
            
        end_time = time.time()
        time_elapsed = round(end_time - job["startTimeRaw"], 2)
        
        if use_custom_path:
            audio_url = f"/api/audio/custom?path={urllib.parse.quote(final_mp3)}"
        else:
            audio_url = f"/static/audio/file_outputs/{filename_base}.mp3"
            
        job["status"] = "success"
        job["savedPath"] = final_mp3
        job["audioUrl"] = audio_url
        job["timeTaken"] = time_elapsed
        job["logs"].append(f"[SUCCESS] [{time.strftime('%X')}] Audio created successfully in {time_elapsed} seconds!")
        job["logs"].append(f"[SUCCESS] Output file: {final_mp3}")
        
    except Exception as e:
        logger.error(f"Background task {job_id} failed: {e}")
        job["status"] = "failed"
        job["error"] = str(e)
        job["logs"].append(f"[ERROR] [{time.strftime('%X')}] Synthesis failed: {str(e)}")
        for f in chunk_files:
            if os.path.exists(f):
                try: os.remove(f)
                except: pass

@app.get("/api/voices")
def get_voices():
    """List all available Piper voice models in the models/ directory."""
    voices = []
    for file in os.listdir(MODELS_DIR):
        if file.endswith(".onnx"):
            json_file = file + ".json"
            has_config = os.path.exists(os.path.join(MODELS_DIR, json_file))
            voices.append({
                "name": file,
                "path": os.path.join(MODELS_DIR, file),
                "has_config": has_config
            })
    return {"voices": voices}

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    """Processes chat prompt, generates text response, and synthesizes audio."""
    prompt = request.message
    voice_name = request.voice or DEFAULT_VOICE
    voice_path = os.path.join(MODELS_DIR, voice_name)
    
    if not os.path.exists(voice_path):
        raise HTTPException(status_code=400, detail=f"Voice model {voice_name} not found.")

    reply_text = call_gemini_api(prompt)
    
    filename_base = f"chat_{get_clean_filename(reply_text)[:15]}_{os.urandom(4).hex()}"
    output_dir = os.path.join(OUTPUTS_DIR, "chunks")
    final_output_dir = os.path.join(OUTPUTS_DIR, "chat")
    
    try:
        # Chat TTS runs synchronously and uses the optimized loader
        voice = load_voice_optimized(voice_path)
        
        # Split text into chunks
        chunks = split_text(reply_text, 1000)
        chunk_files = []
        
        for i, chunk_text in enumerate(chunks):
            chunk_path = os.path.join(output_dir, f"chat_{filename_base}_chunk_{i:04d}.wav")
            pcm = extract_pcm(voice.synthesize(chunk_text))
            with wave.open(chunk_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(voice.config.sample_rate)
                wf.writeframes(pcm)
            chunk_files.append(chunk_path)
            
        temp_wav = os.path.join(final_output_dir, f"{filename_base}_temp.wav")
        final_mp3 = os.path.join(final_output_dir, f"{filename_base}.mp3")
        os.makedirs(final_output_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)
        
        with wave.open(temp_wav, "wb") as out_wav:
            with wave.open(chunk_files[0], "rb") as first:
                out_wav.setparams(first.getparams())
            for file in chunk_files:
                with wave.open(file, "rb") as wf:
                    out_wav.writeframes(wf.readframes(wf.getnframes()))
                try: os.remove(file)
                except: pass
                
        audio = AudioSegment.from_wav(temp_wav)
        audio = audio.set_channels(1)
        audio.export(final_mp3, format="mp3", bitrate="96k")
        try: os.remove(temp_wav)
        except: pass
        
        audio_url = f"/static/audio/chat/{filename_base}.mp3"
        return {
            "reply": reply_text,
            "audioUrl": audio_url
        }
    except Exception as e:
        logger.error(f"Chat synthesis failed: {e}")
        return {
            "reply": reply_text,
            "audioUrl": None,
            "error": str(e)
        }

@app.post("/api/synthesize-file")
async def start_synthesize_file_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    outputPath: str = Form(None),
    filename: str = Form(None),
    maxChars: int = Form(2000),
    voice: str = Form(None)
):
    """Initializes and runs a text-to-speech document conversion task in the background."""
    voice_name = voice or DEFAULT_VOICE
    voice_path = os.path.join(MODELS_DIR, voice_name)
    
    if not os.path.exists(voice_path):
        raise HTTPException(status_code=400, detail=f"Voice model {voice_name} not found.")

    try:
        content = await file.read()
        text = content.decode("utf-8").strip()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading text file: {str(e)}")

    if not text:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    target_output_dir = outputPath
    use_custom_path = False
    
    if not target_output_dir:
        target_output_dir = os.path.join(OUTPUTS_DIR, "file_outputs")
    else:
        try:
            os.makedirs(target_output_dir, exist_ok=True)
            test_file = os.path.join(target_output_dir, f".write_test_{os.urandom(4).hex()}")
            with open(test_file, "w") as f:
                f.write("test")
            os.remove(test_file)
            use_custom_path = True
        except Exception as e:
            logger.warning(f"Requested path '{target_output_dir}' not writable: {e}. Using server storage.")
            target_output_dir = os.path.join(OUTPUTS_DIR, "file_outputs")
            
    chunks_dir = os.path.join(OUTPUTS_DIR, "chunks")
    os.makedirs(chunks_dir, exist_ok=True)
    os.makedirs(target_output_dir, exist_ok=True)
    
    if filename:
        filename_base = os.path.splitext(filename)[0]
    else:
        filename_base = get_clean_filename(text)

    # Create job
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "jobId": job_id,
        "status": "processing",
        "filename": f"{filename_base}.mp3",
        "savedPath": None,
        "chunksProcessed": 0,
        "totalChunks": 0,
        "totalChars": len(text), # Record total character count for front-end estimation syncing
        "audioUrl": None,
        "isCustomPath": use_custom_path,
        "timeTaken": 0.0,
        "startTimeRaw": time.time(),
        "logs": [],
        "error": None
    }

    # Queue background thread
    background_tasks.add_task(
        run_synthesis_job,
        job_id,
        text,
        voice_path,
        chunks_dir,
        target_output_dir,
        filename_base,
        maxChars,
        use_custom_path
    )

    return {
        "jobId": job_id,
        "status": "processing"
    }

@app.get("/api/jobs/{job_id}")
def get_job_status(job_id: str):
    """Retrieve current logs, chunks count, and completion state of a background job."""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
        
    job = JOBS[job_id]
    
    # Calculate elapsed seconds dynamically (incorporating pause/resume duration shifts)
    if job["status"] == "processing":
        job["elapsedSeconds"] = int(time.time() - job["startTimeRaw"])
    elif job["status"] == "paused":
        job["elapsedSeconds"] = int(job.get("pausedTimeRaw", time.time()) - job["startTimeRaw"])
    else:
        # success / failed / cancelled
        job["elapsedSeconds"] = int(job.get("timeTaken", 0))
        
    return job

@app.post("/api/jobs/{job_id}/pause")
def pause_job(job_id: str):
    """Set job state to paused. Wakes up during active background thread loop evaluation."""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = JOBS[job_id]
    if job["status"] == "processing":
        job["status"] = "paused"
        job["pausedTimeRaw"] = time.time() # Record pause timestamp
        job["logs"].append(f"[WARNING] [{time.strftime('%X')}] Synthesis paused by user.")
        return {"status": "paused"}
    return {"status": job["status"], "detail": "Job is not in a pausable state"}

@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str):
    """Resume job state to processing, waking up background loops from sleep states."""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = JOBS[job_id]
    if job["status"] == "paused":
        job["status"] = "processing"
        # Adjust startTimeRaw to account for the pause duration offset
        paused_duration = time.time() - job.get("pausedTimeRaw", time.time())
        job["startTimeRaw"] += paused_duration
        job.pop("pausedTimeRaw", None) # Clear paused timestamp
        job["logs"].append(f"[INFO] [{time.strftime('%X')}] Resuming synthesis execution.")
        return {"status": "processing"}
    return {"status": job["status"], "detail": "Job is not in a paused state"}

@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    """Instruct a background conversion process to stop synthesis and discard temp wav files."""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if JOBS[job_id]["status"] in ["pending", "processing", "paused"]:
        JOBS[job_id]["status"] = "cancelled"
        JOBS[job_id]["logs"].append(f"[INFO] [{time.strftime('%X')}] Cancellation requested by user.")
        return {"status": "cancelled"}
    else:
        return {"status": JOBS[job_id]["status"], "detail": "Job is not in a cancellable state"}

@app.get("/api/audio/custom")
def serve_custom_audio(path: str):
    """Serves audio files located in custom local output directories (like D:\\audio) to bypass browser security blocks."""
    if not path.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files can be served")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"File not found at: {path}")
    return FileResponse(path, media_type="audio/mpeg")

@app.get("/api/status")
def get_status():
    """Verify backend and Piper configuration health."""
    has_default_model = os.path.exists(os.path.join(MODELS_DIR, DEFAULT_VOICE))
    has_default_config = os.path.exists(os.path.join(MODELS_DIR, DEFAULT_VOICE + ".json"))
    return {
        "status": "online",
        "piper_voice_loaded": has_default_model,
        "piper_config_loaded": has_default_config,
        "default_voice": DEFAULT_VOICE,
        "python_version": sys.version
    }

if __name__ == "__main__":
    import uvicorn
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except:
        pass
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
