import React, { useState, useRef, useCallback, useEffect } from 'react';
import YouTube from 'react-youtube';
import type { YouTubePlayer } from 'react-youtube';
import { Clip } from './types';
import { extractVideoId } from './utils/youtube';
import { parseTimeToSeconds, formatTime } from './utils/time';
import { PlusIcon, TrashIcon, DownloadIcon, LoaderIcon, PlayIcon, CloseIcon, TargetIcon, SaveIcon } from './components/Icons';

const LOCAL_STORAGE_KEY = 'youtubeClipperData';

const App: React.FC = () => {
  const [url, setUrl] = useState<string>('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [finishedVideoUrl, setFinishedVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');

  const playerRef = useRef<YouTubePlayer | null>(null);
  const recordedChunks = useRef<Blob[]>([]);

  useEffect(() => {
    try {
      const savedDataRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedDataRaw) {
        const savedData = JSON.parse(savedDataRaw);
        if (savedData.videoId && Array.isArray(savedData.clips)) {
          setUrl(`https://www.youtube.com/watch?v=${savedData.videoId}`);
          setVideoId(savedData.videoId);
          setClips(savedData.clips);
        }
      }
    } catch (e) {
      console.error("Failed to load data from local storage", e);
      setError("Could not load saved clips from a previous session.");
    }
  }, []);

  const handleLoadVideo = () => {
    setError(null);
    setFinishedVideoUrl(null);
    const id = extractVideoId(url);
    if (id) {
      setVideoId(id);
      setClips([]); // Clear clips for new video
    } else {
      setError('Invalid YouTube URL. Please enter a valid URL.');
    }
  };
  
  const handleAddClip = () => {
    setError(null);
    const start = parseTimeToSeconds(startTime);
    const end = parseTimeToSeconds(endTime);
    if (start >= end) {
      setError('End time must be after start time.');
      return;
    }
    if (isNaN(start) || isNaN(end)) {
      setError('Invalid time format. Please use MM:SS or HH:MM:SS.');
      return;
    }
    const newClip: Clip = { id: Date.now().toString(), start, end };
    setClips([...clips, newClip].sort((a, b) => a.start - b.start));
    setStartTime('');
    setEndTime('');
  };

  const handleRemoveClip = (id: string) => {
    setClips(clips.filter(clip => clip.id !== id));
  };

  const handleSaveClips = () => {
    if (!videoId || clips.length === 0) {
      setError("There are no clips to save for this video.");
      return;
    }
    try {
      const dataToSave = JSON.stringify({ videoId, clips });
      localStorage.setItem(LOCAL_STORAGE_KEY, dataToSave);
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (e) {
      console.error("Failed to save data to local storage", e);
      setError("Could not save clips. Your browser's storage might be full.");
    }
  };
  
  const onPlayerReady = (event: { target: YouTubePlayer }) => {
    playerRef.current = event.target;
  };

  const handleSetTimeFromPlayer = (type: 'start' | 'end') => {
    if (!playerRef.current) {
      setError("Player not available. Please load a video first.");
      return;
    }
    const currentTime = playerRef.current.getCurrentTime();
    const formattedTime = formatTime(currentTime);
    if (type === 'start') {
      setStartTime(formattedTime);
    } else {
      setEndTime(formattedTime);
    }
  };

  const playSegment = useCallback((player: YouTubePlayer, start: number, end: number): Promise<void> => {
    return new Promise(resolve => {
      player.seekTo(start, true);
      player.playVideo();
      
      let resolved = false;
      const checkInterval = setInterval(() => {
        if(resolved) {
          clearInterval(checkInterval);
          return;
        }
        const currentTime = player.getCurrentTime();
        if (currentTime >= end) {
          resolved = true;
          clearInterval(checkInterval);
          player.pauseVideo();
          // Short delay to ensure the last frame is captured
          setTimeout(resolve, 200);
        }
      }, 100);
    });
  }, []);

  const handleCreateVideo = async () => {
    if (clips.length === 0 || !playerRef.current) {
      setError('Please add at least one clip.');
      return;
    }
    setError(null);
    setFinishedVideoUrl(null);
    setIsProcessing(true);
    setProcessingStatus('Action Required: Please select THIS tab in the screen share prompt.');

    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    
    const visibilityHandler = () => {
        if (document.visibilityState === 'hidden') {
            if(recorder?.state === 'recording') {
                recorder.stop();
            }
            if (stream) {
               stream.getTracks().forEach(track => track.stop());
            }
            document.removeEventListener('visibilitychange', visibilityHandler);
            setError("Recording stopped: you switched away from the tab. Please stay on this tab during the entire recording process.");
            setIsProcessing(false);
        }
    };

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
        },
        audio: true,
      });

      document.addEventListener('visibilitychange', visibilityHandler);

      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recordedChunks.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.current.push(event.data);
        }
      };
      
      recorder.onstop = () => {
        document.removeEventListener('visibilitychange', visibilityHandler);
        // Only process video if there are chunks. Avoids error on early stop.
        if (recordedChunks.current.length > 0) {
            const blob = new Blob(recordedChunks.current, { type: 'video/webm' });
            const videoUrl = URL.createObjectURL(blob);
            setFinishedVideoUrl(videoUrl);
            setProcessingStatus('Done!');
        }
        setIsProcessing(false);
        stream?.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      
      const player = playerRef.current;
      if (player.isMuted()) {
        player.unMute();
      }
      player.setVolume(100);

      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        setProcessingStatus(`Recording clip ${i + 1} of ${clips.length} (${formatTime(clip.start)} - ${formatTime(clip.end)})`);
        await playSegment(player, clip.start, clip.end);
      }

      if (recorder.state === 'recording') {
        recorder.stop();
      }
    } catch (err) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      console.error('Error during video creation:', err);
      let errorMessage = 'An unknown error occurred during video capture.';
       if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          errorMessage = 'Permission to share screen was denied. Please try again and grant the necessary permissions.';
        } else {
          errorMessage = `Could not start screen capture: ${err.message}`;
        }
      } else if (err instanceof Error) {
        errorMessage = `An error occurred: ${err.message}`;
      }
      setError(errorMessage);
      setIsProcessing(false);
    }
  };

  const opts = {
    height: '390',
    width: '640',
    playerVars: {
      autoplay: 0,
      controls: 1,
    },
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      {isProcessing && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-50">
          <LoaderIcon className="w-16 h-16 animate-spin text-indigo-400" />
          <p className="text-xl mt-4 font-semibold text-center px-4">{processingStatus}</p>
          <p className="text-sm mt-2 text-gray-400">Please keep this tab in the foreground.</p>
        </div>
      )}
      <main className="container mx-auto p-4 md:p-8 max-w-4xl">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500">
            YouTube Video Clipper
          </h1>
          <p className="mt-2 text-gray-400">Create short clips from YouTube videos, right in your browser.</p>
        </header>

        <section className="bg-gray-800 rounded-lg p-6 shadow-lg mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-gray-200">1. Enter YouTube URL</h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              className="flex-grow bg-gray-700 text-white rounded-md px-4 py-2 border border-gray-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <button
              onClick={handleLoadVideo}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-md transition duration-300 ease-in-out flex items-center justify-center gap-2"
            >
              <PlayIcon className="w-5 h-5" />
              Load Video
            </button>
          </div>
        </section>

        {videoId && (
          <>
            <section className="mb-8">
                <div className="aspect-w-16 aspect-h-9 bg-gray-800 rounded-lg overflow-hidden shadow-lg mx-auto max-w-2xl">
                   <YouTube videoId={videoId} opts={opts} onReady={onPlayerReady} className="w-full h-full" iframeClassName="w-full h-full"/>
                </div>
            </section>

            <section className="bg-gray-800 rounded-lg p-6 shadow-lg mb-8">
              <h2 className="text-2xl font-semibold mb-4 text-gray-200">2. Define Clips</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <div className="flex flex-col">
                  <label htmlFor="start-time" className="mb-1 text-sm font-medium text-gray-400">Start Time</label>
                  <div className="flex items-center gap-2">
                    <input
                      id="start-time"
                      type="text"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      placeholder="MM:SS"
                      className="w-full bg-gray-700 text-white rounded-md px-4 py-2 border border-gray-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                    <button onClick={() => handleSetTimeFromPlayer('start')} title="Set from player" className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md border border-gray-600 text-gray-300 transition-colors">
                        <TargetIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-col">
                  <label htmlFor="end-time" className="mb-1 text-sm font-medium text-gray-400">End Time</label>
                  <div className="flex items-center gap-2">
                    <input
                      id="end-time"
                      type="text"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      placeholder="MM:SS"
                      className="w-full bg-gray-700 text-white rounded-md px-4 py-2 border border-gray-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                    <button onClick={() => handleSetTimeFromPlayer('end')} title="Set from player" className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md border border-gray-600 text-gray-300 transition-colors">
                        <TargetIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div className="md:col-span-2 flex flex-col sm:flex-row gap-4">
                    <button
                      onClick={handleAddClip}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-md transition duration-300 ease-in-out flex items-center justify-center gap-2"
                    >
                      <PlusIcon className="w-5 h-5" />
                      Add Clip
                    </button>
                    <button
                      onClick={handleSaveClips}
                      disabled={clips.length === 0}
                      className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-6 rounded-md transition duration-300 ease-in-out flex items-center justify-center gap-2 disabled:bg-gray-600 disabled:cursor-not-allowed"
                    >
                      <SaveIcon className="w-5 h-5" />
                      {saveStatus || 'Save Clips'}
                    </button>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-lg font-medium mb-3 text-gray-300">Clip Queue</h3>
                {clips.length === 0 ? (
                  <p className="text-gray-500 text-center py-4 border-2 border-dashed border-gray-700 rounded-md">No clips added yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {clips.map((clip, index) => (
                      <li key={clip.id} className="flex items-center justify-between bg-gray-700 p-3 rounded-md">
                        <div className="flex items-center gap-4">
                            <span className="font-mono text-sm bg-gray-800 text-indigo-300 px-2 py-1 rounded">{index + 1}</span>
                            <p className="font-medium">{formatTime(clip.start)} &rarr; {formatTime(clip.end)}</p>
                            <span className="text-gray-400 text-sm">({formatTime(clip.end - clip.start)})</span>
                        </div>
                        <button onClick={() => handleRemoveClip(clip.id)} className="text-red-400 hover:text-red-300">
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="bg-gray-800 rounded-lg p-6 shadow-lg">
              <h2 className="text-2xl font-semibold mb-4 text-gray-200">3. Create & Download</h2>
              <div className="text-center">
                <button
                  onClick={handleCreateVideo}
                  disabled={clips.length === 0 || isProcessing}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-8 rounded-md transition duration-300 ease-in-out text-lg disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center gap-3 w-full sm:w-auto mx-auto"
                >
                  <DownloadIcon className="w-6 h-6" />
                  Create & Download Video
                </button>
                <p className="text-xs text-gray-500 mt-3">This will ask for permission to record your tab.</p>
              </div>

              {finishedVideoUrl && (
                <div className="mt-8 p-4 bg-green-900/50 border border-green-500 rounded-lg text-center">
                    <h3 className="text-xl font-semibold text-green-300 mb-3">Your video is ready!</h3>
                    <video src={finishedVideoUrl} controls className="max-w-sm mx-auto rounded-md mb-4"></video>
                    <a
                      href={finishedVideoUrl}
                      download={`youtube-clip-${videoId}.webm`}
                      className="inline-block bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-md transition duration-300"
                    >
                      Download .webm
                    </a>
                </div>
              )}
            </section>
          </>
        )}
        
        {error && (
            <div className="fixed bottom-5 right-5 bg-red-800 text-white p-4 rounded-lg shadow-lg max-w-sm flex items-start gap-4" role="alert">
                <div className="flex-grow">
                    <p className="font-bold">Error</p>
                    <p>{error}</p>
                </div>
                <button onClick={() => setError(null)} aria-label="Dismiss" className="p-1 -m-1 rounded-full hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-white">
                  <CloseIcon className="h-5 w-5" />
                </button>
            </div>
        )}

      </main>
    </div>
  );
};

export default App;