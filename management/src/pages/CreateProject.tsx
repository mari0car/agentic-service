import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, streamChat } from "../lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ProposedFile {
  path: string;
  content: string;
  language: string;
  description?: string;
}

export default function CreateProject() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [proposedFiles, setProposedFiles] = useState<ProposedFile[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Create session on mount
  useEffect(() => {
    api.createSession().then((session) => {
      setSessionId(session.id);
    }).catch((err) => {
      setError("Failed to create session: " + err.message);
    });
  }, []);

  const sendMessage = useCallback(() => {
    if (!sessionId || !input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);
    setError(null);

    // Start with empty assistant message
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    streamChat(
      sessionId,
      userMessage,
      // onText
      (text) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + text,
            };
          }
          return updated;
        });
      },
      // onFiles
      (files, name) => {
        setProposedFiles(files);
        if (name) setProjectName(name);
      },
      // onDone
      () => {
        setIsStreaming(false);
      },
      // onError
      (errMsg) => {
        setError(errMsg);
        setIsStreaming(false);
      }
    );
  }, [sessionId, input, isStreaming]);

  const applyMutation = useMutation({
    mutationFn: () => api.applySession(sessionId!),
    onSuccess: (data) => {
      navigate(`/projects/${data.projectName}`);
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selectedFileData = proposedFiles.find((f) => f.path === selectedFile);

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Create New Project</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Chat with the AI to design your Agentic Service project
          </p>
        </div>
        {projectName && proposedFiles.length > 0 && (
          <button
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {applyMutation.isPending
              ? "Creating..."
              : `Create "${projectName}" (${proposedFiles.length} files)`}
          </button>
        )}
      </div>

      {applyMutation.error && (
        <div className="mb-4 p-3 rounded-lg bg-red-950/30 border border-red-900/50 text-red-400 text-sm">
          {applyMutation.error.message}
        </div>
      )}

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Chat panel */}
        <div className="flex-1 flex flex-col rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {messages.length === 0 && !isStreaming && (
              <div className="text-center py-12">
                <div className="w-12 h-12 rounded-full bg-indigo-600/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <h3 className="text-gray-300 font-medium mb-2">
                  Describe your project
                </h3>
                <p className="text-gray-500 text-sm max-w-md mx-auto">
                  Tell the AI what kind of service you want to build. It will
                  examine existing projects and guide you through creating the
                  specs, database schema, and configuration.
                </p>
                <div className="mt-6 flex flex-wrap gap-2 justify-center">
                  {[
                    "I want to build an inventory management API",
                    "Create a blog platform with users and posts",
                    "Build a simple notes API with tags",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-indigo-600/30 text-indigo-100 border border-indigo-800/50"
                      : "bg-gray-800/50 text-gray-200 border border-gray-700/50"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.role === "assistant" && isStreaming && i === messages.length - 1 && (
                    <span className="inline-block w-2 h-4 bg-indigo-400 ml-0.5 animate-pulse" />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-800">
            {error && (
              <div className="mb-2 p-2 rounded bg-red-950/30 border border-red-900/50 text-red-400 text-xs">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isStreaming
                    ? "Waiting for response..."
                    : "Describe what you want to build..."
                }
                disabled={isStreaming || !sessionId}
                className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 resize-none outline-none focus:border-indigo-600 disabled:opacity-50 min-h-[40px] max-h-[120px]"
                rows={1}
              />
              <button
                onClick={sendMessage}
                disabled={isStreaming || !input.trim() || !sessionId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded-lg transition-colors shrink-0"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* File preview panel */}
        <div className="w-96 shrink-0 flex flex-col rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
          <div className="p-3 border-b border-gray-800">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-300">
                Proposed Files
                {projectName && (
                  <span className="ml-2 text-indigo-400 font-mono">
                    {projectName}/
                  </span>
                )}
              </h3>
              <span className="text-xs text-gray-500">
                {proposedFiles.length} file{proposedFiles.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {proposedFiles.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm p-4 text-center">
              Files proposed by the AI will appear here as the conversation progresses
            </div>
          ) : (
            <>
              {/* File list */}
              <div className="border-b border-gray-800 max-h-48 overflow-auto">
                {proposedFiles.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                      selectedFile === file.path
                        ? "bg-indigo-600/20 text-indigo-300"
                        : "text-gray-400 hover:bg-gray-800"
                    }`}
                  >
                    <FileIcon language={file.language} />
                    <span className="font-mono truncate">{file.path}</span>
                  </button>
                ))}
              </div>

              {/* File content */}
              <div className="flex-1 overflow-auto">
                {selectedFileData ? (
                  <div>
                    <div className="px-3 py-2 border-b border-gray-800 bg-gray-800/30">
                      <span className="text-xs font-mono text-gray-300">
                        {selectedFileData.path}
                      </span>
                      {selectedFileData.description && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {selectedFileData.description}
                        </p>
                      )}
                    </div>
                    <pre className="p-3 text-xs text-gray-200 font-mono whitespace-pre-wrap overflow-auto">
                      {selectedFileData.content}
                    </pre>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-xs">
                    Select a file to preview
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FileIcon({ language }: { language: string }) {
  const colors: Record<string, string> = {
    yaml: "text-yellow-400",
    markdown: "text-blue-400",
    sql: "text-emerald-400",
    typescript: "text-blue-500",
    json: "text-orange-400",
  };

  return (
    <svg
      className={`w-3.5 h-3.5 shrink-0 ${colors[language] || "text-gray-400"}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}
