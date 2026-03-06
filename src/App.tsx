/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Send, 
  Bot, 
  User, 
  Sparkles, 
  Loader2, 
  PlusCircle, 
  MessageSquare,
  ChevronRight,
  Settings,
  MoreVertical,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

export default function App() {
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // Update sidebar state on resize - only if we want to force it open on large screens, 
  // but the user wants to see the chat, so let's keep it closed initially.
  useEffect(() => {
    const handleResize = () => {
      // We can keep it closed or open it on very large screens, 
      // but to respect the user's request "show the chat when u open", 
      // starting closed is safer.
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize with a new session if none exist
  useEffect(() => {
    if (sessions.length === 0) {
      createNewSession();
    }
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessions, isLoading]);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const createNewSession = () => {
    const newSession: ChatSession = {
      id: Math.random().toString(36).substring(7),
      title: 'New Chat',
      messages: [],
      createdAt: new Date(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setInput('');
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(filtered[0]?.id || null);
      }
      return filtered;
    });
    if (sessions.length <= 1) {
      createNewSession();
    }
  };

  const clearCurrentChat = () => {
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [], title: 'New Chat' };
      }
      return s;
    }));
  };

  const getApiKey = () => {
    const keys = [
      process.env.GEMINI_API_KEY,
      process.env.GOOGLE_API_KEY,
      process.env.API_KEY
    ];
    return keys.find(k => k && k !== 'MY_GEMINI_API_KEY') || null;
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading || !activeSessionId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    // Update session with user message
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        const updatedMessages = [...s.messages, userMessage];
        // Update title if it's the first message
        const title = s.messages.length === 0 ? userMessage.content.slice(0, 30) + (userMessage.content.length > 30 ? '...' : '') : s.title;
        return { ...s, messages: updatedMessages, title };
      }
      return s;
    }));

    setInput('');
    setIsLoading(true);

    const MAX_RETRIES = 2;
    const modelsToTry = ["gemini-flash-latest", "gemini-3-flash-preview", "gemini-3.1-pro-preview"];
    
    const attemptChat = async (retryCount = 0, modelIndex = 0): Promise<string> => {
      try {
        const apiKey = getApiKey();
        if (!apiKey) {
          throw new Error("API_KEY_MISSING");
        }

        const ai = new GoogleGenAI({ apiKey });
        const modelName = modelsToTry[modelIndex];
        
        const history = activeSession?.messages
          .filter(m => m.content && m.content.trim() !== "")
          .map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
          })) || [];

        const chat = ai.chats.create({
          model: modelName,
          history: history,
          config: {
            systemInstruction: "You are Bhavik AI, a highly resilient and intelligent AI assistant. Your goal is to provide helpful, accurate, and professional responses. If you encounter a technical limitation, explain it gracefully and offer an alternative solution. Your name is Bhavik AI.",
          },
        });

        const result = await chat.sendMessage({ message: userMessage.content });
        if (!result || !result.text) throw new Error("EMPTY_RESPONSE");
        return result.text;

      } catch (error: any) {
        console.error(`Attempt ${retryCount + 1} failed with model ${modelsToTry[modelIndex]}:`, error);
        
        // If it's an API key issue, don't retry, just fail fast
        if (error.message === "API_KEY_MISSING") throw error;

        // If we have retries left for the CURRENT model, try again after a short delay
        if (retryCount < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
          return attemptChat(retryCount + 1, modelIndex);
        }

        // If we've exhausted retries for the current model, try the NEXT model
        if (modelIndex < modelsToTry.length - 1) {
          return attemptChat(0, modelIndex + 1);
        }

        // If all models and retries fail, throw the original error
        throw error;
      }
    };

    try {
      const responseText = await attemptChat();

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: responseText,
        timestamp: new Date(),
      };

      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, messages: [...s.messages, aiMessage] };
        }
        return s;
      }));
    } catch (error: any) {
      console.error("Bhavik AI Final Failure:", error);
      
      let errorMessageContent = "I'm having some trouble connecting to my brain right now. Please check your internet connection or try again in a few seconds.";
      
      if (error.message === "API_KEY_MISSING") {
        errorMessageContent = "⚠️ **API Key Missing**: I need a Gemini API key to function. Please add it to the 'Secrets' panel in AI Studio.";
      } else if (error.message?.includes("quota") || error.message?.includes("429")) {
        errorMessageContent = "I've been talking a bit too much lately and hit my limit. Please wait a minute before we continue our conversation.";
      } else if (error.message === "EMPTY_RESPONSE") {
        errorMessageContent = "I processed your request but couldn't generate a text response. Could you try rephrasing your question?";
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: errorMessageContent,
        timestamp: new Date(),
      };
      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, messages: [...s.messages, errorMessage] };
        }
        return s;
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] overflow-hidden">
      {/* Sidebar - Mobile Overlay Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isSidebarOpen ? (window.innerWidth < 1024 ? '85%' : 280) : 0, 
          opacity: isSidebarOpen ? 1 : 0,
          x: isSidebarOpen ? 0 : -20
        }}
        className={cn(
          "h-full bg-zinc-900/95 lg:bg-zinc-900/30 border-r border-white/5 flex flex-col overflow-hidden z-50",
          "fixed lg:relative"
        )}
      >
        <div className="p-4 flex flex-col h-full">
          <button 
            onClick={createNewSession}
            className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all border border-white/5 text-sm font-medium mb-6"
          >
            <PlusCircle size={18} className="text-indigo-400" />
            New Chat
          </button>

          <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
            <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold px-2 mb-2">Recent Chats</h3>
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  setActiveSessionId(session.id);
                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 w-full p-3 rounded-xl transition-all group relative",
                  activeSessionId === session.id ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20" : "text-zinc-400 hover:bg-white/5"
                )}
              >
                <MessageSquare size={16} className={activeSessionId === session.id ? "text-indigo-400" : "text-zinc-500"} />
                <span className="text-sm truncate flex-1 text-left">{session.title}</span>
                <Trash2 
                  size={14} 
                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-opacity" 
                  onClick={(e) => deleteSession(session.id, e)}
                />
              </button>
            ))}
          </div>

          <div className="mt-auto pt-4 border-t border-white/5">
            <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 cursor-pointer transition-all">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold">
                B
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">Bhavik AI User</p>
                <p className="text-[10px] text-zinc-500 truncate">Free Tier</p>
              </div>
              <Settings size={16} className="text-zinc-500" />
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative h-full overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-4 md:px-6 bg-[#0a0a0a]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-3 md:gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 transition-all"
            >
              <ChevronRight className={cn("transition-transform", isSidebarOpen && "rotate-180")} size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Sparkles size={16} className="text-white md:hidden" />
                <Sparkles size={18} className="text-white hidden md:block" />
              </div>
              <h1 className="font-display font-bold text-base md:text-lg tracking-tight">
                Bhavik <span className="gradient-text">AI</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={clearCurrentChat}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 transition-all text-xs font-medium"
            >
              <Trash2 size={14} /> Clear Chat
            </button>
            <div className={cn(
              "hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full border",
              !getApiKey()
                ? "bg-red-500/10 border-red-500/20 text-red-500"
                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full animate-pulse",
                !getApiKey() ? "bg-red-500" : "bg-emerald-500"
              )} />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {!getApiKey() ? "API Key Missing" : "System Online"}
              </span>
            </div>
            <button className="p-2 hover:bg-white/5 rounded-lg text-zinc-400">
              <MoreVertical size={20} />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 custom-scrollbar"
        >
          {!getApiKey() && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-3xl mx-auto p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-4 text-red-200"
            >
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <Settings className="text-red-400" size={20} />
              </div>
              <div className="flex-1 text-sm">
                <p className="font-bold">Gemini API Key Required</p>
                <p className="opacity-80">To enable Bhavik AI, please add your API key to the <span className="font-bold">Secrets</span> panel in the AI Studio sidebar. Use the name <span className="font-mono bg-white/10 px-1 rounded">GEMINI_API_KEY</span>.</p>
              </div>
            </motion.div>
          )}

          {activeSession?.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-8">
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-20 h-20 rounded-3xl bg-indigo-600/20 flex items-center justify-center border border-indigo-500/30"
              >
                <Sparkles size={40} className="text-indigo-400" />
              </motion.div>
              <div className="space-y-4 px-4">
                <h2 className="text-3xl md:text-4xl font-display font-bold tracking-tight">
                  How can I help you today?
                </h2>
                <p className="text-zinc-500 text-base md:text-lg">
                  I'm Bhavik AI, your intelligent companion. Ask me anything from writing code to planning your next trip.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 w-full px-4">
                {[
                  { icon: "💡", text: "Explain quantum computing in simple terms" },
                  { icon: "📝", text: "Write a professional email to my manager" },
                  { icon: "🎨", text: "Suggest a color palette for a modern dashboard" },
                  { icon: "🚀", text: "How do I start a career in AI development?" }
                ].map((suggestion, i) => (
                  <button 
                    key={i}
                    onClick={() => setInput(suggestion.text)}
                    className="p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all text-left group"
                  >
                    <span className="text-xl mb-2 block">{suggestion.icon}</span>
                    <p className="text-sm text-zinc-300 group-hover:text-white transition-colors">{suggestion.text}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-8 pb-32">
              <AnimatePresence mode="popLayout">
                {activeSession?.messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex gap-4 md:gap-6",
                      message.role === 'user' ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 md:w-10 md:h-10 rounded-xl flex-shrink-0 flex items-center justify-center",
                      message.role === 'user' ? "bg-zinc-800" : "bg-indigo-600"
                    )}>
                      {message.role === 'user' ? <User size={18} /> : <Bot size={20} />}
                    </div>
                    <div className={cn(
                      "flex-1 space-y-2",
                      message.role === 'user' ? "text-right" : "text-left"
                    )}>
                      <div className={cn(
                        "inline-block max-w-full rounded-2xl p-4 md:p-5 text-sm md:text-base",
                        message.role === 'user' 
                          ? "bg-indigo-600/20 border border-indigo-500/20 text-zinc-100" 
                          : message.content.includes("⚠️") || message.content.includes("trouble connecting")
                            ? "bg-red-500/10 border border-red-500/20 text-red-200"
                            : "bg-zinc-900/50 border border-white/5 text-zinc-300"
                      )}>
                        <div className="markdown-body">
                          <Markdown>{message.content}</Markdown>
                        </div>
                        {(message.content.includes("trouble connecting") || message.content.includes("limit")) && (
                          <button 
                            onClick={() => {
                              const lastUserMsg = [...(activeSession?.messages || [])].reverse().find(m => m.role === 'user');
                              if (lastUserMsg) {
                                setInput(lastUserMsg.content);
                                handleSendMessage();
                              }
                            }}
                            className="mt-3 text-xs font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                          >
                            <Loader2 size={12} /> Try Again
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest">
                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {isLoading && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-4 md:gap-6"
                >
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-white" />
                  </div>
                  <div className="flex-1 space-y-4">
                    <div className="h-4 bg-zinc-800 rounded-full w-3/4 shimmer" />
                    <div className="h-4 bg-zinc-800 rounded-full w-1/2 shimmer" />
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-3 md:p-8 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent">
          <div className="max-w-3xl mx-auto relative">
            <div className="relative flex items-end gap-2 p-1.5 md:p-2 rounded-2xl bg-zinc-900/80 backdrop-blur-xl border border-white/10 shadow-2xl focus-within:border-indigo-500/50 transition-all">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                autoFocus
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Bhavik AI..."
                className="flex-1 bg-transparent border-none focus:ring-0 text-zinc-100 placeholder-zinc-500 py-2.5 md:py-3 px-3 md:px-4 resize-none max-h-32 md:max-h-48 custom-scrollbar text-sm md:text-base"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${target.scrollHeight}px`;
                }}
              />
              <button
                onClick={handleSendMessage}
                disabled={!input.trim() || isLoading}
                className={cn(
                  "p-3 rounded-xl transition-all flex-shrink-0",
                  input.trim() && !isLoading 
                    ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20" 
                    : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                )}
              >
                {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
              </button>
            </div>
            <p className="text-center text-[10px] text-zinc-600 mt-4 uppercase tracking-widest font-medium">
              Bhavik AI may display inaccurate info, including about people, so double-check its responses.
            </p>
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
