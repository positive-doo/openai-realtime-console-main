/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */

// Check if we're using the local relay server first

const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '@djordjethai/positive-realtime';
import { ItemType } from '@djordjethai/positive-realtime/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions, touristInstructions, positiveInstructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, ArrowUp, ArrowDown } from 'react-feather';
import { Button } from '../components/button/Button';
import { Toggle } from '../components/toggle/Toggle';
import { Map } from '../components/Map';
import MicIcon from '@mui/icons-material/Mic'
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import './ConsolePage.scss';
import { isJsxOpeningLikeElement } from 'typescript';

/**
 * Type for result from get_weather() function call
 */
interface Coordinates {
  lat: number;
  lng: number;
  location?: string;
  temperature?: {
    value: number;
    units: string;
  };
  wind_speed?: {
    value: number;
    units: string;
  };
}

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

export function ConsolePage() {
  /**
   * Ask user for API Key or
   * If we're using the local relay server, we don't need this
   */
  // Define the getImageSrc function here
  

  const apiKey = LOCAL_RELAY_SERVER_URL.trim() !== ''
    ? '' // If relay server is used, skip the API key
    : process.env.REACT_APP_OPENAI_API_KEY || 
      localStorage.getItem('tmp::voice_api_key') || 
      prompt('Unesite OpenAI API Key') || '';
  
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }
  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
            apiKey: apiKey,
            dangerouslyAllowAPIKeyInBrowser: true,
          }
    )
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   * - coords, marker are for get_weather() function
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('coral');
  const [selectedTemplate, setSelectedTemplate] = useState(""); // Track the selected template
  const [editableInstructions, setEditableInstructions] = useState(""); // Instructions that user can edit
  const [canPushToTalk, setCanPushToTalk] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [memoryKv, setMemoryKv] = useState<{ [key: string]: any }>({});
  const [coords, setCoords] = useState<Coordinates | null>({
    lat: 37.775593,
    lng: -122.418137,
  });
  const [marker, setMarker] = useState<Coordinates | null>(null);
  const combinedInstructions = `${instructions} ${editableInstructions}`;
  
  /**
   * Utility for formatting the timing of logs
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * When you click the API key
   */
  
  const resetAPIKey = useCallback(() => {
    const newApiKey = prompt('Unesite OpenAI API Key');
    if (newApiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', newApiKey);
      window.location.reload();
    }
  }, []);
  const handleVoiceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedVoice(event.target.value as "coral" | "sage" | "shimmer" | "alloy" | "echo");
  };
  const handleTemplateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTemplate(event.target.value);
    setEditableInstructions(event.target.value); // Optionally update editableInstructions based on template
  };
  
  const handleInstructionsChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditableInstructions(event.target.value);
  };
  
  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
   
  
    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());
  
    // Connect to microphone
    await wavRecorder.begin();
  
    // Connect to audio output
    await wavStreamPlayer.connect();
  
    // Connect to realtime API
    await client.connect();
  
    // Ensure that server_vad is set explicitly after connecting
    // await client.updateSession({
    //   turn_detection: { type: 'none' }
    // });
  
    client.sendUserMessageContent([
      {
        type: `input_text`,
        text: ` `,
      },
    ]);
  
    // Ensure that recording starts if VAD is set to 'server_vad'
    if (client.getTurnDetectionType() === 'server_vad') {
      setCanPushToTalk(false); // Disable manual mode
      setIsRecording(true);  // Ensure recording state is set
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  }, []);
  
  
  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);
    setMemoryKv({});
    setCoords({
      lat: 37.775593,
      lng: -122.418137,
    });
    setMarker(null);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = await wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      await client.cancelResponse(trackId, offset);
    }
    await wavRecorder.record((data) => client.appendInputAudio(data.mono));
  };

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    client.createResponse();
  };

  /**
   * Switch between Manual <> VAD mode for communication
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' },
    });
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    setCanPushToTalk(value === 'none');
  };

  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;
    
    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set voice (alloy, shimer, echo, coral, sage)
    client.updateSession({ voice: selectedVoice as "coral" | "sage" | "shimmer" | "alloy" | "echo" });
    //client.updateSession({ voice: 'coral' });
     // Set temperature (min 0.7)
    client.updateSession({ temperature: 0.8 });
     // Set instructions
    client.updateSession({ instructions: combinedInstructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    // Add tools
    client.addTool(
      {
        name: 'set_memory',
        description: 'Saves important data about the user into memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      async ({ key, value }: { [key: string]: any }) => {
        setMemoryKv((memoryKv) => {
          const newKv = { ...memoryKv };
          newKv[key] = value;
          return newKv;
        });
        return { ok: true };
      }
    );
    

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  } , [selectedVoice, combinedInstructions]);

 
  
  /**
   * Render the application
   */
  return (
    <div data-component="ConsolePage">
      <div className="content-top">
        <div className="content-title">
          <img src="/logo.png" alt="Logo" />
          <h2>Positive Realtime Audio Asistent</h2>
        </div>
      </div>
  
      <div className="content-main">
        <div className="content-logs">
          <div className="content-block conversation">
            <div className="content-block-body" data-conversation-content>
              {!items.length && (
                <div className="welcome-message">
                  <span>
                    Dobar dan, dobro došli u Positive Realtime Audio Asistenta. Povežite se pritiskom na ikonicu play i postavite pitanje...
                  </span>
                  <ul>
                    <li>Možete me prekinuti u svakom momentu i promeniti tok razgovora.</li>
                    <li>
                      Takođe, možete birati između automatskog i ručnog metoda postavljanja pitanja. U ručnom modu pritisnite ikonicu mikrofon i držite dok postavljate pitanje.
                    </li>
                  </ul>
  
                  <label htmlFor="voice-select" className="voice-select-label">Odaberite glas:</label>
                  <select
                    id="voice-select"
                    className="voice-select"
                    value={selectedVoice}
                    onChange={handleVoiceChange}
                  >
                    <option value="alloy">Alloy</option>
                    <option value="shimer">Shimer</option>
                    <option value="echo">Echo</option>
                    <option value="coral">Coral</option>
                    <option value="sage">Sage</option>
                  </select>
  
                  <label htmlFor="instructions-template" className="instructions-select-label">Odaberite template:</label>
                  <select
                    id="instructions-template"
                    className="voice-select"
                    value={selectedTemplate}
                    onChange={handleTemplateChange}
                  >
                    <option value={touristInstructions}>Turisticka agencija</option>
                    <option value={positiveInstructions}>Positive</option>
                  </select>
  
                  <label htmlFor="editable-instructions" className="editable-instructions-label">Editable Instructions:</label>
                  <textarea
                    id="editable-instructions"
                    value={editableInstructions}
                    onChange={handleInstructionsChange}
                    className="editable-instructions"
                    placeholder="Enter additional instructions here..."
                  />
                </div>
              )}
  
              {items.map((conversationItem) => (
                <div className="conversation-item" key={conversationItem.id}>
                  <div className={`speaker ${conversationItem.role}`}>
                    <div
                      className="close"
                      onClick={() => deleteConversationItem(conversationItem.id)}
                    >
                      <X />
                    </div>
                  </div>
  
                  {conversationItem.role === 'assistant' && (
                    <div className="assistant-avatar">
                      <img
                        src="/logo.png"
                        style={{ width: '35px', height: '35px', paddingRight: '5px' }}
                        alt="Assistant Avatar"
                      />
                    </div>
                  )}
  
                  <div className={`speaker-content ${conversationItem.role}`}>
                    {!conversationItem.formatted.tool &&
                      conversationItem.role === 'assistant' && (
                        <div>
                          {conversationItem.formatted.transcript ? (
                            conversationItem.formatted.transcript.split('**').map((part, index) =>
                              index % 2 === 1 ? <strong key={index}>{part}</strong> : part
                            )
                          ) : (
                            conversationItem.formatted.text
                          )}
                        </div>
                      )}
                    {conversationItem.formatted.file && (
                      <audio
                        src={conversationItem.formatted.file.url}
                        controls
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
  
          <div className="content-actions">
            <Toggle
              defaultValue={'none'}
              labels={['Ručno', 'Automatski']}
              values={['none', 'server_vad']}
              onChange={(_, value) => changeTurnEndType(value)}
            />
            <div className="spacer" />
  
            {isConnected && canPushToTalk && (
              <IconButton
                style={{ color: '#f33b4b', marginRight: '30px' }}
                disabled={!isConnected || !canPushToTalk}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
              >
                <MicIcon />
              </IconButton>
            )}
  
            <div className="spacer" />
            <IconButton
              style={{
                width: '40px',
                height: '40px',
                color: '#fff',
                borderRadius: '50%',
                border: '1px solid #f33b4b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#2a2a2a',
              }}
              onClick={isConnected ? disconnectConversation : connectConversation}
            >
              {isConnected ? <StopIcon /> : <PlayArrowIcon />}
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
