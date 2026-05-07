"use client";

import { useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function VoiceInput({
  disabled = false,
  onTranscript,
}: {
  disabled?: boolean;
  onTranscript: (transcript: string) => void;
}) {
  const [isSupported, setIsSupported] = useState(() =>
    Boolean(getSpeechRecognition()),
  );
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const isUnavailable = !isSupported || disabled;
  const buttonClassName = [
    isListening
      ? "h-10 rounded-md border border-[#bfdbfe] bg-[#1d4ed8] px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1e40af]"
      : "h-10 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-semibold text-[#334155] shadow-sm transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]",
    isUnavailable ? "cursor-not-allowed opacity-60" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function toggleListening() {
    if (!isSupported || disabled) {
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    finalTranscriptRef.current = "";
    setError(null);

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];

        if (result.isFinal) {
          finalText += result[0].transcript;
        }
      }

      if (finalText.trim()) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalText}`.trim();
      }
    };
    recognition.onerror = (event) => {
      setError(event.error);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;

      const transcript = finalTranscriptRef.current.trim();
      if (transcript) {
        onTranscript(transcript);
        finalTranscriptRef.current = "";
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  return (
    <button
      aria-pressed={isListening}
      aria-disabled={isUnavailable}
      className={buttonClassName}
      disabled={disabled}
      onClick={toggleListening}
      title={!isSupported ? "Voice input requires Chrome" : error ?? "Voice input"}
      type="button"
    >
      {isListening ? "Stop mic" : "Mic"}
    </button>
  );
}

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    (window as SpeechWindow).SpeechRecognition ??
    (window as SpeechWindow).webkitSpeechRecognition
  );
}
