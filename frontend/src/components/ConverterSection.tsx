import React, { useState, useRef, useEffect } from 'react';



interface ConverterSectionProps {
  backendUrl: string;
  selectedVoice: string;
  isBackendOnline: boolean;
  activeJob: any;
  jobLogs: string[];
  isGenerating: boolean;
  startJob: (jobId: string) => void;
  pauseJob: () => void;
  resumeJob: () => void;
  cancelJob: () => void;
  resetJob: () => void;
}

export const ConverterSection: React.FC<ConverterSectionProps> = ({
  backendUrl,
  selectedVoice,
  isBackendOnline,
  activeJob,
  jobLogs,
  isGenerating,
  startJob,
  pauseJob,
  resumeJob,
  cancelJob,
  resetJob,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileChars, setFileChars] = useState<number | null>(null);
  const [outputPath, setOutputPath] = useState('D:\\audio');
  const [filename, setFilename] = useState('');
  
  // Set default max characters to 2000
  const [maxChars, setMaxChars] = useState(2000);
  const [dragActive, setDragActive] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Time estimation tracking states
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Custom Audio Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPaused = activeJob && activeJob.status === 'paused';

  // Read file character count on upload
  const readFileCharacters = (uploadedFile: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setFileChars(text ? text.length : 0);
    };
    reader.readAsText(uploadedFile);
  };

  // Reset audio and timers on job change
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    };
  }, [activeJob]);

  // Live timer for countdown during synthesis
  useEffect(() => {
    let timer: any = null;
    if (isGenerating && !isPaused) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isGenerating, isPaused]);

  // Reset timer elapsed when starting a new job or resetting
  useEffect(() => {
    if (!isGenerating && !isPaused) {
      setElapsedSeconds(0);
    }
  }, [isGenerating, isPaused]);

  // Synchronize local elapsedSeconds with activeJob's elapsedSeconds from backend
  useEffect(() => {
    if (activeJob && typeof activeJob.elapsedSeconds === 'number') {
      setElapsedSeconds(activeJob.elapsedSeconds);
    }
  }, [activeJob?.elapsedSeconds]);

  // Handle Drag Events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.txt')) {
        setFile(droppedFile);
        readFileCharacters(droppedFile);
        setSubmitError(null);
      } else {
        alert("Please upload a .txt file only.");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      readFileCharacters(selectedFile);
      setSubmitError(null);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    setFileChars(null);
    setSubmitError(null);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 2;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || isGenerating || !isBackendOnline) return;

    setSubmitError(null);
    setElapsedSeconds(0); // Reset timer
    
    const formData = new FormData();
    formData.append('file', file);
    if (outputPath) formData.append('outputPath', outputPath);
    if (filename) formData.append('filename', filename);
    formData.append('maxChars', maxChars.toString());
    formData.append('voice', selectedVoice);

    try {
      const response = await fetch(`${backendUrl}/api/synthesize-file`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to submit synthesis job');
      }

      const data = await response.json();
      if (data.jobId) {
        startJob(data.jobId);
      }
    } catch (error: any) {
      console.error('File submit error:', error);
      setSubmitError(error.message);
    }
  };

  const handleLocalReset = () => {
    setFileChars(null);
    setFile(null);
    resetJob();
  };

  // Audio player helpers
  const togglePlay = () => {
    if (!activeJob || activeJob.status !== 'success') return;

    if (!audioRef.current) {
      const audio = new Audio(`${backendUrl}${activeJob.audioUrl}`);
      audioRef.current = audio;
      audio.playbackRate = playbackSpeed;

      audio.addEventListener('loadedmetadata', () => {
        setDuration(audio.duration);
      });

      audio.addEventListener('timeupdate', () => {
        setCurrentTime(audio.currentTime);
      });

      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setCurrentTime(0);
      });

      audio.addEventListener('error', (e) => {
        console.error('Audio load error:', e);
        setIsPlaying(false);
      });
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(e => console.error("Playback failed:", e));
      setIsPlaying(true);
    }
  };

  const handleTimelineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const newTime = parseFloat(e.target.value);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const changeSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const formatTime = (secs: number) => {
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  // Calculation for synthesis estimation (avg 180 characters per second of CPU processing)
  const totalCharacters = (activeJob && activeJob.totalChars) || fileChars;
  const estTotalSeconds = totalCharacters ? Math.ceil(totalCharacters / 180) : 0;
  const timeRemaining = isGenerating
    ? Math.max(1, estTotalSeconds - elapsedSeconds)
    : null;

  return (
    <div className="converter-container">
      <div className="glass-panel">
        {/* Render Dropzone and Settings only if NOT converting/paused, and NO successful result is currently displayed */}
        {!isGenerating && !isPaused && (!activeJob || activeJob.status !== 'success') && (
          <form onSubmit={handleConvert}>
            {/* File input drag and drop zone */}
            <div 
              className={`dropzone ${dragActive ? 'drag-active' : ''}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileInput}
            >
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".txt"
                onChange={handleFileChange}
                disabled={isGenerating}
              />

              {!file ? (
                <>
                  <svg className="dropzone-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                  </svg>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: '4px' }}>Drag & drop text file here</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>or click to browse (only .txt files)</p>
                  </div>
                </>
              ) : (
                <div className="file-info-card" onClick={(e) => e.stopPropagation()}>
                  <svg className="file-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  <div className="file-meta" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div className="file-name">{file.name}</div>
                    <div className="file-size" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span>{formatBytes(file.size)}</span>
                      {fileChars !== null && (
                        <>
                          <span style={{ opacity: 0.3 }}>•</span>
                          <span>{fileChars.toLocaleString()} characters</span>
                        </>
                      )}
                    </div>
                    {fileChars !== null && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 500, marginTop: '2px' }}>
                        Estimated time: ~{estTotalSeconds} seconds ({Math.ceil(fileChars / maxChars)} parts)
                      </div>
                    )}
                  </div>
                  <button type="button" className="remove-file-btn" onClick={removeFile} title="Remove file">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Settings Grid */}
            <div className="config-grid">
              <div className="form-group full-width">
                <label>Target Output Path</label>
                <input
                  type="text"
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  placeholder="e.g. D:\audio"
                  disabled={isGenerating}
                />
              </div>

              <div className="form-group">
                <label>Custom Filename (Optional)</label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="e.g. main_speech"
                  disabled={isGenerating}
                />
              </div>

              <div className="form-group">
                <label>Max Characters per Chunk Part</label>
                <input
                  type="number"
                  value={maxChars}
                  onChange={(e) => setMaxChars(parseInt(e.target.value) || 2000)}
                  min="100"
                  max="5000"
                  disabled={isGenerating}
                />
              </div>
            </div>

            <button
              type="submit"
              className="action-btn"
              disabled={!file || !isBackendOnline}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
              Convert to Speech
            </button>
          </form>
        )}

        {/* Display Control Center if generating OR paused */}
        {(isGenerating || isPaused) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
            <div 
              style={{
                background: isPaused ? 'rgba(245, 158, 11, 0.1)' : 'rgba(99, 102, 241, 0.1)',
                border: isPaused ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(99, 102, 241, 0.25)',
                borderRadius: '12px',
                padding: '20px',
                textAlign: 'center'
              }}
            >
              {isPaused ? (
                <>
                  <h3 style={{ color: 'var(--warning)', marginBottom: '6px', fontSize: '1.1rem' }}>Conversion Stopped / Paused</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Processed {activeJob ? `${activeJob.chunksProcessed}/${activeJob.totalChunks}` : '0/0'} parts. Choose an option to proceed:
                  </p>
                </>
              ) : (
                <>
                  <h3 style={{ color: 'var(--primary)', marginBottom: '6px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <svg className="spin" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.2)"></circle>
                      <path d="M4 12a8 8 0 018-8v4" stroke="white" strokeLinecap="round"></path>
                    </svg>
                    Synthesizing Speech...
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Generating part {activeJob ? `${activeJob.chunksProcessed + 1}/${activeJob.totalChunks}` : '1/...'}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 500, marginTop: '6px' }}>
                    Estimated time remaining: {timeRemaining !== null && timeRemaining > 0 
                      ? `${timeRemaining}s` 
                      : '1s (finishing up...)'}
                  </p>
                </>
              )}
            </div>

            {/* Stop Action Options Group */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isPaused ? (
                <>
                  {/* Three Option buttons requested when stopped */}
                  <button
                    type="button"
                    className="action-btn"
                    onClick={resumeJob}
                    style={{ background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)' }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ marginRight: '6px' }}>
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                    Continue Conversion
                  </button>
                  
                  <button
                    type="button"
                    className="action-btn"
                    onClick={cancelJob}
                    style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ marginRight: '6px' }}>
                      <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
                    </svg>
                    Cancel Conversion
                  </button>

                  <button
                    type="button"
                    className="action-btn"
                    onClick={handleLocalReset}
                    style={{ background: 'linear-gradient(135deg, #475569 0%, #334155 100%)', boxShadow: 'none' }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                    </svg>
                    New Conversion
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={pauseJob}
                    style={{
                      background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
                      boxShadow: '0 4px 15px rgba(217, 119, 6, 0.3)'
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ marginRight: '6px' }}>
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                    Stop / Pause Conversion
                  </button>
                  
                  <button
                    type="button"
                    className="action-btn"
                    onClick={cancelJob}
                    style={{
                      background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                      boxShadow: '0 4px 15px rgba(239, 68, 68, 0.3)'
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ marginRight: '6px' }}>
                      <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
                    </svg>
                    Cancel Conversion
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Submit Error Card */}
        {submitError && (
          <div className="success-card" style={{ background: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.25)' }}>
            <div className="success-header" style={{ color: 'var(--error)' }}>
              Error Submitting Job
            </div>
            <div className="success-details" style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
              {submitError}
            </div>
            <button type="button" className="action-btn" onClick={handleLocalReset} style={{ background: 'rgba(255,255,255,0.05)', boxShadow: 'none' }}>
              Back to Upload
            </button>
          </div>
        )}

        {/* Live console logs */}
        {(isGenerating || isPaused || jobLogs.length > 0) && (
          <div className="logs-console">
            {jobLogs.map((log, index) => (
              <div 
                key={index} 
                className={`log-line ${
                  log.includes('[ERROR]') ? 'error' : log.includes('[SUCCESS]') ? 'success' : 'info'
                }`}
              >
                {log}
              </div>
            ))}
          </div>
        )}

        {/* Success Card and Audio Player */}
        {activeJob && activeJob.status === 'success' && (
          <div className="success-card">
            <div className="success-header">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              Speech audio successfully generated!
            </div>
            
            <div className="success-details">
              <div className="detail-row">
                <div className="detail-label">Filename:</div>
                <div className="detail-val">{activeJob.filename}</div>
              </div>
              <div className="detail-row">
                <div className="detail-label">Saved Path:</div>
                <div className="detail-val">{activeJob.savedPath}</div>
              </div>
              <div className="detail-row">
                <div className="detail-label">Total Chunks:</div>
                <div className="detail-val">{activeJob.totalChunks} parts</div>
              </div>
              <div className="detail-row">
                <div className="detail-label">Time Taken:</div>
                <div className="detail-val">{activeJob.timeTaken} seconds</div>
              </div>
            </div>

            {/* Custom player */}
            <div className="audio-player-container" style={{ marginBottom: '20px' }}>
              <div className="player-main-controls">
                <button className="play-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                <div className="audio-timeline-wrapper">
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={handleTimelineChange}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
              </div>

              <div className="player-secondary-controls">
                <div className="speed-selector">
                  <span>Speed:</span>
                  {[1.0, 1.25, 1.5, 2.0].map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      className={`speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
                      onClick={() => changeSpeed(speed)}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>

                <a href={`${backendUrl}${activeJob.audioUrl}`} download={activeJob.filename} className="download-link">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                  </svg>
                  Download MP3
                </a>
              </div>
            </div>

            {/* New Conversion button */}
            <button
              type="button"
              className="action-btn"
              onClick={handleLocalReset}
              style={{ background: 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)' }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ marginRight: '6px' }}>
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              New Conversion
            </button>
          </div>
        )}

        {/* Failed Job Card */}
        {activeJob && activeJob.status === 'failed' && (
          <div className="success-card" style={{ background: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.25)' }}>
            <div className="success-header" style={{ color: 'var(--error)' }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              Speech synthesis failed!
            </div>
            <div className="success-details" style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
              {activeJob.error || 'Unknown error occurred during background voice synthesis.'}
            </div>
            <button type="button" className="action-btn" onClick={handleLocalReset} style={{ background: 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)' }}>
              New Conversion
            </button>
          </div>
        )}

        {/* Cancelled Job Card */}
        {activeJob && activeJob.status === 'cancelled' && (
          <div className="success-card" style={{ background: 'rgba(245, 158, 11, 0.06)', borderColor: 'rgba(245, 158, 11, 0.25)' }}>
            <div className="success-header" style={{ color: 'var(--warning)' }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              Synthesis Cancelled
            </div>
            <div className="success-details" style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
              The text-to-speech conversion process was aborted by the user.
            </div>
            <button type="button" className="action-btn" onClick={handleLocalReset} style={{ background: 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)' }}>
              New Conversion
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
