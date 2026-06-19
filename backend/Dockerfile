FROM python:3.11-slim

# Install system dependencies for audio processing and speech synthesis
RUN apt-get update && apt-get install -y \
    ffmpeg \
    espeak-ng \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend files (including the models directory)
COPY . .

# Expose port and run FastAPI with uvicorn
EXPOSE 8000
ENV PORT=8000
CMD uvicorn main:app --host 0.0.0.0 --port $PORT
