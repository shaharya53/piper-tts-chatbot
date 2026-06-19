import React, { useState, useEffect, useRef } from 'react';

interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  audioUrl?: string;
}

interface ChatSectionProps {
  backendUrl: string;
  selectedVoice: string;
  isBackendOnline: boolean;
}

export const ChatSection: React.FC<ChatSectionProps> = ({
  backendUrl,
  selectedVoice,
  isBackendOnline,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: 'Hello! I am your AI speech assistant. You can chat with me or upload a text file in the Converter section to turn it into an optimized voice file.',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [autoplay, setAutoplay] = useState(true);

  // Audio Playback states
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<{ [key: string]: number }>({});
  const [audioTimes, setAudioTimes] = useState<{ [key: string]: string }>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading || !isBackendOnline) return;

    const userMsgText = inputText.trim();
    const userMsgId = 'user_' + Date.now();
    
    setMessages((prev) => [...prev, { id: userMsgId, sender: 'user', text: userMsgText }]);
    setInputText('');
    setIsLoading(true);

    try {
      const response = await fetch(`${backendUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsgText,
          voice: selectedVoice,
        }),
      });

      if (!response.ok) {
        throw new Error('API server returned error');
      }

      const data = await response.json();
      const botMsgId = 'bot_' + Date.now();
      const botAudioUrl = data.audioUrl ? `${backendUrl}${data.audioUrl}` : undefined;

      setMessages((prev) => [
        ...prev,
        {
          id: botMsgId,
          sender: 'bot',
          text: data.reply,
          audioUrl: botAudioUrl,
        },
      ]);

      // If autoplay is enabled and we got an audio file, play it
      if (autoplay && botAudioUrl) {
        // Wait a tiny fraction for react rendering
        setTimeout(() => {
          playAudio(botMsgId, botAudioUrl);
        }, 100);
      }
    } catch (error) {
      console.error('Error during chat:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: 'error_' + Date.now(),
          sender: 'bot',
          text: 'Sorry, I am unable to connect to the server. Please ensure that the backend server is running.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const playAudio = (messageId: string, url: string) => {
    // If clicking the currently playing message, toggle pause
    if (playingId === messageId && audioRef.current) {
      if (!audioRef.current.paused) {
        audioRef.current.pause();
        setPlayingId(null);
      } else {
        audioRef.current.play().catch(e => console.error("Playback error:", e));
        setPlayingId(messageId);
      }
      return;
    }

    // Stop current audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // Start new audio
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(messageId);

    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        setAudioProgress((prev) => ({ ...prev, [messageId]: percent }));
        
        // Format time
        const curMins = Math.floor(audio.currentTime / 60);
        const curSecs = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
        const durMins = Math.floor(audio.duration / 60);
        const durSecs = Math.floor(audio.duration % 60).toString().padStart(2, '0');
        setAudioTimes((prev) => ({
          ...prev,
          [messageId]: `${curMins}:${curSecs} / ${durMins}:${durSecs}`
        }));
      }
    });

    audio.addEventListener('ended', () => {
      setPlayingId(null);
      setAudioProgress((prev) => ({ ...prev, [messageId]: 0 }));
    });

    audio.addEventListener('error', (e) => {
      console.error('Audio load error:', e);
      setPlayingId(null);
    });

    audio.play().catch((err) => {
      console.error('Error playing audio:', err);
      setPlayingId(null);
    });
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>, messageId: string) => {
    if (playingId !== messageId || !audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const clickRatio = x / width;
    audioRef.current.currentTime = clickRatio * audioRef.current.duration;
  };

  return (
    <div className="chat-container">
      {/* Messages Scroll Area */}
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message-wrapper ${msg.sender}`}>
            <div className="avatar">
              {msg.sender === 'user' ? 'U' : 'AI'}
            </div>
            <div className="message-bubble">
              <div>{msg.text}</div>
              
              {/* Audio widget if available */}
              {msg.audioUrl && (
                <div className="bubble-audio-widget">
                  <button
                    className="play-btn"
                    onClick={() => playAudio(msg.id, msg.audioUrl!)}
                    title={playingId === msg.id ? 'Pause' : 'Listen'}
                  >
                    {playingId === msg.id ? (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    )}
                  </button>
                  <div className="audio-bar-container">
                    <div 
                      className="audio-progress" 
                      onClick={(e) => handleProgressBarClick(e, msg.id)}
                    >
                      <div
                        className="audio-progress-bar"
                        style={{ width: `${audioProgress[msg.id] || 0}%` }}
                      ></div>
                    </div>
                    <div className="audio-time">
                      {audioTimes[msg.id] || '0:00'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="message-wrapper assistant">
            <div className="avatar">AI</div>
            <div className="message-bubble">
              <div className="typing-indicator">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={handleSend} className="chat-input-wrapper">
        <input
          type="text"
          className="chat-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            isBackendOnline
              ? "Type your message here..."
              : "Server offline - Please start the backend server first"
          }
          disabled={isLoading || !isBackendOnline}
        />
        
        {/* Autoplay setting */}
        <label className="autoplay-toggle">
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(e) => setAutoplay(e.target.checked)}
            style={{ width: 'auto', marginRight: '4px', cursor: 'pointer' }}
          />
          Auto-Speak
        </label>

        <button
          type="submit"
          className="send-btn"
          disabled={!inputText.trim() || isLoading || !isBackendOnline}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </form>
    </div>
  );
};
