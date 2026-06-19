import { useState, useEffect, useRef } from 'react';
import './App.css';
import { ChatSection } from './components/ChatSection';
import { ConverterSection } from './components/ConverterSection';

interface Voice {
  name: string;
  path: string;
  has_config: boolean;
}

function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'converter'>('chat');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('hi_IN-female-medium.onnx');
  const [isBackendOnline, setIsBackendOnline] = useState(false);

  // Background Job States (Elevated to App level to persist on tab switch)
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<any>(null);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const pollingRef = useRef<any>(null);
  const backendUrl = import.meta.env.VITE_API_URL || (window.location.port ? `${window.location.protocol}//${window.location.hostname}:8000` : 'http://localhost:8000');

  // Check backend status on mount and poll
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/status`);
        if (response.ok) {
          setIsBackendOnline(true);
        } else {
          setIsBackendOnline(false);
        }
      } catch (err) {
        setIsBackendOnline(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch voices list when backend is online
  useEffect(() => {
    if (!isBackendOnline) return;

    const fetchVoices = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/voices`);
        if (response.ok) {
          const data = await response.json();
          setVoices(data.voices || []);
          if (data.voices && data.voices.length > 0) {
            const hasDefault = data.voices.some((v: Voice) => v.name === 'hi_IN-female-medium.onnx');
            if (hasDefault) {
              setSelectedVoice('hi_IN-female-medium.onnx');
            } else {
              setSelectedVoice(data.voices[0].name);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching voices:', err);
      }
    };

    fetchVoices();
  }, [isBackendOnline]);

  // Restore running job from LocalStorage on load
  useEffect(() => {
    const savedJobId = localStorage.getItem('active_job_id');
    if (savedJobId) {
      console.log('Restoring active background job:', savedJobId);
      setActiveJobId(savedJobId);
      setIsGenerating(true);
    }
  }, []);

  // Polling logic when activeJobId changes
  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    // Continue polling if generating, or if we have an active ID we are tracking
    if (!activeJobId || !isBackendOnline) return;

    const pollJob = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/jobs/${activeJobId}`);
        
        // Handle case where job is not found on backend (e.g. server restarted or wiped memory)
        if (response.status === 404) {
          console.warn(`Job ${activeJobId} not found on backend. Clearing local job state.`);
          setIsGenerating(false);
          localStorage.removeItem('active_job_id');
          setActiveJobId(null);
          setActiveJob(null);
          setJobLogs((prev) => [...prev, '[ERROR] Conversion job not found on server (it may have restarted).']);
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch job info');
        }
        
        const data = await response.json();
        setActiveJob(data);
        setJobLogs(data.logs || []);

        if (data.status === 'success') {
          setIsGenerating(false);
          localStorage.removeItem('active_job_id');
          setActiveJobId(null);
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          setIsGenerating(false);
          localStorage.removeItem('active_job_id');
          setActiveJobId(null);
        } else if (data.status === 'paused') {
          // Keep polling, but marked as generating (paused)
          setIsGenerating(true);
        }
      } catch (error) {
        console.error('Job polling error:', error);
      }
    };

    pollJob();
    pollingRef.current = setInterval(pollJob, 1500);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeJobId, isBackendOnline]);

  const startJob = (jobId: string) => {
    setJobLogs(['[INFO] Initializing background task...']);
    setActiveJob(null);
    setIsGenerating(true);
    setActiveJobId(jobId);
    localStorage.setItem('active_job_id', jobId);
  };

  const pauseJob = async () => {
    if (!activeJobId) return;
    try {
      setJobLogs((prev) => [...prev, '[INFO] Pausing conversion on server...']);
      const response = await fetch(`${backendUrl}/api/jobs/${activeJobId}/pause`, {
        method: 'POST',
      });
      if (response.ok) {
        setActiveJob((prev: any) => prev ? { ...prev, status: 'paused' } : null);
      } else if (response.status === 404) {
        // Clear local state since job doesn't exist on server
        setIsGenerating(false);
        localStorage.removeItem('active_job_id');
        setActiveJobId(null);
        setActiveJob(null);
      }
    } catch (err) {
      console.error('Error pausing job:', err);
    }
  };

  const resumeJob = async () => {
    if (!activeJobId) return;
    try {
      setJobLogs((prev) => [...prev, '[INFO] Resuming conversion on server...']);
      const response = await fetch(`${backendUrl}/api/jobs/${activeJobId}/resume`, {
        method: 'POST',
      });
      if (response.ok) {
        setActiveJob((prev: any) => prev ? { ...prev, status: 'processing' } : null);
      } else if (response.status === 404) {
        // Clear local state since job doesn't exist on server
        setIsGenerating(false);
        localStorage.removeItem('active_job_id');
        setActiveJobId(null);
        setActiveJob(null);
      }
    } catch (err) {
      console.error('Error resuming job:', err);
    }
  };

  const cancelJob = async () => {
    const jobIdToCancel = activeJobId || (activeJob && activeJob.jobId);
    if (!jobIdToCancel) return;

    try {
      setJobLogs((prev) => [...prev, '[INFO] Cancelling conversion and freeing server files...']);
      const response = await fetch(`${backendUrl}/api/jobs/${jobIdToCancel}/cancel`, {
        method: 'POST',
      });
      if (response.ok || response.status === 404) {
        setIsGenerating(false);
        localStorage.removeItem('active_job_id');
        setActiveJobId(null);
        setActiveJob((prev: any) => prev ? { ...prev, status: 'cancelled' } : null);
      }
    } catch (err) {
      console.error('Error cancelling job:', err);
    }
  };

  const resetJob = async () => {
    // If there is a running/paused job, cancel it on the backend first
    const jobIdToCancel = activeJobId || (activeJob && activeJob.jobId);
    if (jobIdToCancel && (isGenerating || (activeJob && activeJob.status === 'paused'))) {
      try {
        await fetch(`${backendUrl}/api/jobs/${jobIdToCancel}/cancel`, { method: 'POST' });
      } catch (e) {
        console.error(e);
      }
    }
    
    // Clear all frontend states
    setIsGenerating(false);
    localStorage.removeItem('active_job_id');
    setActiveJobId(null);
    setActiveJob(null);
    setJobLogs([]);
  };

  return (
    <div className="app-container">
      {/* Ambient Background Glows */}
      <div className="ambient-bg">
        <div className="ambient-glow-1"></div>
        <div className="ambient-glow-2"></div>
      </div>

      {/* Sidebar navigation panel */}
      <aside className="sidebar">
        <div className="brand-section">
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <span className="brand-name">Piper TTS Studio</span>
        </div>

        <nav className="nav-links">
          <button
            className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            AI Voice Chat (Chat Bot)
          </button>
          
          <button
            className={`nav-item ${activeTab === 'converter' ? 'active' : ''}`}
            onClick={() => setActiveTab('converter')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Document Converter (TTS)
          </button>
        </nav>

        {/* Sidebar Footer Status Indicator */}
        <div className="sidebar-footer">
          <div className="status-badge">
            <span className={`status-dot ${isBackendOnline ? 'online' : 'offline'}`}></span>
            <span>{isBackendOnline ? 'Server Online' : 'Server Offline'}</span>
          </div>
          
          {isBackendOnline && (
            <div className="voice-info">
              <span className="voice-info-label">Active Voice</span>
              <select
                className="voice-select"
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
              >
                {voices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name.includes('female') 
                      ? 'Female Voice (Hindi)' 
                      : voice.name.includes('rohan') 
                        ? 'Male Voice (Rohan - Hindi)' 
                        : voice.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </aside>

      {/* Main Display Pane */}
      <main className="main-content">
        {activeTab === 'chat' ? (
          <>
            <header className="section-header">
              <h1 className="section-title">AI Chat Assistant</h1>
              <p className="section-subtitle">Conversational voice agent powered by offline Piper TTS</p>
            </header>
            <ChatSection
              backendUrl={backendUrl}
              selectedVoice={selectedVoice}
              isBackendOnline={isBackendOnline}
            />
          </>
        ) : (
          <>
            <header className="section-header">
              <h1 className="section-title">Document Converter</h1>
              <p className="section-subtitle">Convert your text documents (.txt) into high-quality MP3 audio files</p>
            </header>
            <ConverterSection
              backendUrl={backendUrl}
              selectedVoice={selectedVoice}
              isBackendOnline={isBackendOnline}
              activeJob={activeJob}
              jobLogs={jobLogs}
              isGenerating={isGenerating}
              startJob={startJob}
              pauseJob={pauseJob}
              resumeJob={resumeJob}
              cancelJob={cancelJob}
              resetJob={resetJob}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
