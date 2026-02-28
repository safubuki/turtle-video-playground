import React, { useState, useRef, useEffect, memo, useCallback } from 'react';
import { 
  Play, Pause, Square, Upload, Music, 
  Download, Volume2, VolumeX, Loader, RotateCcw, MonitorPlay, Trash2, 
  Sparkles, Mic, FileText, X, ArrowUp, ArrowDown, User, ChevronDown, 
  AlertCircle, Image as ImageIcon, Clock, Scissors, Timer, Lock, Unlock, Save, RefreshCw, CheckCircle, ZoomIn, Move, ChevronRight
} from 'lucide-react';

// --- 定数 ---
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const FPS = 30;
const apiKey = ""; 

// 利用可能なボイスリスト
const VOICE_OPTIONS = [
  { id: "Aoede", label: "女性 (明るめ)", desc: "親しみやすい標準的な声" },
  { id: "Kore", label: "女性 (落ち着いた)", desc: "穏やかで安心感のある声" },
  { id: "Puck", label: "男性 (ハキハキ)", desc: "クリアで聞き取りやすい声" },
  { id: "Fenrir", label: "男性 (低音・渋め)", desc: "深みのある力強い声" },
  { id: "Charon", label: "男性 (エネルギッシュ)", desc: "少し強めのしっかりした声" },
];

/**
 * トースト通知コンポーネント
 */
const Toast = ({ message, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 2000);
    return () => clearTimeout(timer);
  }, [onClose]);
  
  if (!message) return null;

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-xl z-[200] flex items-center gap-2 animate-bounce">
      <CheckCircle className="w-4 h-4" />
      <span className="text-sm font-bold">{message}</span>
    </div>
  );
};

/**
 * 動画/画像/音声リソースローダー
 * 画面内に配置し、透明度で隠すことでブラウザの描画停止を回避
 */
const MediaResourceLoader = memo(({ mediaItems, bgm, narration, onElementLoaded, onRefAssign, onSeeked }) => {
  const hiddenStyle = { 
    position: 'fixed', 
    top: 0, 
    left: 0, 
    width: '320px', 
    height: '240px', 
    opacity: 0.001, 
    pointerEvents: 'none',
    zIndex: -100,
    visibility: 'visible'
  };
  
  const audioStyle = { display: 'none' };

  const handleError = (e) => {
    const el = e.target;
    if (el) {
        console.warn("Resource error, retrying:", el.error);
        // エラー時は少し待ってリロード
        setTimeout(() => { try { el.load(); } catch(err){} }, 1000);
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden' }}>
      {/* 動画・画像 */}
      {mediaItems.map((v) => (
        <React.Fragment key={v.id}>
          {v.type === 'video' ? (
            <video 
              ref={(el) => onRefAssign(v.id, el)}
              src={v.url}
              onLoadedMetadata={(e) => onElementLoaded(v.id, e.target)}
              onSeeked={onSeeked} // シーク完了通知
              onError={handleError}
              preload="auto"
              playsInline
              webkit-playsinline="true"
              // crossOriginは削除 (ローカルBlob再生安定化)
              style={hiddenStyle}
            />
          ) : (
            <img 
              ref={(el) => onRefAssign(v.id, el)}
              src={v.url}
              alt="resource"
              onLoad={(e) => onElementLoaded(v.id, e.target)}
              style={hiddenStyle}
            />
          )}
        </React.Fragment>
      ))}

      {/* BGM用Audio要素 */}
      {bgm && (
        <audio
            ref={(el) => onRefAssign('bgm', el)}
            src={bgm.url}
            onLoadedMetadata={(e) => onElementLoaded('bgm', e.target)}
            onError={handleError}
            preload="auto"
            style={audioStyle}
        />
      )}

      {/* ナレーション用Audio要素 */}
      {narration && (
        <audio
            ref={(el) => onRefAssign('narration', el)}
            src={narration.url}
            onLoadedMetadata={(e) => onElementLoaded('narration', e.target)}
            onError={handleError}
            preload="auto"
            style={audioStyle}
        />
      )}
    </div>
  );
}, (prev, next) => {
    // 厳密な再レンダリング制御
    const itemsChanged = prev.mediaItems !== next.mediaItems; 
    const bgmChanged = prev.bgm?.url !== next.bgm?.url;
    const narrationChanged = prev.narration?.url !== next.narration?.url;
    // リロードキーの変更検知は親コンポーネントのkeyで行うため、ここではデータの変更のみを監視
    return !itemsChanged && !bgmChanged && !narrationChanged;
});


const TurtleVideo = () => {
  // --- State ---
  const [mediaItems, setMediaItems] = useState([]); 
  const [bgm, setBgm] = useState(null);
  const [narration, setNarration] = useState(null);
  
  const [reloadKey, setReloadKey] = useState(0);
  const [toastMessage, setToastMessage] = useState(null);

  // ロック機能
  const [isClipsLocked, setIsClipsLocked] = useState(false);
  const [isBgmLocked, setIsBgmLocked] = useState(false);
  const [isNarrationLocked, setIsNarrationLocked] = useState(false);

  // Ref
  const mediaItemsRef = useRef([]); 
  const bgmRef = useRef(null);
  const narrationRef = useRef(null);
  const totalDurationRef = useRef(0);
  const currentTimeRef = useRef(0); // 描画ループ内で使用

  // 再生制御
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [exportUrl, setExportUrl] = useState(null);
  const [exportExt, setExportExt] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // AI Modal
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiScript, setAiScript] = useState("");
  const [aiVoice, setAiVoice] = useState("Aoede");
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  // --- Refs (エンジン用) ---
  const canvasRef = useRef(null);
  const mediaElementsRef = useRef({}); 
  const audioCtxRef = useRef(null);   
  
  // Audio Nodes
  const sourceNodesRef = useRef({});  
  const gainNodesRef = useRef({});    
  
  const masterDestRef = useRef(null); 
  const reqIdRef = useRef(null);      
  const startTimeRef = useRef(0);     
  const recorderRef = useRef(null);   

  // --- State Sync ---
  useEffect(() => {
    mediaItemsRef.current = mediaItems;
    const total = mediaItems.reduce((acc, v) => acc + (Number.isFinite(v.duration) ? v.duration : 0), 0);
    setTotalDuration(total);
    totalDurationRef.current = total;
    
    // 現在時刻同期
    currentTimeRef.current = currentTime;

    // 編集操作時、再生中でなければ現在のフレームを再描画 (プレビュー更新)
    if (mediaItems.length > 0 && !isPlaying && !isProcessing) {
        requestAnimationFrame(() => renderFrame(currentTime, false));
    }
  }, [mediaItems, reloadKey]); // currentTimeは含めない（ループ防止）

  useEffect(() => {
    bgmRef.current = bgm;
  }, [bgm]);

  useEffect(() => {
    narrationRef.current = narration;
  }, [narration]);

  // タブ復帰時の自動リフレッシュ
  useEffect(() => {
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            requestAnimationFrame(() => renderFrame(currentTimeRef.current, false));
            // 停止中の要素をリロードしてブラックアウト防止
            Object.values(mediaElementsRef.current).forEach(el => {
                if ((el.tagName === 'VIDEO' || el.tagName === 'AUDIO') && el.readyState < 2) {
                   try { el.load(); } catch(e){}
                }
            });
        }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);


  // --- Audio Context ---
  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      masterDestRef.current = ctx.createMediaStreamDestination();
    }
    return audioCtxRef.current;
  };

  // --- Gemini API Helpers ---
  const pcmToWav = (pcmData, sampleRate) => {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (view, offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); 
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const pcmView = new Uint8Array(pcmData);
    const wavView = new Uint8Array(buffer, 44);
    wavView.set(pcmView);

    return buffer;
  };

  const generateScript = async () => {
    if (!aiPrompt) return;
    setIsAiLoading(true);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `以下のテーマで、短い動画用のナレーション原稿を日本語で作成してください。文字数は100文字以内で、自然な話し言葉にしてください。\n\nテーマ: ${aiPrompt}\n\n【重要】出力には挨拶や「原稿案:」などの見出しを含めず、ナレーションで読み上げるセリフのテキストのみを出力してください。` }] }]
        })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) setAiScript(text.trim());
    } catch (e) {
      console.error(e);
      setErrorMsg("スクリプト生成に失敗しました");
    } finally {
      setIsAiLoading(false);
    }
  };

  const generateSpeech = async () => {
    if (!aiScript) return;
    setIsAiLoading(true);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aiScript }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: aiVoice }
              }
            }
          }
        })
      });
      
      const data = await response.json();
      const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      
      if (inlineData) {
        const binaryString = window.atob(inlineData.data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const wavBuffer = pcmToWav(bytes.buffer, 24000);
        const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
        const blobUrl = URL.createObjectURL(wavBlob);

        // Duration取得のために一時Audio
        const audio = new Audio(blobUrl);
        audio.onloadedmetadata = () => {
             const voiceLabel = VOICE_OPTIONS.find(v => v.id === aiVoice)?.label || "AI音声";
             setNarration({
              file: { name: `AIナレーション_${voiceLabel}.wav` },
              url: blobUrl, 
              blobUrl: blobUrl,
              startPoint: 0,
              delay: 0,
              volume: 1.0,
              fadeIn: false,
              fadeOut: false,
              duration: audio.duration, 
              isAi: true
            });
            setShowAiModal(false);
            setErrorMsg(null);
        };
      }
    } catch (e) {
      console.error(e);
      setErrorMsg("音声生成に失敗しました");
    } finally {
      setIsAiLoading(false);
    }
  };

  // --- アップロード処理 ---
  const handleMediaUpload = (e) => {
    try {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        e.target.value = ''; 
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume().catch(console.error);
        setExportUrl(null);
        const newItems = files.map(file => {
          const isImage = file.type.startsWith('image');
          return {
            id: Math.random().toString(36).substr(2, 9),
            file,
            type: isImage ? 'image' : 'video',
            url: URL.createObjectURL(file),
            volume: 1.0,
            isMuted: false,
            fadeIn: false,
            fadeOut: false,
            duration: isImage ? 5 : 0, 
            originalDuration: 0,
            trimStart: 0,
            trimEnd: 0,
            scale: 1.0,
            positionX: 0,
            positionY: 0,
            isTransformOpen: false,
            isLocked: false 
          };
        });
        setMediaItems(prev => [...prev, ...newItems]);
    } catch (err) {
        setErrorMsg("メディアの読み込みエラー");
    }
  };

  // MediaResourceLoaderコールバック
  const handleMediaElementLoaded = useCallback((id, element) => {
    if (element.tagName === 'VIDEO') {
        const duration = element.duration;
        if (!isNaN(duration) && duration !== Infinity) {
            setMediaItems(prev => prev.map(v => {
                if (v.id === id) {
                    const isInitialized = v.originalDuration > 0;
                    const newTrimStart = isInitialized ? v.trimStart : 0;
                    const newTrimEnd = (isInitialized && v.trimEnd > 0) ? v.trimEnd : duration;
                    const newDuration = newTrimEnd - newTrimStart;
                    return { 
                        ...v, 
                        originalDuration: duration,
                        trimStart: newTrimStart,
                        trimEnd: newTrimEnd,
                        duration: newDuration > 0 ? newDuration : duration
                    };
                }
                return v;
            }));
        }
    }
  }, []);

  const handleMediaRefAssign = useCallback((id, element) => {
      if(element) {
          mediaElementsRef.current[id] = element;
          
          if (element.tagName === 'VIDEO' || element.tagName === 'AUDIO') {
              try {
                  const ctx = getAudioContext();
                  if (!sourceNodesRef.current[id]) {
                      const source = ctx.createMediaElementSource(element);
                      const gain = ctx.createGain();
                      source.connect(gain);
                      gain.connect(ctx.destination); 
                      gain.gain.setValueAtTime(1, ctx.currentTime);
                      sourceNodesRef.current[id] = source;
                      gainNodesRef.current[id] = gain;
                  }
              } catch (e) {}
          }
      } else {
          delete mediaElementsRef.current[id];
      }
  }, []);
  
  // シーク完了時に再描画をキックするハンドラ
  const handleSeeked = useCallback(() => {
     // 現在の時間で強制的に再描画 (シーク後の黒画面対策)
     requestAnimationFrame(() => renderFrame(currentTimeRef.current, false));
  }, []); 

  const updateImageDuration = (id, newDuration) => {
    let val = parseFloat(newDuration);
    if (isNaN(val) || val < 0.5) val = 0.5; 
    setMediaItems(prev => prev.map(v => v.id === id ? { ...v, duration: val } : v));
  };

  const updateVideoTrim = (id, type, value) => {
    setMediaItems(prev => prev.map(item => {
        if (item.id !== id) return item;
        let val = parseFloat(value);
        if (isNaN(val)) val = 0;
        let newStart = item.trimStart;
        let newEnd = item.trimEnd;
        const max = item.originalDuration;

        if (type === 'start') {
            newStart = Math.min(Math.max(0, val), newEnd - 0.1);
        } else {
            newEnd = Math.max(Math.min(max, val), newStart + 0.1);
        }
        
        const el = mediaElementsRef.current[id];
        if (el && el.tagName === 'VIDEO') {
            const seekTime = type === 'start' ? newStart : Math.max(newStart, newEnd - 0.1);
            if (Number.isFinite(seekTime)) {
                // トリミング時は即座にシークしてプレビュー
                el.currentTime = Math.max(0, Math.min(max, seekTime));
            }
        }

        return { ...item, trimStart: newStart, trimEnd: newEnd, duration: newEnd - newStart };
    }));
  };

  const updateMediaScale = (id, value) => {
      let val = parseFloat(value);
      if (isNaN(val)) val = 1.0;
      val = Math.min(Math.max(val, 0.5), 3.0); 
      setMediaItems(prev => prev.map(v => v.id === id ? { ...v, scale: val } : v));
  };

  const updateMediaPosition = (id, axis, value) => {
      let val = parseFloat(value);
      if (isNaN(val)) val = 0;
      val = Math.min(Math.max(val, -1280), 1280);
      setMediaItems(prev => prev.map(v => {
          if (v.id === id) {
              if (axis === 'x') return { ...v, positionX: val };
              if (axis === 'y') return { ...v, positionY: val };
          }
          return v;
      }));
  };

  const toggleTransformPanel = (id) => {
      setMediaItems(prev => prev.map(v => v.id === id ? { ...v, isTransformOpen: !v.isTransformOpen } : v));
  };

  const resetMediaSetting = (id, type) => {
      setMediaItems(prev => prev.map(v => {
          if (v.id === id) {
              if (type === 'scale') return { ...v, scale: 1.0 };
              if (type === 'x') return { ...v, positionX: 0 };
              if (type === 'y') return { ...v, positionY: 0 };
          }
          return v;
      }));
  };

  const toggleMediaLock = (id) => {
      setMediaItems(prev => prev.map(v => v.id === id ? { ...v, isLocked: !v.isLocked } : v));
  };

  const handleBgmUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setExportUrl(null);
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
        setBgm({
          file,
          url,
          startPoint: 0, 
          delay: 0,
          volume: 0.5,
          fadeIn: false,
          fadeOut: false,
          duration: audio.duration,
          isAi: false
        });
    };
  };

  const handleNarrationUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setExportUrl(null);
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
        setNarration({
          file,
          url,
          startPoint: 0,
          delay: 0,
          volume: 1.0,
          fadeIn: false,
          fadeOut: false,
          duration: audio.duration,
          isAi: false
        });
    };
  };

  const updateTrackStart = (type, val) => {
      let numVal = parseFloat(val);
      if (isNaN(numVal)) numVal = 0;
      
      if (type === 'bgm' && bgm) {
          const safeVal = Math.max(0, Math.min(bgm.duration, numVal));
          setBgm(prev => ({ ...prev, startPoint: safeVal }));
      } else if (type === 'narration' && narration) {
          const safeVal = Math.max(0, Math.min(narration.duration, numVal));
          setNarration(prev => ({ ...prev, startPoint: safeVal }));
      }
  };

  const updateTrackDelay = (type, val) => {
      let numVal = parseFloat(val);
      if (isNaN(numVal)) numVal = 0;
      const safeVal = Math.max(0, numVal); 
      
      if (type === 'bgm' && bgm) {
          setBgm(prev => ({ ...prev, delay: safeVal }));
      } else if (type === 'narration' && narration) {
          setNarration(prev => ({ ...prev, delay: safeVal }));
      }
  };

  const updateTrackVolume = (type, val) => {
      let numVal = parseFloat(val);
      if (isNaN(numVal)) numVal = 0;
      if (type === 'bgm') setBgm(prev => ({ ...prev, volume: numVal }));
      if (type === 'narration') setNarration(prev => ({ ...prev, volume: numVal }));
  }

  const handleClearAll = () => {
    if (mediaItems.length === 0 && !bgm && !narration) return;
    stopAll();
    Object.values(sourceNodesRef.current).forEach(n => { try { n.disconnect(); } catch(e){} });
    Object.values(gainNodesRef.current).forEach(n => { try { n.disconnect(); } catch(e){} });
    sourceNodesRef.current = {};
    gainNodesRef.current = {};

    mediaItems.forEach(v => { URL.revokeObjectURL(v.url); });
    if(bgm?.url) URL.revokeObjectURL(bgm.url);
    if(narration?.url) URL.revokeObjectURL(narration.url);

    mediaItemsRef.current = [];
    mediaElementsRef.current = {};
    bgmRef.current = null;
    narrationRef.current = null;

    setMediaItems([]);
    setBgm(null);
    setNarration(null);
    setCurrentTime(0);
    setTotalDuration(0);
    setExportUrl(null);
    setExportExt(null);
    setErrorMsg(null);
    setIsPlaying(false);
    setIsProcessing(false);
    setIsClipsLocked(false);
    setIsBgmLocked(false);
    setIsNarrationLocked(false);
    setReloadKey(0); 
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  };

  const handleReloadResources = (targetTime = null) => {
    stopAll();
    setIsPlaying(false);
    setReloadKey(prev => prev + 1);
    sourceNodesRef.current = {};
    gainNodesRef.current = {};
    setToastMessage("リソースをリロードしました");
    setTimeout(() => setToastMessage(null), 2000);
    
    const t = targetTime !== null ? targetTime : currentTime;
    setTimeout(() => {
        renderFrame(t, false);
    }, 500);
  };

  // --- コアエンジン ---

  const stopAll = () => {
    if (reqIdRef.current) {
        cancelAnimationFrame(reqIdRef.current);
        reqIdRef.current = null;
    }
    
    setIsPlaying(false);
    setIsProcessing(false);

    Object.values(mediaElementsRef.current).forEach(el => {
        if(el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
            try { el.pause(); } catch(e){}
        }
    });

    const ctx = audioCtxRef.current;
    if (ctx) {
        Object.values(gainNodesRef.current).forEach(node => {
             try { node.gain.cancelScheduledValues(ctx.currentTime); } catch(e){}
        });
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
    }
  };

  const configureAudioRouting = (isExporting) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const dest = masterDestRef.current; 
    const target = isExporting ? dest : ctx.destination;

    Object.keys(gainNodesRef.current).forEach(id => {
      const gain = gainNodesRef.current[id];
      try { gain.disconnect(); gain.connect(target); } catch(e){}
    });
  };

  const startEngine = async (fromTime, isExportMode) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    stopAll();
    setIsPlaying(!isExportMode);
    setIsProcessing(isExportMode);
    setExportUrl(null);
    setExportExt(null);
    
    configureAudioRouting(isExportMode);
    
    if (!isExportMode) {
        Object.values(mediaElementsRef.current).forEach(el => {
            if ((el.tagName === 'VIDEO' || el.tagName === 'AUDIO') && el.readyState === 0) {
                 try { el.load(); } catch(e){}
            }
        });
    }

    if (isExportMode) {
        setCurrentTime(0);
        Object.values(mediaElementsRef.current).forEach(el => {
             if(el.tagName === 'VIDEO') {
                 try { el.currentTime = 0; } catch(e){}
             }
        });
        await new Promise(r => setTimeout(r, 200));
        renderFrame(0, false, true); 
        await new Promise(r => setTimeout(r, 100));
    } else {
        await new Promise(r => setTimeout(r, 50)); 
    }
    
    startTimeRef.current = Date.now() - (fromTime * 1000);
    
    if (isExportMode) {
      const canvasStream = canvasRef.current.captureStream(FPS);
      const audioStream = masterDestRef.current.stream;
      const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()]);
      
      let mimeType = 'video/webm';
      let extension = 'webm';
      if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) {
          mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'; extension = 'mp4';
      } else if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4'; extension = 'mp4';
      }
        
      const chunks = [];
      const rec = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 5000000 });
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          setExportUrl(URL.createObjectURL(blob));
          setExportExt(extension);
          setIsProcessing(false);
          setIsPlaying(false);
      };
      recorderRef.current = rec;
      rec.start();
    }

    loop(isExportMode);
  };

  const loop = (isExportMode) => {
    if (mediaItemsRef.current.length === 0) {
        stopAll();
        return;
    }
    const now = Date.now();
    const elapsed = (now - startTimeRef.current) / 1000;
    
    if (elapsed >= totalDuration) {
      stopAll();
      if(!isExportMode) setIsPlaying(false);
      return;
    }
    setCurrentTime(elapsed);
    renderFrame(elapsed, true, isExportMode); 
    reqIdRef.current = requestAnimationFrame(() => loop(isExportMode));
  };

  const renderFrame = (time, isActivePlaying = false, isExporting = false) => {
    try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const currentItems = mediaItemsRef.current;
        const currentBgm = bgmRef.current;
        const currentNarration = narrationRef.current;

        let t = 0;
        let activeId = null;
        let localTime = 0;
        let activeIndex = -1;

        for (let i=0; i<currentItems.length; i++) {
            const item = currentItems[i];
            if (time >= t && time < t + item.duration) {
                activeId = item.id;
                activeIndex = i;
                localTime = time - t;
                break;
            }
            t += item.duration;
        }

        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#000000'; 
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Preload (再生中のみ)
        if (isActivePlaying && activeIndex !== -1 && activeIndex + 1 < currentItems.length) {
            const nextItem = currentItems[activeIndex + 1];
            if (nextItem.type === 'video') {
                const remainingTime = currentItems[activeIndex].duration - localTime;
                if (remainingTime < 1.5) {
                    const nextElement = mediaElementsRef.current[nextItem.id];
                    if (nextElement && (nextElement.paused || nextElement.readyState < 2)) {
                        const nextStart = nextItem.trimStart || 0;
                        if (Math.abs(nextElement.currentTime - nextStart) > 0.1) {
                             nextElement.currentTime = nextStart;
                        }
                    }
                }
            }
        }

        Object.keys(mediaElementsRef.current).forEach(id => {
            if(id === 'bgm' || id === 'narration') return;

            const element = mediaElementsRef.current[id];
            const gainNode = gainNodesRef.current[id];
            const conf = currentItems.find(v => v.id === id);

            if (!element || !conf) return;

            if (id === activeId) {
                if (conf.type === 'video') {
                    const targetTime = (conf.trimStart || 0) + localTime;
                    
                    if (isActivePlaying) {
                        // 再生中はブラウザ任せ (カクつき対策)
                        // 大きなズレ(0.8s)のみ補正
                        if (Math.abs(element.currentTime - targetTime) > 0.8) {
                            element.currentTime = targetTime;
                        }
                        if (element.paused) element.play().catch(() => {});
                    } else {
                        // シークバー操作時などは厳密に合わせる (プレビュー黒画面対策)
                        if (!element.paused) element.pause();
                        if (Math.abs(element.currentTime - targetTime) > 0.01) {
                            element.currentTime = targetTime;
                        }
                    }
                }

                // 描画 (シーク中は準備完了していなくても描画を試みる)
                const isReady = conf.type === 'video' ? (element.readyState >= 1) : element.complete;
                if (isReady) {
                    const elemW = conf.type === 'video' ? element.videoWidth : element.naturalWidth;
                    const elemH = conf.type === 'video' ? element.videoHeight : element.naturalHeight;
                    if (elemW && elemH) {
                        const scaleFactor = conf.scale || 1.0;
                        const userX = conf.positionX || 0;
                        const userY = conf.positionY || 0;

                        const baseScale = Math.min(CANVAS_WIDTH / elemW, CANVAS_HEIGHT / elemH);
                        
                        ctx.save();
                        ctx.translate(CANVAS_WIDTH / 2 + userX, CANVAS_HEIGHT / 2 + userY);
                        ctx.scale(baseScale * scaleFactor, baseScale * scaleFactor);
                        
                        let alpha = 1.0;
                        if (conf.fadeIn && localTime < 1.0) alpha = localTime;
                        else if (conf.fadeOut && localTime > conf.duration - 1.0) alpha = conf.duration - localTime;
                        
                        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
                        ctx.drawImage(element, -elemW / 2, -elemH / 2, elemW, elemH);
                        ctx.restore();
                        ctx.globalAlpha = 1.0;
                    }
                }

                if (conf.type === 'video' && gainNode && audioCtxRef.current) {
                    if (isActivePlaying) {
                        let vol = conf.isMuted ? 0 : conf.volume;
                        if (conf.fadeIn && localTime < 1.0) vol *= localTime;
                        else if (conf.fadeOut && localTime > conf.duration - 1.0) vol *= (conf.duration - localTime);
                        gainNode.gain.setTargetAtTime(vol, audioCtxRef.current.currentTime, 0.05);
                    } else {
                         // シーク中はミュート (ノイズ防止)
                        gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
                    }
                }
            } else {
                if(conf.type === 'video' && element && !element.paused) {
                    element.pause();
                }
                if (conf.type === 'video' && gainNode && audioCtxRef.current) {
                    gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
                }
            }
        });

        // Audio Tracks
        const processAudioTrack = (track, trackId) => {
            const element = mediaElementsRef.current[trackId];
            const gainNode = gainNodesRef.current[trackId];
            
            if (track && element && gainNode && audioCtxRef.current) {
                if (isActivePlaying) {
                    if (time < track.delay) {
                        gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.01);
                        if (!element.paused) element.pause();
                    } else {
                        let vol = track.volume;
                        const trackTime = (time - track.delay) + track.startPoint;
                        const playDuration = time - track.delay; 

                        if (trackTime <= track.duration) {
                            if (Math.abs(element.currentTime - trackTime) > 0.5) {
                                element.currentTime = trackTime;
                            }
                            if (element.paused) element.play().catch(()=>{});

                            if (track.fadeIn && playDuration < 2.0) vol *= (playDuration / 2.0);
                            if (track.fadeOut && time > totalDuration - 2.0) vol *= Math.max(0, (totalDuration - time) / 2.0);
                            gainNode.gain.setTargetAtTime(vol, audioCtxRef.current.currentTime, 0.1);
                        } else {
                            gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
                            if (!element.paused) element.pause();
                        }
                    }
                } else {
                    gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
                    if (!element.paused) element.pause();
                    
                    // シーク操作時は位置だけ合わせておく
                    const trackTime = (time - track.delay) + track.startPoint;
                    if(trackTime >= 0 && trackTime <= track.duration) {
                        if (Math.abs(element.currentTime - trackTime) > 0.1) {
                            element.currentTime = trackTime;
                        }
                    }
                }
            }
        };

        processAudioTrack(currentBgm, 'bgm');
        processAudioTrack(currentNarration, 'narration');
    } catch (e) {
        console.error("Render Error:", e);
    }
  };

  const handleSeekChange = (e) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
    currentTimeRef.current = t; // Refも更新
    
    // 再生中は停止
    if (isPlaying) {
        setIsPlaying(false);
        stopAll();
    }
    
    // 即時描画 (isActivePlaying=false)
    // これによりシークバー操作中のプレビューが可能になる
    renderFrame(t, false);
  };
  
  const togglePlay = () => {
    if (isPlaying) {
      stopAll();
    } else {
      let startT = currentTime;
      if (startT >= totalDuration - 0.1 || startT < 0) startT = 0;
      startEngine(startT, false);
    }
  };

  const handleStop = () => {
    stopAll(); 
    setCurrentTime(0);
    // 停止時に強制リロード (設定維持)
    handleReloadResources(0);
  };

  const handleExport = () => {
    startEngine(0, true);
  };

  const formatTime = (s) => {
    if(!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const moveMedia = (idx, dir) => {
      const copy = [...mediaItems];
      const target = dir === 'up' ? idx - 1 : idx + 1;
      if (target >= 0 && target < copy.length) {
          [copy[idx], copy[target]] = [copy[target], copy[idx]];
          setMediaItems(copy);
      }
  };

  const removeMedia = (id) => {
      setMediaItems(prev => prev.filter(v => v.id !== id));
      delete mediaElementsRef.current[id];
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-24 select-none relative">
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      
      {/* 隠しリソースローダー */}
      <MediaResourceLoader 
        key={reloadKey}
        mediaItems={mediaItems} 
        bgm={bgm}
        narration={narration}
        onElementLoaded={handleMediaElementLoaded}
        onRefAssign={handleMediaRefAssign}
        onSeeked={handleSeeked} // シーク完了時再描画
      />

      {/* AI Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-800 border border-gray-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gradient-to-r from-purple-900/50 to-blue-900/50">
              <h3 className="font-bold flex items-center gap-2 text-white">
                <Sparkles className="w-5 h-5 text-yellow-400" /> AIナレーションスタジオ
              </h3>
              <button onClick={() => setShowAiModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">Step 1: テーマ入力</label>
                <div className="flex gap-2">
                   <input type="text" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="例: 京都旅行の動画" className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" />
                   <button onClick={generateScript} disabled={isAiLoading || !aiPrompt} className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1 disabled:opacity-50">
                     {isAiLoading ? <Loader className="w-4 h-4 animate-spin"/> : <FileText className="w-4 h-4"/>} 作成
                   </button>
                </div>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">Step 2: 原稿編集</label>
                  <textarea value={aiScript} onChange={(e) => setAiScript(e.target.value)} className="w-full h-24 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500 resize-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">声の選択</label>
                   <div className="relative">
                     <select value={aiVoice} onChange={(e) => setAiVoice(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 pr-10 text-sm appearance-none focus:outline-none focus:border-blue-500 text-gray-100">
                       {VOICE_OPTIONS.map(v => (<option key={v.id} value={v.id}>{v.label} - {v.desc}</option>))}
                     </select>
                     <ChevronDown className="w-4 h-4 absolute inset-y-0 right-3 my-auto text-gray-400 pointer-events-none" />
                   </div>
                </div>
              </div>
              <button onClick={generateSpeech} disabled={isAiLoading || !aiScript} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 transition-all">
                {isAiLoading ? <Loader className="w-5 h-5 animate-spin"/> : <Mic className="w-5 h-5"/>} 音声を生成して追加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-4 py-3 flex items-center justify-center shadow-lg">
        <div className="flex items-center gap-2">
          <div className="bg-green-600 p-1.5 rounded-lg"><span className="text-xl">🐢</span></div>
          <h1 className="font-bold text-lg whitespace-nowrap">タートルビデオ <span className="text-xs bg-purple-600 px-1.5 py-0.5 rounded ml-1">AI</span></h1>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4 space-y-6">
        {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/50 p-3 rounded text-sm text-red-200 flex justify-between items-center">
                <span>{errorMsg}</span>
                <button onClick={() => setErrorMsg(null)}><Trash2 className="w-3 h-3"/></button>
            </div>
        )}

        {/* 1. CLIPS */}
        <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
          <div className="p-4 bg-gray-850 border-b border-gray-800 flex justify-between items-center">
            <h2 className="font-bold flex items-center gap-2 text-blue-400"><span className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center text-xs">1</span> クリップ</h2>
            <div className="flex items-center gap-2">
                <button onClick={() => setIsClipsLocked(!isClipsLocked)} className={`p-1.5 rounded transition ${isClipsLocked ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-400 hover:text-white'}`}>{isClipsLocked ? <Lock className="w-4 h-4"/> : <Unlock className="w-4 h-4"/>}</button>
                <label className={`cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition ${isClipsLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Upload className="w-3 h-3" /> 追加
                  <input type="file" multiple accept="video/*, image/*" className="hidden" onChange={handleMediaUpload} disabled={isClipsLocked} />
                </label>
            </div>
          </div>
          <div className="p-3 space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
             {mediaItems.length === 0 && <div className="text-center py-8 text-gray-600 text-xs border-2 border-dashed border-gray-800 rounded">動画または画像ファイルを追加してください</div>}
             {mediaItems.map((v, i) => (
                <div key={v.id} className="bg-gray-800 p-3 rounded-xl border border-gray-700/50 relative group">
                   <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2 overflow-hidden">
                         <span className="bg-gray-900 text-gray-500 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-mono">{i+1}</span>
                         {v.type === 'image' ? <ImageIcon className="w-3 h-3 text-yellow-500"/> : <MonitorPlay className="w-3 h-3 text-blue-500"/>}
                         <span className="text-xs font-medium truncate max-w-[140px] text-gray-300">{v.file.name}</span>
                         <button onClick={() => toggleMediaLock(v.id)} className={`p-1 rounded hover:bg-gray-700 ${v.isLocked ? 'text-red-400' : 'text-gray-500'}`}>{v.isLocked ? <Lock className="w-3 h-3"/> : <Unlock className="w-3 h-3"/>}</button>
                      </div>
                      <div className="flex gap-1">
                         <button onClick={() => moveMedia(i, 'up')} disabled={i===0 || isClipsLocked || v.isLocked} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 disabled:opacity-30"><ArrowUp className="w-3 h-3"/></button>
                         <button onClick={() => moveMedia(i, 'down')} disabled={i===mediaItems.length-1 || isClipsLocked || v.isLocked} className="p-1.5 hover:bg-gray-700 rounded text-gray-400 disabled:opacity-30"><ArrowDown className="w-3 h-3"/></button>
                         <button onClick={() => removeMedia(v.id)} disabled={isClipsLocked || v.isLocked} className="p-1.5 hover:bg-red-900/30 text-red-400 rounded disabled:opacity-30"><Trash2 className="w-3 h-3"/></button>
                      </div>
                   </div>

                   {/* 動画トリミングUI */}
                   {v.type === 'video' && (
                     <div className="bg-black/30 p-2 rounded mb-2 border border-gray-700/50">
                       <div className="flex items-center gap-2 mb-1 text-[10px] text-gray-400"><Scissors className="w-3 h-3" /><span>トリミング: {v.trimStart.toFixed(1)}s - {v.trimEnd.toFixed(1)}s</span></div>
                       <div className="flex items-center gap-2 text-[10px]"><span className="text-gray-500 w-6">開始</span><input type="range" min="0" max={v.originalDuration} step="0.1" value={v.trimStart} onChange={(e) => updateVideoTrim(v.id, 'start', e.target.value)} disabled={isClipsLocked || v.isLocked} className="flex-1 accent-green-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"/></div>
                       <div className="flex items-center gap-2 text-[10px] mt-1"><span className="text-gray-500 w-6">終了</span><input type="range" min="0" max={v.originalDuration} step="0.1" value={v.trimEnd} onChange={(e) => updateVideoTrim(v.id, 'end', e.target.value)} disabled={isClipsLocked || v.isLocked} className="flex-1 accent-red-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"/></div>
                     </div>
                   )}

                   {/* 調整パネル開閉ボタン */}
                   <button 
                      onClick={() => toggleTransformPanel(v.id)} 
                      disabled={isClipsLocked || v.isLocked}
                      className="text-xs flex items-center gap-1 text-gray-400 hover:text-white mb-2 disabled:opacity-50"
                   >
                      {v.isTransformOpen ? <ChevronDown className="w-3 h-3"/> : <ChevronRight className="w-3 h-3"/>}
                      <span>位置・サイズ調整</span>
                   </button>

                   {/* 調整パネル (アコーディオン) */}
                   {v.isTransformOpen && (
                      <div className="px-2 mb-2 space-y-2 border-t border-gray-700/50 pt-2 mt-2 bg-gray-900/30 rounded p-2">
                        {/* 拡大率 */}
                        <div className="flex flex-col gap-1">
                           <div className="flex items-center justify-between text-[10px] text-gray-400">
                              <div className="flex items-center gap-1">
                                 <ZoomIn className="w-3 h-3" /> 拡大: {((v.scale || 1.0) * 100).toFixed(1)}%
                              </div>
                              <button onClick={() => resetMediaSetting(v.id, 'scale')} disabled={isClipsLocked || v.isLocked} title="リセット" className="hover:text-white disabled:opacity-30"><RotateCcw className="w-3 h-3"/></button>
                           </div>
                           
                           {/* 拡大微調整チェックボックス */}
                           <div className="flex items-center gap-2 px-1 mb-1">
                              <label className={`flex items-center gap-1.5 text-[10px] text-gray-300 cursor-pointer hover:text-white transition ${isClipsLocked || v.isLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                 <input 
                                   type="checkbox" 
                                   checked={Math.abs((v.scale || 1.0) - 1.025) < 0.001} 
                                   onChange={(e) => updateMediaScale(v.id, e.target.checked ? 1.025 : 1.0)}
                                   className="rounded accent-blue-500 w-3 h-3"
                                   disabled={isClipsLocked || v.isLocked}
                                 />
                                 <span>黒帯除去 (102.5%に拡大)</span>
                              </label>
                           </div>

                           <input 
                             type="range" 
                             min="0.5" 
                             max="3.0" 
                             step="0.001" 
                             value={v.scale || 1.0} 
                             onChange={(e) => updateMediaScale(v.id, e.target.value)} 
                             disabled={isClipsLocked || v.isLocked} 
                             className="w-full accent-blue-400 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"
                           />
                        </div>

                        {/* 横方向 */}
                        <div className="flex flex-col gap-1">
                           <div className="flex items-center justify-between text-[10px] text-gray-400">
                              <div className="flex items-center gap-1">
                                 <Move className="w-3 h-3" /> 横方向: {Math.round(v.positionX || 0)}
                              </div>
                              <button onClick={() => resetMediaSetting(v.id, 'x')} disabled={isClipsLocked || v.isLocked} title="リセット" className="hover:text-white disabled:opacity-30"><RotateCcw className="w-3 h-3"/></button>
                           </div>
                           <input 
                             type="range" 
                             min="-1280" 
                             max="1280" 
                             step="10" 
                             value={v.positionX || 0} 
                             onChange={(e) => updateMediaPosition(v.id, 'x', e.target.value)} 
                             disabled={isClipsLocked || v.isLocked} 
                             className="w-full accent-blue-400 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"
                           />
                        </div>

                        {/* 縦方向 */}
                        <div className="flex flex-col gap-1">
                           <div className="flex items-center justify-between text-[10px] text-gray-400">
                              <div className="flex items-center gap-1">
                                 <Move className="w-3 h-3" /> 縦方向: {Math.round(v.positionY || 0)}
                              </div>
                              <button onClick={() => resetMediaSetting(v.id, 'y')} disabled={isClipsLocked || v.isLocked} title="リセット" className="hover:text-white disabled:opacity-30"><RotateCcw className="w-3 h-3"/></button>
                           </div>
                           <input 
                             type="range" 
                             min="-720" 
                             max="720" 
                             step="10" 
                             value={v.positionY || 0} 
                             onChange={(e) => updateMediaPosition(v.id, 'y', e.target.value)} 
                             disabled={isClipsLocked || v.isLocked} 
                             className="w-full accent-blue-400 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"
                           />
                        </div>
                      </div>
                   )}

                   <div className="grid grid-cols-2 gap-2 text-[10px] bg-gray-900/50 p-2 rounded-lg">
                      {v.type === 'image' ? (
                        <div className="col-span-2 flex items-center gap-2">
                           <Clock className="w-3 h-3 text-gray-400" />
                           <span className="text-gray-400">表示時間:</span>
                           <input type="number" min="0.5" max="60" step="0.5" value={v.duration} onChange={(e) => updateImageDuration(v.id, e.target.value)} disabled={isClipsLocked || v.isLocked} className="w-12 bg-gray-700 rounded border border-gray-600 px-1 text-right focus:outline-none focus:border-blue-500 disabled:opacity-50"/>
                           <span className="text-gray-400">秒</span>
                           <input type="range" min="0.5" max="30" step="0.5" value={v.duration} onChange={(e) => updateImageDuration(v.id, e.target.value)} disabled={isClipsLocked || v.isLocked} className="flex-1 accent-yellow-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"/>
                        </div>
                      ) : (
                        <div className="col-span-2 flex items-center gap-2">
                           <button onClick={() => setMediaItems(prev => prev.map(item => item.id === v.id ? {...item, isMuted: !item.isMuted} : item))} disabled={isClipsLocked || v.isLocked} className={`p-1.5 rounded flex items-center gap-1 ${v.isMuted ? 'bg-red-500/20 text-red-300' : 'bg-gray-700 text-gray-300'} disabled:opacity-50`}>{v.isMuted ? <VolumeX className="w-3 h-3"/> : <Volume2 className="w-3 h-3"/>}</button>
                           <input type="range" min="0" max="1" step="0.1" value={v.volume} disabled={v.isMuted || isClipsLocked || v.isLocked} onChange={(e) => setMediaItems(prev => prev.map(item => item.id === v.id ? {...item, volume: parseFloat(e.target.value)} : item))} className="flex-1 accent-blue-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"/>
                        </div>
                      )}
                      <label className={`flex items-center gap-1 cursor-pointer hover:text-blue-300 ${isClipsLocked || v.isLocked ? 'opacity-50 pointer-events-none' : ''}`}><input type="checkbox" checked={v.fadeIn} onChange={e => setMediaItems(prev => prev.map(item => item.id===v.id?{...item, fadeIn: e.target.checked}:item))} disabled={isClipsLocked || v.isLocked} className="rounded accent-blue-500 w-3 h-3"/> フェードイン</label>
                      <label className={`flex items-center gap-1 cursor-pointer hover:text-blue-300 ${isClipsLocked ? 'opacity-50 pointer-events-none' : ''}`}><input type="checkbox" checked={v.fadeOut} onChange={e => setMediaItems(prev => prev.map(item => item.id===v.id?{...item, fadeOut: e.target.checked}:item))} disabled={isClipsLocked || v.isLocked} className="rounded accent-blue-500 w-3 h-3"/> フェードアウト</label>
                   </div>
                </div>
             ))}
          </div>
        </section>

        {/* 2. BGM SETTINGS */}
        <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
           <div className="p-4 bg-gray-850 border-b border-gray-800 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2 text-purple-400"><span className="w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center text-xs">2</span> BGM設定</h2>
              <div className="flex gap-2 items-center">
                <button onClick={() => setIsBgmLocked(!isBgmLocked)} className={`p-1.5 rounded transition ${isBgmLocked ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-400 hover:text-white'}`}>{isBgmLocked ? <Lock className="w-4 h-4"/> : <Unlock className="w-4 h-4"/>}</button>
                {!bgm ? (
                   <label className={`cursor-pointer bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${isBgmLocked ? 'opacity-50 pointer-events-none' : ''}`}><Upload className="w-3 h-3" /> 選択<input type="file" accept="audio/*" className="hidden" onChange={handleBgmUpload} disabled={isBgmLocked} /></label>
                ) : (
                   <button onClick={() => setBgm(null)} disabled={isBgmLocked} className="text-red-400 hover:text-red-300 text-xs px-2 disabled:opacity-50">削除</button>
                )}
              </div>
           </div>
           {bgm && (
             <div className="p-4 bg-purple-900/10 border border-purple-500/20 m-3 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-purple-200 text-xs font-medium truncate"><Music className="w-3 h-3 text-purple-400 shrink-0" /> {bgm.file.name}</div>
                <div className="space-y-1">
                   <div className="flex justify-between text-[10px] text-gray-400"><span>開始位置 (頭出し): {formatTime(bgm.startPoint)}</span><span>長さ: {formatTime(bgm.duration)}</span></div>
                   <div className="flex items-center gap-2">
                     <input type="range" min={0} max={bgm.duration} step="0.1" value={bgm.startPoint} onChange={e => updateTrackStart('bgm', e.target.value)} disabled={isBgmLocked} className="flex-1 accent-purple-500 h-1 bg-gray-700 rounded appearance-none cursor-pointer disabled:opacity-50"/>
                     <input type="number" min="0" max={bgm.duration} step="0.1" value={bgm.startPoint} onChange={e => updateTrackStart('bgm', e.target.value)} disabled={isBgmLocked} className="w-16 bg-gray-700 border border-gray-600 rounded px-1 text-[10px] text-right focus:outline-none focus:border-purple-500 disabled:opacity-50"/><span className="text-[10px] text-gray-500">秒</span>
                   </div>
                </div>
                <div className="bg-purple-900/30 p-2 rounded border border-purple-500/30 space-y-1">
                   <div className="flex items-center gap-2 text-[10px] text-purple-200"><Timer className="w-3 h-3" /><span>開始タイミング (遅延): {formatTime(bgm.delay || 0)}</span></div>
                   <div className="flex items-center gap-2">
                     <input type="range" min={0} max={totalDuration} step="0.5" value={bgm.delay || 0} onChange={e => updateTrackDelay('bgm', e.target.value)} disabled={isBgmLocked} className="flex-1 accent-purple-400 h-1 bg-gray-700 rounded appearance-none cursor-pointer disabled:opacity-50"/>
                     <input type="number" min="0" max={totalDuration} step="0.5" value={bgm.delay || 0} onChange={e => updateTrackDelay('bgm', e.target.value)} disabled={isBgmLocked} className="w-16 bg-gray-700 border border-gray-600 rounded px-1 text-[10px] text-right focus:outline-none focus:border-purple-400 disabled:opacity-50"/><span className="text-[10px] text-gray-500">秒</span>
                   </div>
                </div>
                <div className="flex items-center gap-2 bg-gray-800/50 p-2 rounded-lg">
                   <Volume2 className="w-3 h-3 text-gray-400"/><input type="range" min="0" max="1" step="0.1" value={bgm.volume} onChange={e => updateTrackVolume('bgm', e.target.value)} disabled={isBgmLocked} className="flex-1 accent-purple-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"/>
                </div>
                <div className="flex gap-3 text-[10px]">
                   <label className={`flex items-center gap-1 cursor-pointer ${isBgmLocked ? 'opacity-50 pointer-events-none' : ''}`}><input type="checkbox" checked={bgm.fadeIn} onChange={e=>setBgm(p=>({...p, fadeIn:e.target.checked}))} disabled={isBgmLocked} className="accent-purple-500 rounded"/> フェードイン</label>
                   <label className={`flex items-center gap-1 cursor-pointer ${isBgmLocked ? 'opacity-50 pointer-events-none' : ''}`}><input type="checkbox" checked={bgm.fadeOut} onChange={e=>setBgm(p=>({...p, fadeOut:e.target.checked}))} disabled={isBgmLocked} className="accent-purple-500 rounded"/> フェードアウト</label>
                </div>
             </div>
           )}
        </section>

        {/* 3. NARRATION SETTINGS */}
        <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
           <div className="p-4 bg-gray-850 border-b border-gray-800 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2 text-indigo-400"><span className="w-6 h-6 rounded-full bg-indigo-500/10 flex items-center justify-center text-xs">3</span> ナレーション</h2>
              <div className="flex gap-2 shrink-0 items-center">
                <button onClick={() => setIsNarrationLocked(!isNarrationLocked)} className={`p-1.5 rounded transition ${isNarrationLocked ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-400 hover:text-white'}`}>{isNarrationLocked ? <Lock className="w-4 h-4"/> : <Unlock className="w-4 h-4"/>}</button>
                <button onClick={() => setShowAiModal(true)} disabled={isNarrationLocked} className={`bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-lg ${isNarrationLocked ? 'opacity-50 pointer-events-none' : ''}`}><Sparkles className="w-3 h-3" /> AI</button>
                {!narration ? (
                   <label className={`cursor-pointer bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${isNarrationLocked ? 'opacity-50 pointer-events-none' : ''}`}><Upload className="w-3 h-3" /> 選択<input type="file" accept="audio/*" className="hidden" onChange={handleNarrationUpload} disabled={isNarrationLocked} /></label>
                ) : (
                   <button onClick={() => setNarration(null)} disabled={isNarrationLocked} className="text-red-400 hover:text-red-300 text-xs px-2 disabled:opacity-50">削除</button>
                )}
              </div>
           </div>
           {narration && (
             <div className="p-4 bg-indigo-900/10 border border-indigo-500/20 m-3 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2 text-indigo-200 text-xs font-medium truncate"><Mic className="w-3 h-3 text-indigo-400 shrink-0" /> {narration.file.name}</div>
                   {narration.blobUrl && (
                      <a href={narration.blobUrl} download={narration.file.name} className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded text-[10px] font-bold transition"><Save className="w-3 h-3" /> 保存</a>
                   )}
                </div>
                <div className="space-y-1">
                   <div className="flex justify-between text-[10px] text-gray-400"><span>開始位置 (頭出し): {formatTime(narration.startPoint)}</span><span>長さ: {formatTime(narration.duration)}</span></div>
                   <div className="flex items-center gap-2">
                     <input type="range" min={0} max={narration.duration} step="0.1" value={narration.startPoint} onChange={e => updateTrackStart('narration', e.target.value)} disabled={isNarrationLocked} className="flex-1 accent-indigo-500 h-1 bg-gray-700 rounded appearance-none cursor-pointer disabled:opacity-50"/>
                     <input type="number" min="0" max={narration.duration} step="0.1" value={narration.startPoint} onChange={e => updateTrackStart('narration', e.target.value)} disabled={isNarrationLocked} className="w-16 bg-gray-700 border border-gray-600 rounded px-1 text-[10px] text-right focus:outline-none focus:border-indigo-500 disabled:opacity-50"/><span className="text-[10px] text-gray-500">秒</span>
                   </div>
                </div>
                <div className="bg-indigo-900/30 p-2 rounded border border-indigo-500/30 space-y-1">
                   <div className="flex items-center gap-2 text-[10px] text-indigo-200"><Timer className="w-3 h-3" /><span>開始タイミング (遅延): {formatTime(narration.delay || 0)}</span></div>
                   <div className="flex items-center gap-2">
                     <input type="range" min={0} max={totalDuration} step="0.5" value={narration.delay || 0} onChange={e => updateTrackDelay('narration', e.target.value)} disabled={isNarrationLocked} className="flex-1 accent-indigo-400 h-1 bg-gray-700 rounded appearance-none cursor-pointer disabled:opacity-50"/>
                     <input type="number" min="0" max={totalDuration} step="0.5" value={narration.delay || 0} onChange={e => updateTrackDelay('narration', e.target.value)} disabled={isNarrationLocked} className="w-16 bg-gray-700 border border-gray-600 rounded px-1 text-[10px] text-right focus:outline-none focus:border-indigo-400 disabled:opacity-50"/><span className="text-[10px] text-gray-500">秒</span>
                   </div>
                </div>
                <div className="flex items-center gap-2 bg-gray-800/50 p-2 rounded-lg">
                   <Volume2 className="w-3 h-3 text-gray-400"/><input type="range" min="0" max="1" step="0.1" value={narration.volume} onChange={e => updateTrackVolume('narration', e.target.value)} disabled={isNarrationLocked} className="flex-1 accent-indigo-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"/>
                </div>
                <div className="flex gap-3 text-[10px]">
                   <label className={`flex items-center gap-1 cursor-pointer ${isNarrationLocked ? 'opacity-50 pointer-events-none' : ''}`}><input type="checkbox" checked={narration.fadeIn} onChange={e=>setNarration(p=>({...p, fadeIn:e.target.checked}))} disabled={isNarrationLocked} className="accent-indigo-500 rounded"/> フェードイン</label>
                   <label className={`flex items-center gap-1 cursor-pointer ${isNarrationLocked ? 'opacity-50 pointer-events-none' : ''}`}><input type="checkbox" checked={narration.fadeOut} onChange={e=>setNarration(p=>({...p, fadeOut:e.target.checked}))} disabled={isNarrationLocked} className="accent-indigo-500 rounded"/> フェードアウト</label>
                </div>
             </div>
           )}
        </section>

        {/* 4. PREVIEW */}
        <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
           <div className="p-3 border-b border-gray-800 bg-gray-850 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-green-400"><span className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center text-xs">4</span> プレビュー</h2>
              <div className="flex items-center gap-2">
                 <button onClick={handleReloadResources} title="プレビューを強制リロード" className="p-2 bg-gray-700 hover:bg-gray-600 rounded-full text-white transition shadow-sm"><RefreshCw className="w-4 h-4" /></button>
                 {isProcessing && <span className="text-[10px] text-green-400 font-mono animate-pulse bg-green-900/30 px-2 py-0.5 rounded">REC ●</span>}
              </div>
           </div>
           <div className="relative aspect-video bg-black w-full group">
              <canvas ref={canvasRef} width={1280} height={720} className="w-full h-full object-contain" />
              {mediaItems.length === 0 && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><MonitorPlay className="w-12 h-12 text-gray-800" /></div>}
              {!isPlaying && !isProcessing && mediaItems.length > 0 && <button onClick={togglePlay} className="absolute inset-0 m-auto w-14 h-14 bg-white/20 hover:bg-white/30 backdrop-blur rounded-full flex items-center justify-center text-white transition-transform active:scale-95"><Play className="w-6 h-6 fill-current ml-1" /></button>}
           </div>
           <div className="p-4 bg-gray-900 border-t border-gray-800">
              <div className="flex justify-between text-[10px] font-mono text-gray-400 mb-2"><span>{formatTime(currentTime)}</span><span>{formatTime(totalDuration)}</span></div>
              <div className="relative h-8 w-full select-none">
                 <div className="absolute top-3 w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="flex w-full h-full opacity-60">
                       {mediaItems.map((v, i) => (<div key={v.id} style={{ width: `${(v.duration / totalDuration) * 100}%` }} className={v.type === 'image' ? 'bg-yellow-600' : (i % 2 === 0 ? 'bg-blue-600' : 'bg-blue-500')}/>))}
                    </div>
                 </div>
                 <input type="range" min="0" max={totalDuration || 0.1} step="0.1" value={currentTime} onChange={handleSeekChange} className="absolute top-0 w-full h-full opacity-0 cursor-pointer z-10" disabled={mediaItems.length === 0 || isProcessing} />
                 <div className="absolute top-1.5 w-5 h-5 bg-white shadow-lg rounded-full pointer-events-none z-0 border-2 border-gray-200" style={{ left: `calc(${(currentTime / (totalDuration || 1)) * 100}% - 10px)` }} />
              </div>
              <div className="mt-4 flex justify-center gap-4 border-b border-gray-800 pb-6">
                 <button onClick={handleStop} disabled={mediaItems.length === 0} className="p-3 rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition shadow-lg disabled:opacity-50"><Square className="w-5 h-5 fill-current" /></button>
                 <button onClick={togglePlay} disabled={mediaItems.length === 0} className={`p-3 rounded-full transition shadow-lg ${isPlaying ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>{isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}</button>
              </div>
              <div className="mt-6 flex flex-col gap-4">
                 <div className="flex items-center justify-between gap-4">
                    <button onClick={handleClearAll} disabled={mediaItems.length === 0 && !bgm && !narration} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-red-900/20 hover:text-red-400 transition disabled:opacity-50 disabled:cursor-not-allowed"><RotateCcw className="w-4 h-4" /> 一括クリア</button>
                    {exportUrl ? (
                      <a href={exportUrl} download={`turtle_video_${Date.now()}.${exportExt}`} className="bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-full text-sm font-bold flex items-center gap-2 animate-bounce-short shadow-lg"><Download className="w-4 h-4" /> 保存 (.{exportExt})</a>
                    ) : (
                      <button onClick={handleExport} disabled={isProcessing || mediaItems.length === 0} className={`flex-1 max-w-xs flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-sm font-bold shadow-lg transition ${isProcessing ? 'bg-gray-700 text-gray-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'}`}>
                        {isProcessing ? <Loader className="animate-spin w-4 h-4"/> : <Download className="w-4 h-4" />}
                        {isProcessing ? '書き出し中...' : '書き出す'}
                      </button>
                    )}
                 </div>
                 {exportUrl && exportExt === 'webm' && <div className="bg-yellow-900/30 border border-yellow-700/50 p-3 rounded-lg flex items-start gap-2 text-xs text-yellow-200"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><div><p className="font-bold">重要: SNS投稿について</p><p>お使いのブラウザはMP4出力に非対応のため、互換性の高いWebM形式で保存しました。</p></div></div>}
              </div>
           </div>
        </section>
      </div>
    </div>
  );
};

export default TurtleVideo;