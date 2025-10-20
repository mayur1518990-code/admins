"use client";

import Link from "next/link";

interface FileCardProps {
  id: string;
  filename: string;
  status: "pending" | "processing" | "completed" | "failed";
  uploadedAt: Date;
}

export function FileCard({ id, filename, status, uploadedAt }: FileCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "processing":
        return "bg-blue-100 text-blue-800";
      case "completed":
        return "bg-green-100 text-green-800";
      case "failed":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold text-gray-900 truncate">
          {filename}
        </h3>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
          {status}
        </span>
      </div>
      
      <p className="text-sm text-gray-500 mb-4">
        Uploaded: {uploadedAt.toLocaleDateString()}
      </p>
      
      <div className="flex space-x-2">
        <Link
          href={`/agent/files/${id}`}
          className="flex-1 bg-blue-600 text-white text-center py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          View Details
        </Link>
        <button className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition-colors text-sm">
          Download
        </button>
      </div>
    </div>
  );
}
