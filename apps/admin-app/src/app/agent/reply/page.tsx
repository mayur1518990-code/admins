import { Sidebar } from "@/components/AdminSidebar";

export default function ReplyPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            Reply to User
          </h1>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select File
                </label>
                <select className="w-full p-3 border border-gray-300 rounded-lg">
                  <option>Select a file to reply to</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reply Message
                </label>
                <textarea
                  className="w-full p-3 border border-gray-300 rounded-lg h-32"
                  placeholder="Enter your reply message..."
                />
              </div>
              
              <button className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors">
                Send Reply
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
