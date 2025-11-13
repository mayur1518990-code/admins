"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OCRPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the OCR demo workspace
    if (typeof window !== 'undefined') {
      window.location.href = '/ocr-demo/ocr-engine/example.html';
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-600">Opening OCR Workspace...</p>
      </div>
    </div>
  );
}

