import { Sidebar } from "@/components/AdminSidebar";

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            System Settings
          </h1>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">System settings will be configured here</p>
              <p className="text-sm text-gray-400">Configure application settings and preferences</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
