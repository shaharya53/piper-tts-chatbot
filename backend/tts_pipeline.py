import sys
import os
import logging
import wave
import re
from typing import List, Tuple

# --- PYTHON 3.13 COMPATIBILITY PATCH START ---
try:
    import audioop
except ImportError:
    try:
        import audioop_lts as audioop
        sys.modules["audioop"] = audioop
    except ImportError:
        logging.error("❌ ERROR: Please install 'audioop-lts' for python 3.13 support.")
# --- PYTHON 3.13 COMPATIBILITY PATCH END ---

from piper import PiperVoice
from pydub import AudioSegment

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Cache loaded voices to avoid reloading them on every request (which is slow)
_VOICE_CACHE = {}

def get_voice(voice_path: str) -> PiperVoice:
    """Loads and caches a PiperVoice instance to make speech generation fast."""
    abs_voice_path = os.path.abspath(voice_path)
    if abs_voice_path not in _VOICE_CACHE:
        if not os.path.exists(abs_voice_path):
            raise FileNotFoundError(f"Voice model file not found at: {abs_voice_path}")
        logger.info(f"Loading Piper voice model from: {abs_voice_path}")
        _VOICE_CACHE[abs_voice_path] = PiperVoice.load(abs_voice_path)
    return _VOICE_CACHE[abs_voice_path]

def split_text(text: str, max_chars: int = 2000) -> List[str]:
    """Splits text into chunks of maximum max_chars, keeping words intact."""
    chunks = []
    text = text.strip()
    while len(text) > max_chars:
        split_at = text.rfind(' ', 0, max_chars)
        if split_at == -1: 
            split_at = max_chars
        chunks.append(text[:split_at].strip())
        text = text[split_at:].strip()
    if text: 
        chunks.append(text)
    return chunks

def get_clean_filename(text: str) -> str:
    """Generates a clean base filename from the first few words of the text."""
    words = text.split()
    base_name = "".join(words[:2]) if len(words) >= 2 else "".join(words)
    clean_name = re.sub(r'[^a-zA-Z0-9]', '', base_name)
    if not clean_name: 
        clean_name = "output"
    return clean_name

def extract_pcm(audio_generator) -> bytes:
    """Extracts raw int16 PCM bytes from Piper audio generator output."""
    pcm_parts = []
    for chunk in audio_generator:
        if hasattr(chunk, 'audio_int16_bytes'):
            pcm_parts.append(chunk.audio_int16_bytes)
        elif hasattr(chunk, 'audio_int16_array'):
            pcm_parts.append(chunk.audio_int16_array.tobytes())
        elif hasattr(chunk, 'audio_data'):
            pcm_parts.append(chunk.audio_data)
        elif hasattr(chunk, 'audio'):
            pcm_parts.append(chunk.audio)
    return b"".join(pcm_parts)

def synthesize_text_to_mp3(
    text: str,
    voice_path: str,
    output_dir: str,
    final_output_dir: str,
    filename_base: str = None,
    max_chars: int = 2000
) -> Tuple[str, int]:
    """
    Synthesizes the text using Piper, merges the chunks, and converts to optimized MP3.
    Returns:
        tuple (str, int): (Path to the final MP3 file, number of chunks processed)
    """
    # Ensure directories exist
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(final_output_dir, exist_ok=True)

    chunks = split_text(text, max_chars)
    logger.info(f"Processing {len(chunks)} chunks...")

    # Load voice (from cache or disk)
    voice = get_voice(voice_path)

    chunk_files = []
    try:
        for i, chunk_text in enumerate(chunks):
            chunk_path = os.path.join(output_dir, f"chunk_{i:04d}.wav")
            try:
                pcm = extract_pcm(voice.synthesize(chunk_text))
                with wave.open(chunk_path, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(voice.config.sample_rate)
                    wf.writeframes(pcm)
                chunk_files.append(chunk_path)
            except Exception as e:
                logger.error(f"Chunk {i} synthesis failed: {e}")
                raise e

        if not chunk_files:
            raise ValueError("No WAV chunks were generated.")

        # Determine filename
        if not filename_base:
            filename_base = get_clean_filename(text)
        
        temp_wav = os.path.join(final_output_dir, f"{filename_base}_temp.wav")
        final_mp3 = os.path.join(final_output_dir, f"{filename_base}.mp3")

        # Merge Chunks
        logger.info("Merging WAV chunks...")
        with wave.open(temp_wav, "wb") as out_wav:
            with wave.open(chunk_files[0], "rb") as first:
                out_wav.setparams(first.getparams())
            for file in chunk_files:
                with wave.open(file, "rb") as wf:
                    out_wav.writeframes(wf.readframes(wf.getnframes()))
                # Remove temporary chunk file
                try:
                    os.remove(file)
                except Exception as e:
                    logger.warning(f"Could not remove chunk file {file}: {e}")

        # Convert to Optimized MP3 using pydub
        logger.info(f"Converting to Small-Size MP3: {filename_base}.mp3")
        audio = AudioSegment.from_wav(temp_wav)
        
        # Optimization: mono (1 channel), 96k bitrate
        audio = audio.set_channels(1)
        audio.export(final_mp3, format="mp3", bitrate="96k")

        # Clean up temporary merged WAV
        try:
            os.remove(temp_wav)
        except Exception as e:
            logger.warning(f"Could not remove temp WAV {temp_wav}: {e}")

        logger.info(f"Successfully generated: {final_mp3}")
        return final_mp3, len(chunks)

    except Exception as e:
        # Clean up any leftover chunk files on error
        for file in chunk_files:
            if os.path.exists(file):
                try:
                    os.remove(file)
                except:
                    pass
        raise e
