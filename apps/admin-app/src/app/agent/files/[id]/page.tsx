import { Sidebar } from "@/components/AdminSidebar";

interface FileDetailsPageProps {
  params: {
    id: string;
  };
}

export default function FileDetailsPage({ params }: FileDetailsPageProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            File Details - {params.id}
          </h1>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">File details will be displayed here</p>
              <p className="text-sm text-gray-400">File ID: {params.id}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
